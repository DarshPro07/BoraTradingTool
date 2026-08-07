import { beforeEach, describe, expect, it } from "vitest";
import { cacheSize, cached, clearCacheForTests, timeBucket } from "./cache";

beforeEach(() => clearCacheForTests());

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("cached", () => {
  it("serves a fresh value without calling upstream again", async () => {
    let calls = 0;
    const fn = async () => { calls += 1; return "v1"; };
    await cached("fresh", 60_000, fn);
    await expect(cached("fresh", 60_000, fn)).resolves.toBe("v1");
    expect(calls).toBe(1);
  });

  it("collapses concurrent misses into one upstream call", async () => {
    let calls = 0;
    const fn = async () => { calls += 1; await sleep(5); return "v1"; };
    const [a, b, c] = await Promise.all([
      cached("flight", 60_000, fn),
      cached("flight", 60_000, fn),
      cached("flight", 60_000, fn),
    ]);
    expect([a, b, c]).toEqual(["v1", "v1", "v1"]);
    expect(calls).toBe(1);
  });

  it("serves the last good value when upstream fails inside the stale ceiling", async () => {
    let calls = 0;
    const fn = async () => {
      calls += 1;
      if (calls === 1) return "v1";
      throw new Error("provider down");
    };
    await cached("stale-ok", 1, fn, { maxStaleMs: 60_000 });
    await sleep(5);
    await expect(cached("stale-ok", 1, fn, { maxStaleMs: 60_000 })).resolves.toBe("v1");
  });

  it("stops serving stale once the ceiling passes", async () => {
    // A quote old enough to mislead is worse than an honest failure.
    let calls = 0;
    const fn = async () => {
      calls += 1;
      if (calls === 1) return "v1";
      throw new Error("provider down");
    };
    await cached("stale-expired", 1, fn, { maxStaleMs: 5 });
    await sleep(25);
    await expect(cached("stale-expired", 1, fn, { maxStaleMs: 5 })).rejects.toThrow("provider down");
  });

  it("releases the key when an upstream call never settles", async () => {
    // Without a deadline a hung request pins the key and every later caller waits forever.
    await expect(
      cached("hung", 60_000, () => new Promise<string>(() => {}), { deadlineMs: 10 }),
    ).rejects.toThrow(/exceeded/);
    await expect(cached("hung", 60_000, async () => "recovered", { deadlineMs: 10 }))
      .resolves.toBe("recovered");
  });

  it("bounds the number of retained entries", async () => {
    for (let i = 0; i < 600; i += 1) {
      await cached(`key-${i}`, 60_000, async () => i);
    }
    expect(cacheSize()).toBeLessThanOrEqual(500);
    // The most recent key survives; the oldest was evicted.
    let recomputed = false;
    await cached("key-0", 60_000, async () => { recomputed = true; return 0; });
    expect(recomputed).toBe(true);
  });
});

describe("timeBucket", () => {
  it("produces a stable key within one window", () => {
    expect(timeBucket(1_700_000_000, 60_000)).toBe(timeBucket(1_700_000_030, 60_000));
  });

  it("advances to a new bucket across the window boundary", () => {
    expect(timeBucket(1_700_000_000, 60_000)).not.toBe(timeBucket(1_700_000_120, 60_000));
  });
});
