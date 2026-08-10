import { MARKET_CALENDAR_VERSION } from "@/lib/market/calendar";
import { FEE_MODEL_ID } from "@/lib/paper/cost-model";
import { SIMULATION_GATES } from "@/lib/simulation/battery";
import { COMPILER_VERSION } from "@/lib/strategy/dsl";

/**
 * The experiment manifest (slice 13b).
 *
 * The invariant it serves: **every quantitative decision must be reproducible from an explicit
 * immutable manifest.** Same strategy version + same dataset snapshot + same engine + same fee
 * model + same calendar + same seed = same numbers — and when any of those changes, the manifest
 * says which, so two disagreeing results can be diffed instead of argued about.
 */
export interface ExperimentManifest {
  strategyVersionId: string;
  datasetSnapshotId: string;
  datasetFingerprint: string;
  engineVersion: string;
  brokerExecutionProfileId: string | null;
  feeModelId: string;
  marketCalendarVersion: string;
  /** Null where no randomness participates (pure replay); the battery's fixed seed otherwise. */
  randomSeed: number | null;
  /** The versioned compile contract the run was built under. */
  codeFingerprint: string;
  createdAt: string;
}

export function buildManifest(input: {
  strategyVersionId: string;
  datasetSnapshotId: string;
  datasetFingerprint: string;
  brokerExecutionProfileId: string | null;
  /** Pass SIMULATION_GATES.seed when the battery ran; omit for pure replays. */
  randomSeed?: number | null;
  now?: Date;
}): ExperimentManifest {
  return {
    strategyVersionId: input.strategyVersionId,
    datasetSnapshotId: input.datasetSnapshotId,
    datasetFingerprint: input.datasetFingerprint,
    engineVersion: COMPILER_VERSION,
    brokerExecutionProfileId: input.brokerExecutionProfileId,
    feeModelId: FEE_MODEL_ID,
    marketCalendarVersion: MARKET_CALENDAR_VERSION,
    randomSeed: input.randomSeed ?? null,
    codeFingerprint: `marketpulse-dsl@${COMPILER_VERSION}`,
    createdAt: (input.now ?? new Date()).toISOString(),
  };
}

/** The seed the simulation battery actually uses — re-exported so manifests cannot drift from it. */
export const BATTERY_SEED = SIMULATION_GATES.seed;
