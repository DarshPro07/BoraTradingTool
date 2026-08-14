/**
 * Test-run verifier — a green exit code is not evidence that anything ran.
 *
 * ## The defect this exists for
 *
 * `npx vitest run --reporter=basic` fails to load (the `basic` reporter was removed in vitest 4),
 * prints `ERR_LOAD_URL`, executes **zero tests**, and **exits 0**. A CI step or a status report
 * quoting a pass count from that invocation would be reporting fiction. The same shape appears
 * whenever a filter matches nothing: "No test files found" is also a zero-test success.
 *
 * Piping to `tail`/`head` has the same effect for a different reason — the shell reports the exit
 * status of the last stage in the pipe, so a run with 51 failures looks like a success.
 *
 * So this refuses to accept a run it cannot account for. It reads vitest's own JSON report and
 * asserts, per §82, that the numbers exist and are sane before anyone is allowed to call it green.
 *
 * Usage:
 *   node --experimental-strip-types scripts/verify-test-run.mts <report.json> [--min-files N]
 *   npx tsx scripts/verify-test-run.mts .tmp/vitest-run.json --min-files 130
 */
import fs from "node:fs";

interface VitestJsonReport {
  numTotalTestSuites?: number;
  numPassedTestSuites?: number;
  numFailedTestSuites?: number;
  numTotalTests?: number;
  numPassedTests?: number;
  numFailedTests?: number;
  numPendingTests?: number;
  success?: boolean;
  startTime?: number;
  testResults?: unknown[];
}

const [, , reportPath, ...rest] = process.argv;

if (!reportPath) {
  console.error("Usage: verify-test-run.mts <report.json> [--min-files N]");
  process.exit(2);
}

const minFilesFlag = rest.indexOf("--min-files");
/**
 * A floor, not an exact count — tests get added, and a verifier that fails on growth would be
 * edited away within a week. It catches the collapse case: a filter typo or a broken config that
 * silently runs three files instead of a hundred and thirty.
 */
const minFiles = minFilesFlag >= 0 ? Number(rest[minFilesFlag + 1]) : 1;

if (!fs.existsSync(reportPath)) {
  console.error(
    `FAIL: no test report at ${reportPath}.\n` +
      "The runner did not produce one, which means it did not complete — this is exactly the " +
      "state that must never read as success.",
  );
  process.exit(1);
}

let report: VitestJsonReport;
try {
  report = JSON.parse(fs.readFileSync(reportPath, "utf8")) as VitestJsonReport;
} catch (caught) {
  console.error(
    `FAIL: ${reportPath} is not readable JSON (${caught instanceof Error ? caught.message : String(caught)}).\n` +
      "An unparseable report cannot support any claim about the suite.",
  );
  process.exit(1);
}

/**
 * `numTotalTestSuites` counts describe BLOCKS, not files — this repo reports 597 of them across
 * 135 files. `testResults` is the per-file array, so it is the honest file count. Reporting the
 * suite count under the label "files" would be the same species of imprecision this script exists
 * to catch.
 */
const files = Array.isArray(report.testResults) ? report.testResults.length : 0;
const suites = report.numTotalTestSuites ?? 0;
const collected = report.numTotalTests ?? 0;
const passed = report.numPassedTests ?? 0;
const failed = report.numFailedTests ?? 0;
const skipped = report.numPendingTests ?? 0;

// §82: every test-command report states these, or it is not a report.
console.log("TEST RUN REPORT");
console.log(`  report      ${reportPath}`);
console.log(`  cwd         ${process.cwd()}`);
console.log(`  files       ${files}`);
console.log(`  suites      ${suites}  (describe blocks, not files)`);
console.log(`  collected   ${collected}`);
console.log(`  passed      ${passed}`);
console.log(`  failed      ${failed}`);
console.log(`  skipped     ${skipped}`);

const problems: string[] = [];

// The headline rule. Zero executed tests is a FAILURE, however green the exit code was.
if (collected === 0) {
  problems.push(
    "0 tests were collected. A suite that runs nothing cannot pass — this is the " +
      "`--reporter=basic` / `no test files found` false green.",
  );
}

if (files < minFiles) {
  problems.push(
    `only ${files} test file(s) ran, below the floor of ${minFiles}. Either a filter is wrong or ` +
      "discovery is broken; a partial run must not be reported as a full one.",
  );
}

if (failed > 0) {
  problems.push(`${failed} test(s) failed.`);
}

// Cross-check the runner's own verdict against the counts, so a report that disagrees with itself
// cannot slip through in either direction.
if (report.success === true && failed > 0) {
  problems.push(`the report claims success while recording ${failed} failure(s).`);
}
if (passed + failed + skipped !== collected) {
  problems.push(
    `the counts do not reconcile: passed(${passed}) + failed(${failed}) + skipped(${skipped}) ` +
      `!== collected(${collected}).`,
  );
}

if (problems.length > 0) {
  console.error("\nFAIL:");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(
  `\nOK: ${passed} passed across ${files} file(s) / ${suites} suite(s), ${failed} failed, ${skipped} skipped.`,
);
