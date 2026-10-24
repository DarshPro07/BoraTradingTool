/**
 * SEC-8 (PRD v2): nothing in this system can place, approve or fill a live order, and the cloud clock
 * runs no model and no shell.
 *
 * Incident: the external review of 2026-10-24 asked for proof that no broker order capability is
 * reachable now that the clock runs unattended on GitHub. Until then inertness rested on a
 * constant-equality unit test and a one-time reading of the code.
 */
import { build } from "esbuild";
import { describe, expect, it } from "vitest";
import { POST as approve } from "@/app/api/trade/[id]/approve/route";
import { POST as fill } from "@/app/api/trade/[id]/fill/route";
import { POST as place } from "@/app/api/trade/place/route";
import { createLocalSession, LOCAL_SESSION_COOKIE, MUTATION_HEADER, MUTATION_HEADER_VALUE } from "@/lib/security/request";

const origin = "http://127.0.0.1:3000";
const owner = (route: string) =>
  new Request(`${origin}${route}`, {
    method: "POST",
    // Every layer of requireMutationAccess passes: the 503 below is the order boundary, not access control.
    headers: {
      origin,
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
      cookie: `${LOCAL_SESSION_COOKIE}=${createLocalSession()}`,
      [MUTATION_HEADER]: MUTATION_HEADER_VALUE,
    },
    body: JSON.stringify({ instrumentId: "IN:XNSE:RELIANCE", side: "BUY", quantity: 1 }),
  });
const params = { params: Promise.resolve({ id: "1" }) };

describe("SEC-8: the order boundary", () => {
  it("refuses every order route with 503 EXECUTION_ADAPTER_MISSING, even to the signed-in owner", async () => {
    for (const [name, response] of [
      ["place", await place(owner("/api/trade/place"))],
      ["approve", await approve(owner("/api/trade/1/approve"), params)],
      ["fill", await fill(owner("/api/trade/1/fill"), params)],
    ] as const) {
      expect(response.status, name).toBe(503);
      expect((await response.json()).error, name).toBe("EXECUTION_ADAPTER_MISSING");
    }
  });

  it("the cloud clock's bundle reaches no model, no shell and no broker code", async () => {
    const { metafile } = await build({
      entryPoints: ["scripts/clock-entry.ts"],
      bundle: true,
      write: false,
      metafile: true,
      platform: "node",
      format: "esm",
      packages: "external",
      outdir: "unused",
      logLevel: "silent",
    });
    const sources = Object.keys(metafile.inputs);
    const externals = Object.values(metafile.outputs).flatMap((output) => output.imports.map((i) => i.path));
    expect(sources.length, "the bundle was built").toBeGreaterThan(10);
    // lib/broker/execution-profile.ts is allowed: dated square-off deadlines, no request code.
    expect(sources.filter((s) => /^lib\/(ai|agents)\/|^lib\/broker\/(adapter|kite)/.test(s)), "model, agent and broker-order code").toEqual([]);
    expect(externals.filter((e) => /child_process|@anthropic-ai|openai/.test(e)), "a shell or a model SDK").toEqual([]);
  });
});
