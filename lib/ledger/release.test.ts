import { describe, expect, it } from "vitest";
import { activeClockRuns, downloadAsset, latestStateAsset, restoreSource, uploadState, type Asset, type Release } from "./release";

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
    expect(release.assets.map((a) => a.name)).toEqual(["ledger-400.bin", "ledger-300.bin"]);
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
});
