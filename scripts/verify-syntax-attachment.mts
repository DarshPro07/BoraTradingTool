/**
 * End-to-end proof that the resolver attaches operators correctly on the REAL research corpus.
 *
 * Runs the actual persistent spaCy worker — not a fixture — so it verifies the transport, the
 * explicit-interpreter config, the readiness banner and the attachment walk together.
 *
 *   SYNTAX_PARSER_PYTHON=<path> SYNTAX_PARSER_MODEL=en_core_web_sm \
 *     npx tsx scripts/verify-syntax-attachment.mts
 */
import { SpaCyDependencyResolver } from "../lib/research/syntax/resolver";
import { resolveAttachment } from "../lib/research/syntax/attachment";
import type { ParsedToken } from "../lib/research/syntax/resolver";

const FEATURE_WORDS = [
  "close", "price", "open", "high", "low", "volume",
  "sma", "ema", "wma", "vwap", "rsi", "macd", "atr", "adx", "average",
];

const isFeature = (token: ParsedToken): boolean => {
  const text = token.text.toLowerCase();
  const lemma = token.lemma.toLowerCase();
  return FEATURE_WORDS.some((word) => text.includes(word) || lemma === word);
};

const OPERATORS = ["above", "below", "between", "exceeds", "under", "over"];

// Real prose from live claude-sonnet-5 probes (TCS · RELIANCE · NIFTYBEES · SBIN, 2026-08-11),
// recovered from lib/research/semantic-compiler.test.ts and docs/autonomous-build/FINDINGS.md.
const CASES: { label: string; prose: string; expect: Record<string, string> }[] = [
  {
    label: "NIFTYBEES band-vs-sma (authored 50<=sma20<=70)",
    prose: "Enter when close is above both its 20-day and 50-day SMAs with RSI-14 between 50 and 70.",
    expect: { above: "close", between: "RSI-14" },
  },
  {
    label: "TCS entry",
    prose: "Entry: enter when close is above sma_20 and rsi_14 is between 45 and 65.",
    expect: { above: "close", between: "rsi_14" },
  },
  { label: "TCS exit", prose: "Exit: exit when close falls below sma_50.", expect: { below: "close" } },
  {
    label: "coordination (one subject, two operators)",
    prose: "Enter when close is above SMA20 and below SMA50.",
    expect: { above: "close", below: "close" },
  },
  {
    label: "SBIN band",
    prose: "Enter while RSI-14 is between 55 and 70 and close is above SMA20.",
    expect: { between: "RSI-14", above: "close" },
  },
  {
    label: "feature-to-feature",
    prose: "Enter when the 20-day SMA is above the 50-day SMA.",
    expect: { above: "SMA" },
  },
];

const resolver = SpaCyDependencyResolver.fromEnv();

try {
  const identity = await resolver.health();
  console.log(
    `Syntax Parser  READY  ${identity.parser} ${identity.parserVersion} · ` +
      `${identity.model} ${identity.modelVersion} · python ${identity.python}`,
  );

  let pass = 0;
  let fail = 0;
  let ambiguous = 0;

  for (const testCase of CASES) {
    const parse = await resolver.parse(testCase.prose);
    console.log(`\n${testCase.label}`);

    for (const [operatorText, expectedSubject] of Object.entries(testCase.expect)) {
      const token = parse.tokens.find((candidate) => candidate.text.toLowerCase() === operatorText);
      if (!token) {
        console.log(`  ✗ "${operatorText}" not tokenised`);
        fail += 1;
        continue;
      }

      const result = resolveAttachment(parse, token.index, isFeature);
      if (!result.ok) {
        console.log(`  ~ "${operatorText}" AMBIGUOUS_ATTACHMENT — ${result.reason}`);
        ambiguous += 1;
        continue;
      }

      const got = result.attachment.subject.text;
      const operand = result.attachment.operand?.text ?? "-";
      const bounds = result.attachment.operandConjuncts.map((t) => t.text).join(",");
      if (got.toLowerCase().includes(expectedSubject.toLowerCase())) {
        console.log(`  ✓ ${got} ${operatorText} ${operand}${bounds ? `..${bounds}` : ""}   [${result.attachment.route}]`);
        pass += 1;
      } else {
        console.log(`  ✗ "${operatorText}" -> "${got}", expected "${expectedSubject}"   [${result.attachment.route}]`);
        fail += 1;
      }
    }
  }

  console.log(`\nATTACHED ${pass}  WRONG ${fail}  AMBIGUOUS(refused) ${ambiguous}`);
  // A refusal is a safe outcome; a WRONG attachment is the defect this work exists to remove.
  process.exitCode = fail > 0 ? 1 : 0;
} finally {
  await resolver.dispose();
}
