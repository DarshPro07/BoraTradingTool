import fs from "node:fs";
import path from "node:path";
import { ENGLE_GRANGER_CRITICAL, adfStatistic } from "@/lib/quant/statarb";

/**
 * Half one of the Engle-Granger parity corpus (mission phase F: "APPROXIMATE until parity").
 *
 * Generates a deterministic synthetic corpus — cointegrated, non-cointegrated, near-threshold,
 * varied lengths — writes the raw series to JSON, and records MarketPulse's own verdicts.
 * `scripts/statarb_parity.py` then scores the SAME series with statsmodels.coint and reports
 * agreement. Neither half can quietly grade itself.
 */

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussFactory(seed: number): () => number {
  const random = mulberry(seed);
  return () => Math.sqrt(-2 * Math.log(Math.max(random(), 1e-12))) * Math.cos(2 * Math.PI * random());
}

interface Case {
  id: string;
  kind: "cointegrated" | "independent" | "near_threshold" | "nearly_collinear";
  length: number;
  a: number[];
  b: number[];
  ourStatistic: number | null;
  ourVerdict: "COINTEGRATED" | "NOT_COINTEGRATED" | "UNDECIDABLE";
}

const cases: Case[] = [];
let seed = 1;

function buildCase(kind: Case["kind"], length: number, index: number): Case {
  const gaussB = gaussFactory(seed++);
  const gaussN = gaussFactory(seed++);
  const b: number[] = [100];
  for (let i = 1; i < length; i += 1) b.push(b[i - 1] + gaussB() * 1.5);

  let a: number[];
  if (kind === "cointegrated") {
    let ar = 0;
    a = b.map((value) => {
      ar = 0.8 * ar + gaussN() * 2;
      return 2 * value + ar + 50;
    });
  } else if (kind === "near_threshold") {
    // Very slow reversion: right at the boundary where methods can disagree.
    let ar = 0;
    a = b.map((value) => {
      ar = 0.985 * ar + gaussN() * 2;
      return 2 * value + ar + 50;
    });
  } else if (kind === "nearly_collinear") {
    a = b.map((value) => 2 * value + 50 + gaussN() * 0.01);
  } else {
    const gaussA = gaussFactory(seed++);
    a = [80];
    for (let i = 1; i < length; i += 1) a.push(a[i - 1] + gaussA() * 1.5);
  }

  // Our verdict: OLS hedge on levels, ADF on the residual, 5% asymptotic threshold.
  const meanA = a.reduce((x, y) => x + y, 0) / a.length;
  const meanB = b.reduce((x, y) => x + y, 0) / b.length;
  let covariance = 0;
  let variance = 0;
  for (let i = 0; i < a.length; i += 1) {
    covariance += (b[i] - meanB) * (a[i] - meanA);
    variance += (b[i] - meanB) ** 2;
  }
  const hedge = variance > 0 ? covariance / variance : 0;
  const spread = a.map((value, i) => value - hedge * b[i]);
  const statistic = adfStatistic(spread);

  return {
    id: `${kind}_${length}_${index}`,
    kind,
    length,
    a,
    b,
    ourStatistic: statistic,
    ourVerdict:
      statistic === null ? "UNDECIDABLE" : statistic < ENGLE_GRANGER_CRITICAL.p05 ? "COINTEGRATED" : "NOT_COINTEGRATED",
  };
}

for (const length of [120, 250, 500]) {
  for (let index = 0; index < 12; index += 1) cases.push(buildCase("cointegrated", length, index));
  for (let index = 0; index < 12; index += 1) cases.push(buildCase("independent", length, index));
  for (let index = 0; index < 8; index += 1) cases.push(buildCase("near_threshold", length, index));
  for (let index = 0; index < 4; index += 1) cases.push(buildCase("nearly_collinear", length, index));
}

const outputDirectory = path.join(process.cwd(), ".tmp");
fs.mkdirSync(outputDirectory, { recursive: true });
const outputPath = path.join(outputDirectory, "statarb-parity-corpus.json");
fs.writeFileSync(outputPath, JSON.stringify({ generatedBy: "marketpulse", cases }, null, 0));

const byKind: Record<string, { total: number; cointegrated: number }> = {};
for (const item of cases) {
  byKind[item.kind] ??= { total: 0, cointegrated: 0 };
  byKind[item.kind].total += 1;
  if (item.ourVerdict === "COINTEGRATED") byKind[item.kind].cointegrated += 1;
}
console.log(`corpus: ${cases.length} cases → ${outputPath}`);
console.log("our verdicts by kind:", JSON.stringify(byKind));
