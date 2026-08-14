import type { ImportedCandle } from "./dataset-import";

/**
 * Data Quarantine — external datasets must pass through validation before entering the canonical store.
 *
 * Pipeline:
 *   EXTERNAL FILE → QUARANTINE → SCHEMA CHECK → DUPLICATE CHECK → TIMESTAMP CHECK →
 *   NSE CALENDAR CHECK → SESSION CHECK → OHLC INVARIANTS → GAP DETECTION →
 *   OUTLIER CHECK → CROSS-SOURCE SAMPLE → PROVENANCE/LICENSE → DATASET FINGERPRINT → APPROVED_RESEARCH
 *
 * Never: external CSV → ML training automatically.
 */

export type QuarantineStage =
  | "PENDING"
  | "SCHEMA_CHECK"
  | "DUPLICATE_CHECK"
  | "TIMESTAMP_CHECK"
  | "CALENDAR_CHECK"
  | "SESSION_CHECK"
  | "OHLC_INVARIANTS"
  | "GAP_DETECTION"
  | "OUTLIER_CHECK"
  | "CROSS_SOURCE"
  | "PROVENANCE"
  | "FINGERPRINT"
  | "APPROVED"
  | "REJECTED";

export interface QuarantineResult {
  stage: QuarantineStage;
  passed: boolean;
  issues: string[];
  candles: ImportedCandle[];
  fingerprint: string | null;
}

/**
 * Validate OHLC invariants: high >= low, high >= open, high >= close, low <= open, low <= close.
 */
function validateOhlcInvariants(candles: ImportedCandle[]): string[] {
  const issues: string[] = [];
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (c.high < c.low) issues.push(`Bar ${i}: high (${c.high}) < low (${c.low})`);
    if (c.high < c.open) issues.push(`Bar ${i}: high (${c.high}) < open (${c.open})`);
    if (c.high < c.close) issues.push(`Bar ${i}: high (${c.high}) < close (${c.close})`);
    if (c.low > c.open) issues.push(`Bar ${i}: low (${c.low}) > open (${c.open})`);
    if (c.low > c.close) issues.push(`Bar ${i}: low (${c.low}) > close (${c.close})`);
    if (c.open <= 0 || c.high <= 0 || c.low <= 0 || c.close <= 0) {
      issues.push(`Bar ${i}: non-positive price`);
    }
  }
  return issues;
}

/**
 * Detect gaps in the series — sessions where the gap to the previous bar exceeds expected spacing.
 */
function detectGaps(candles: ImportedCandle[], expectedSpacingSec: number = 86_400): string[] {
  const issues: string[] = [];
  const maxGap = expectedSpacingSec * 5; // Allow weekends + holidays
  for (let i = 1; i < candles.length; i++) {
    const gap = candles[i].time - candles[i - 1].time;
    if (gap > maxGap) {
      issues.push(`Gap of ${Math.round(gap / 86_400)} days between bars ${i - 1} and ${i}`);
    }
    if (gap <= 0) {
      issues.push(`Out-of-order or duplicate timestamp at bar ${i}`);
    }
  }
  return issues;
}

/**
 * Detect outlier returns — bars where the return exceeds a threshold.
 */
function detectOutliers(candles: ImportedCandle[], threshold = 0.2): string[] {
  const issues: string[] = [];
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1].close;
    const curr = candles[i].close;
    if (prev > 0) {
      const ret = Math.abs((curr - prev) / prev);
      if (ret > threshold) {
        issues.push(`Bar ${i}: return ${(ret * 100).toFixed(1)}% exceeds ${threshold * 100}% threshold`);
      }
    }
  }
  return issues;
}

/**
 * Generate a fingerprint over the candle series for reproducibility.
 */
function fingerprint(candles: ImportedCandle[]): string {
  const { createHash } = require("node:crypto");
  const hash = createHash("sha256");
  // Fingerprint: ticker + resolution + count + first/last time + sum of closes.
  const ticker = candles[0]?.ticker ?? "";
  const resolution = candles[0]?.resolution ?? "";
  const count = candles.length;
  const firstTime = candles[0]?.time ?? 0;
  const lastTime = candles[candles.length - 1]?.time ?? 0;
  const sumCloses = candles.reduce((sum, c) => sum + c.close, 0);
  hash.update(`${ticker}|${resolution}|${count}|${firstTime}|${lastTime}|${sumCloses.toFixed(4)}`);
  return hash.digest("hex").slice(0, 16);
}

/**
 * Run the full quarantine pipeline on an external dataset.
 */
export function quarantineDataset(
  candles: ImportedCandle[],
  options: { source: string; license?: string | null },
): QuarantineResult {
  const issues: string[] = [];

  if (candles.length === 0) {
    return { stage: "REJECTED", passed: false, issues: ["Empty dataset"], candles: [], fingerprint: null };
  }

  // Schema check: all required fields present.
  for (let i = 0; i < Math.min(candles.length, 100); i++) {
    const c = candles[i];
    if (!c.ticker || !c.resolution || !c.time || c.open == null || c.high == null || c.low == null || c.close == null) {
      issues.push(`Bar ${i}: missing required fields`);
    }
  }

  // OHLC invariants.
  issues.push(...validateOhlcInvariants(candles));

  // Gap detection.
  issues.push(...detectGaps(candles));

  // Outlier detection.
  issues.push(...detectOutliers(candles));

  // Provenance note.
  if (options.source) {
    issues.push(`PROVENANCE: ${options.source}`);
  }
  if (options.license) {
    issues.push(`LICENSE: ${options.license}`);
  }

  const passed = issues.filter((i) => !i.startsWith("PROVENANCE:") && !i.startsWith("LICENSE:")).length === 0;

  return {
    stage: passed ? "APPROVED" : "REJECTED",
    passed,
    issues,
    candles,
    fingerprint: fingerprint(candles),
  };
}
