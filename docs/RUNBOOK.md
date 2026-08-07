# MarketPulse OS — Runbook

## First run

```bash
npm ci
npm run build:mcp     # builds dist/mcp/server.mjs, which .mcp.json points at
npm run dev           # http://127.0.0.1:3000
```

No credentials are required. Providers that need keys report `AUTH_REQUIRED`; nothing is faked unless explicit fixture mode is enabled for development or tests.

The database migrates itself on first open and takes a one-time backup into `.backups/` before
applying v2 migrations to an existing `marketpulse.db`.

## Connecting Claude Code

`.mcp.json` is already configured. In a Claude Code session in this directory, `/mcp` should
show the `marketpulse` server with 20 tools. If it does not:

1. `npm run build:mcp` — the server is a build artifact, not source
2. Check `dist/mcp/server.mjs` exists
3. Restart the Claude Code session

Verify from Claude Code:
```
marketpulse_system_status
```
Expect `learningMode`, `execution: { enabled: false, reason: "EXECUTION_ADAPTER_MISSING" }`, and
a quant-core health block.

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `MARKETPULSE_DB_PATH` | `marketpulse.db` | Database location |
| `MARKETPULSE_AGENT_TOKEN` | unset | ≥32-byte token for non-browser mutations |
| `MARKETPULSE_OWNER_TOKEN` | unset | Distinct ≥32-byte token for owner-only controls |
| `QUANT_CORE_ROOT` | `E:/Trading_BOT` | Python quant core, read-only |
| `QUANT_CORE_URL` | `http://127.0.0.1:8787` | Quant-core HTTP; `off` disables |
| `ANTHROPIC_API_KEY` | unset | Optional, unattended analysis only |
| `OPENAI_API_KEY` | unset | Optional, unattended analysis only |
| `MARKETPULSE_TEST_MODE` | unset | `1` uses deterministic fakes; tests only |

Credentials live in `.env.local`, which is gitignored and which agents cannot read.
Fixture mode additionally requires an explicit disposable `MARKETPULSE_DB_PATH`; startup fails rather
than mixing fixture fills into `marketpulse.db`. Paper-order rows retain quote provider, source,
quality, and a fixture flag.

## Daily operation

1. `/command` — quant-core reachability, gates, forward evidence, queue depth
2. `/data-quality` — is anything stale or not provided?
3. `/scanner` — candidates, with their blockers
4. Analyse in Claude Code; conclusions appear at `/analyst`
5. `/audit` — what was attempted and what was denied

## Learning mode

Set at `/learning` after unlocking owner controls. The owner token creates a 15-minute HttpOnly,
same-site session and is never persisted in browser storage. Agent bearer tokens cannot change the
mode or approve/merge proposals.

| Mode | Runs |
|---|---|
| `off` | Nothing |
| `observing` | Reads state, surfaces what is due |
| `learning` | Also drains the research queue |
| `evolving` | Also prepares proposals for your review |

Eleven actions are prohibited in every mode. Only you can approve or merge a proposal.

Unattended: `POST /api/learning/cycle` on a schedule. It respects the current mode, so a
scheduled call in `off` does nothing.

## Troubleshooting

**Quant core unreachable** — expected when the Python service is down. The bridge falls back to
reading `E:\Trading_BOT\reports\board_history\*_board_packet.json` from disk. Check
`QUANT_CORE_ROOT`. The UI shows an explicit unavailable panel; it never invents values.

**`RESOURCE_NOT_PROVIDED` for universe / regime / trials** — correct. The quant core does not
write those files yet. Open requests are in `E:\Trading_BOT\runtime\bridge\requests\`.

**Jobs stuck in `running`** — a worker died mid-job. Leases expire after five minutes and the
job becomes claimable again. Check `/jobs` for the attempt count.

**An analysis was rejected** — read the message. Most often: a directional stance with only
inferred evidence, an unresolved citation, a mismatched evidence hash, or no invalidation
condition. These are guardrails working. Completed AI and analyst runs retain the exact bounded
evidence package used for the conclusion.

**Hook blocked an edit** — check whether the target is on the protected list in
`lib/governance/paths.ts`. If it genuinely needs changing, do it yourself; the hook constrains
agents, not you. The list includes `lib/trading/capabilities.ts`, which keeps live execution disabled.
MCP source/tests, generated MCP runtime, evidence/proposal enforcement, paper-risk enforcement, the
MCP build entry point, and CI workflows are protected too. Bash is disabled for the autonomous
Claude profile because even apparently read-only Git commands can invoke configured helpers.

## Verification

```bash
npm run check                  # typecheck + tests + build
npm run test:mcp               # spawned stdio MCP integration
npm run test:e2e               # desktop and mobile Chromium flows
npm run audit:prod             # production dependencies, high severity
npx vitest run lib/governance  # guardrails, policy, hooks
```

Prove the guardrails still bite:
```bash
# introduce a violation
printf 'export const x = () => place_equity_order({});\n' > lib/market/probe.ts
npx vitest run lib/governance   # must FAIL
rm lib/market/probe.ts
npx vitest run lib/governance   # must PASS
```

## Two-agent coordination

`E:\Trading_BOT` belongs to the OpenCode agent. Claude cannot write there — a hook blocks it.
Coordination is through `E:\Trading_BOT\runtime\bridge\`:

- `claims/` — check before touching a shared file, skip rather than block
- `requests/` — what Claude needs from the quant core
- `responses/` — what was delivered

## Boundaries

- No broker adapter. `/api/trade/place` returns `EXECUTION_ADAPTER_MISSING`.
- Mutations require loopback plus same-origin plus a CSRF header, or a ≥32-byte agent token.
- Trials, audit events, holdout queries and job history cannot be deleted — enforced by
  database triggers, not convention.
- Only the owner approves or merges an evolution proposal.
