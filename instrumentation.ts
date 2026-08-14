/**
 * Crash recovery at server boot.
 *
 * The supervisor's recovery path (reconcile stale heartbeat -> CRASHED -> resume the same run,
 * renew the lease, re-claim interrupted jobs) was implemented and unit-tested but never invoked
 * by the server itself — a hard kill followed by a restart left the run as CRASHED with work
 * orphaned until an operator pressed Start. This hook makes the documented behavior real:
 *
 *   Server starts -> unfinished AutonomousRun found -> lease/heartbeat validated ->
 *   reconciled -> resumed automatically (DEGRADED, "Recovering from interrupted run").
 *
 * It is a no-op when nothing is recoverable (fresh database, healthy run, STOPPED run — a
 * STOPPED run was intentionally halted and is never resumed).
 *
 * ## Why the supervisor is imported inside `register()` rather than at module scope
 *
 * `instrumentation.ts` is bundled for EVERY runtime Next.js targets, including Edge. The
 * supervisor reaches the filesystem, `child_process`, and the Python quant core, none of which
 * exist on Edge — so a top-level `import { recoverInterruptedRun } from "@/lib/runtime/supervisor"`
 * dragged that whole Node-only dependency tree into the Edge bundle and produced the build
 * warnings the owner reported. Next.js's guidance for runtime-specific code is exactly this: keep
 * the import dynamic and inside `register()`, gated on `process.env.NEXT_RUNTIME`, so the module
 * is only ever resolved in the runtime that can actually load it.
 *
 * The guard is a positive check for "nodejs" rather than a negative check for "edge": if a future
 * Next.js version introduces a third runtime, the safe default is to not load Node-only code
 * there.
 */
export async function register() {
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  // Recovery touches the database and the process lease; only the Node.js runtime can do either.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  try {
    const { recoverInterruptedRun } = await import("@/lib/runtime/supervisor");
    const recovered = recoverInterruptedRun();
    if (recovered) {
      console.log(`[runtime] ${recovered.summary}`);
    }
  } catch (error) {
    console.error(
      "[runtime] boot recovery skipped:",
      error instanceof Error ? error.message : String(error),
    );
  }
}
