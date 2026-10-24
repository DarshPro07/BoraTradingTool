import { describe, expect, it } from "vitest";
import { downloadAsset, latestStateAsset, uploadState, type Asset, type Release } from "./release";

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
});
