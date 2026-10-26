import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { activeClockRuns, daySnapshotName, dispatchClock, downloadAsset, latestStateAsset, restoreSource, uploadDaySnapshot, uploadState, type Asset, type Release } from "./release";

const asset = (id: number, name: string): Asset => ({ id, name, url: `https://api.github.com/assets/${id}`, size: 1 });

describe("the ledger's release assets (docs/plans/cloud-clock)", () => {
  it("uploads the new bundle first, then keeps it and the newest older one", async () => {
    const calls: string[] = [];
    const fake = (async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method} ${url.replace(/^https:\/\/[^/]+/, "")}`);
      if (init?.method === "POST") return new Response(JSON.stringify(asset(9, "ledger-400.bin")), { status: 201 });
      return new Response(null, { status: 204 });
    }) as typeof fetch;
    const release: Release = { id: 1, assets: [asset(1, "ledger-100.bin"), asset(2, "ledger-200.bin"), asset(3, "ledger-300.bin"), asset(4, "notes.txt")] };
    await uploadState({ repo: "o/r", token: "t", fetch: fake }, release, 400, Buffer.from("sealed"));
    expect(calls).toEqual([
      "POST /repos/o/r/releases/1/assets?name=ledger-400.bin",
      "DELETE /repos/o/r/releases/assets/2",
      "DELETE /repos/o/r/releases/assets/1",
    ]);
    expect(release.assets.map((a) => a.name)).toEqual(["ledger-400.bin", "ledger-300.bin", "notes.txt"]);
  });

  it("does not restart a download that timed out", async () => {
    // 2026-10-24: the laptop fetched release assets at 2.4 KB/s, about 6 min for a 906 KB ledger;
    // 30 s attempts, each restarting from zero, never finished one.
    let calls = 0;
    const fake = (async () => {
      calls += 1;
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    }) as typeof fetch;
    await expect(downloadAsset({ repo: "o/r", fetch: fake }, asset(9, "ledger-400.bin"))).rejects.toThrow(/timeout/);
    expect(calls).toBe(1);
  });

  it("deletes nothing when the upload fails", async () => {
    const calls: string[] = [];
    const fake = (async (_url: string, init?: RequestInit) => {
      calls.push(String(init?.method));
      return new Response("{}", { status: 500 });
    }) as typeof fetch;
    const release: Release = { id: 1, assets: [asset(1, "ledger-100.bin"), asset(2, "ledger-200.bin")] };
    await expect(uploadState({ repo: "o/r", fetch: fake }, release, 300, Buffer.from("x"))).rejects.toThrow(/GitHub 500/);
    expect(calls).toEqual(["POST"]);
  });

  it("keeps tracking the new bundle when a delete fails, and retries the delete next time", async () => {
    // Review 2026-10-24: a failed DELETE threw before the list was updated, orphaning the upload.
    const fake = (async (_url: string, init?: RequestInit) =>
      init?.method === "POST" ? new Response(JSON.stringify(asset(9, "ledger-400.bin")), { status: 201 }) : new Response("{}", { status: 503 })) as typeof fetch;
    const release: Release = { id: 1, assets: [asset(1, "ledger-100.bin"), asset(2, "ledger-200.bin")] };
    await uploadState({ repo: "o/r", fetch: fake }, release, 400, Buffer.from("x"));
    expect(release.assets.map((a) => a.name)).toEqual(["ledger-400.bin", "ledger-200.bin", "ledger-100.bin"]);
  }, 20_000);

  it("reads the newest bundle by its epoch, not by its position", () => {
    expect(latestStateAsset({ id: 1, assets: [asset(2, "ledger-900.bin"), asset(1, "ledger-1000.bin"), asset(3, "x.bin")] })?.epoch).toBe(1000);
    expect(latestStateAsset(null)).toBeNull();
  });

  it("skips an asset whose upload never finished", () => {
    const release: Release = { id: 1, assets: [asset(1, "ledger-100.bin"), { ...asset(2, "ledger-200.bin"), state: "starter" }] };
    expect(latestStateAsset(release)?.epoch).toBe(100);
  });

  it("resumes from the seed only right after a cutover, never as a silent rollback", () => {
    // Review 2026-10-24: a deleted release made every run resume from the cutover seed, quietly.
    const day = 86_400_000;
    expect(restoreSource(1_000, null, 1_000 + 3_600_000)).toBe("seed");
    expect(restoreSource(5_000, 1_000, 6_000)).toBe("seed"); // a new cutover after a promote
    expect(restoreSource(1_000, 5_000, 6_000)).toBe("release");
    expect(() => restoreSource(1_000, null, 1_000 + 2 * day)).toThrow(/release/);
    expect(() => restoreSource(null, null, 0)).toThrow(/no ledger/);
  });

  it("lists Clock runs that are queued or running", async () => {
    // Review 2026-10-24: promote checked only the last bundle, so a run already started could keep
    // writing after the laptop took the ledger back.
    let url = "";
    const fake = (async (u: string) => {
      url = u;
      return new Response(JSON.stringify({ workflow_runs: [{ id: 1, status: "queued" }, { id: 2, status: "completed" }, { id: 3, status: "in_progress" }] }), { status: 200 });
    }) as typeof fetch;
    expect((await activeClockRuns({ repo: "o/r", fetch: fake })).map((r) => r.status)).toEqual(["queued", "in_progress"]);
    expect(url).toContain("/repos/o/r/actions/workflows/clock.yml/runs");
  });

  it("keeps a dated day snapshot in the list and never deletes it", async () => {
    const calls: string[] = [];
    const fake = (async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method} ${url.replace(/^https:\/\/[^/]+/, "")}`);
      return init?.method === "POST" ? new Response(JSON.stringify(asset(9, "ledger-400.bin")), { status: 201 }) : new Response(null, { status: 204 });
    }) as typeof fetch;
    const release: Release = { id: 1, assets: [asset(1, "ledger-100.bin"), asset(2, "ledger-200.bin"), asset(3, "ledger-300.bin"), asset(5, "ledger-day-2026-10-23.bin")] };
    await uploadState({ repo: "o/r", fetch: fake }, release, 400, Buffer.from("sealed"));
    expect(release.assets.map((a) => a.name)).toContain("ledger-day-2026-10-23.bin");
    expect(calls.filter((c) => c.startsWith("DELETE"))).toEqual(["DELETE /repos/o/r/releases/assets/2", "DELETE /repos/o/r/releases/assets/1"]);
  });

  it("keeps a finished bundle as the fallback, never an unfinished one", async () => {
    // Review 2026-10-25: an unfinished newer upload was kept and the last good bundle deleted.
    const deleted: string[] = [];
    const fake = (async (url: string, init?: RequestInit) => {
      if (init?.method === "DELETE") deleted.push(url.split("/").pop()!);
      return init?.method === "POST" ? new Response(JSON.stringify(asset(9, "ledger-400.bin")), { status: 201 }) : new Response(null, { status: 204 });
    }) as typeof fetch;
    const release: Release = { id: 1, assets: [asset(1, "ledger-100.bin"), asset(2, "ledger-200.bin"), { ...asset(3, "ledger-300.bin"), state: "starter" }] };
    await uploadState({ repo: "o/r", fetch: fake }, release, 400, Buffer.from("x"));
    expect(release.assets.map((a) => a.name)).toEqual(["ledger-400.bin", "ledger-200.bin"]);
    expect(deleted.sort()).toEqual(["1", "3"]);
  });

  it("uploads one dated, hashed snapshot per day and no second one", async () => {
    const requests: string[] = [];
    const fake = (async (u: string, init?: RequestInit) => {
      requests.push(`${init?.method} ${u}`);
      return new Response(JSON.stringify({ ...asset(8, daySnapshotName("2026-10-26")), label: "x" }), { status: 201 });
    }) as typeof fetch;
    const release: Release = { id: 1, assets: [asset(1, "ledger-100.bin")] };
    const sealed = Buffer.from("sealed bytes");
    expect(await uploadDaySnapshot({ repo: "o/r", fetch: fake }, release, "2026-10-26", sealed)).toBe(true);
    expect(requests).toHaveLength(1);
    const url = new URL(requests[0]!.split(" ")[1]!);
    expect(url.searchParams.get("name")).toBe("ledger-day-2026-10-26.bin");
    expect(url.searchParams.get("label")).toBe(`sha256:${createHash("sha256").update(sealed).digest("hex")}`);
    expect(release.assets.map((a) => a.name)).toContain("ledger-day-2026-10-26.bin");
    expect(await uploadDaySnapshot({ repo: "o/r", fetch: fake }, release, "2026-10-26", sealed)).toBe(false);
    expect(requests).toHaveLength(1);
  });

  it("retakes a day snapshot whose upload never finished", async () => {
    // Review 2026-10-25: an aborted upload of that name blocked the day's snapshot for good.
    const requests: string[] = [];
    const fake = (async (u: string, init?: RequestInit) => {
      requests.push(`${init?.method} ${u.split("?")[0]!.split("/").slice(-2).join("/")}`);
      return init?.method === "POST" ? new Response(JSON.stringify(asset(8, daySnapshotName("2026-10-26"))), { status: 201 }) : new Response(null, { status: 204 });
    }) as typeof fetch;
    const release: Release = { id: 1, assets: [{ ...asset(7, daySnapshotName("2026-10-26")), state: "starter" }] };
    expect(await uploadDaySnapshot({ repo: "o/r", fetch: fake }, release, "2026-10-26", Buffer.from("x"))).toBe(true);
    expect(requests).toEqual(["DELETE assets/7", "POST 1/assets"]);
  });

  it("starts the next Clock run, so a session never waits on a late cron", async () => {
    // 2026-10-26: GitHub started this repo's crons 2-2.6 h late, so the 08:13 run had not begun at 09:11.
    let call = "";
    const fake = (async (u: string, init?: RequestInit) => {
      call = `${init?.method} ${u} ${String(init?.body)}`;
      return new Response(null, { status: u.includes("o/r") ? 204 : 403 });
    }) as typeof fetch;
    await dispatchClock({ repo: "o/r", token: "t", fetch: fake }, 2, "555");
    expect(call).toBe('POST https://api.github.com/repos/o/r/actions/workflows/clock.yml/dispatches {"ref":"main","inputs":{"chain":"2","from_run":"555"}}');
  });

  it("retries a failed hand-over dispatch: a duplicate only replaces the pending run", async () => {
    // Review 2026-10-26: one transient 502 at 09:10 left the session to crons hours late.
    let calls = 0;
    const flaky = (async () => new Response(null, { status: ++calls < 3 ? 502 : 200 })) as typeof fetch;
    await dispatchClock({ repo: "o/r", token: "t", fetch: flaky }, 1, "555");
    expect(calls).toBe(3);
  }, 20_000);

  it("names the dispatch inputs that clock.yml declares and maps", () => {
    // Review 2026-10-26: an input the workflow does not declare makes GitHub answer 422, silently.
    const yml = fs.readFileSync(".github/workflows/clock.yml", "utf8");
    expect(yml).toMatch(/workflow_dispatch:\s*\n\s*inputs:[\s\S]*\n\s+chain:[\s\S]*\n\s+from_run:/);
    expect(yml).toMatch(/CLOCK_CHAIN: \$\{\{ inputs\.chain/);
    expect(yml).toMatch(/CLOCK_FROM_RUN: \$\{\{ inputs\.from_run/);
  });

  it("refuses to retake a day snapshot when the unfinished one cannot be deleted", async () => {
    const fake = (async (_u: string, init?: RequestInit) => new Response(null, { status: init?.method === "DELETE" ? 500 : 201 })) as typeof fetch;
    const release: Release = { id: 1, assets: [{ ...asset(7, daySnapshotName("2026-10-26")), state: "starter" }] };
    await expect(uploadDaySnapshot({ repo: "o/r", fetch: fake }, release, "2026-10-26", Buffer.from("x"))).rejects.toThrow(/500/);
    expect(release.assets).toHaveLength(1);
  });
});
