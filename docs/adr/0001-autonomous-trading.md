# ADR 0001 — Autonomous Trading (Confirm Mode / Autopilot Mode)

Status: Superseded by ADR 0003. Historical context only; not an operating guide.

Date: 2026-06-14

## Context

MarketPulse's Agent Layer (Claude Code) can already research stocks and, with the
Robinhood MCP, place trades interactively with per-trade human confirmation. The user
asked for the Agent Layer to be able to trade **on its own**, on a schedule, without a
human present — while keeping a safe default. This ADR records the design decisions
resolved in a grilling session before any code was written.

## Decisions

1. **Two mutually-exclusive Trading Modes, defaulting to safe.**
   - **Confirm Mode (default):** agent forms an order, notifies the human, and waits for
     explicit approval before the order reaches the broker. This restates the existing
     "never place without confirmation" rule as the default rather than negating it.
   - **Autopilot Mode (opt-in):** agent places trades itself and notifies after.
   - Exactly one mode is active at a time. They never run in parallel. A single switch
     (in the app's setup) flips between them.

2. **Both modes ride one Scheduled Research System.** The agent, running in the terminal,
   self-wakes every ~30 minutes (market hours), refreshes context, evaluates the active
   Strategy, and decides. The mode only changes what happens *after* a trade is decided —
   ask (Confirm) or place (Autopilot). "Scheduled" and "event/price" triggers both collapse
   into "conditions evaluated each wake," so there is **no separate always-on watcher
   process** to build.

3. **Every order is authorized + recorded through the Guarded Order Tool; execution differs by
   account.** Real-money trades execute via the **Robinhood MCP**, which lives in the agent's
   Claude Code session — the app cannot reach into it. So the app cannot be a literal
   forwarding proxy for real money. Instead:
   - **Paper:** the app executes the fill itself → enforcement is *hard* (unbypassable).
   - **Real:** the agent must `POST /api/trade/place` first; the endpoint runs the fence/mode/
     halt checks and records the order. Only on `authorized` does the agent call the Robinhood
     MCP `placeOrder`, then report the fill back (`POST /api/trade/:id/fill`). Enforcement is
     *protocol-hard* (CLAUDE.md forbids placing without an `authorized`) but cooperative, not
     physically impossible. Making real-money enforcement truly hard would require giving the
     **app** the Robinhood OAuth instead of the agent — explicitly out of scope; the user wants
     trading to run through their own MCP session.

   New order state **`authorized`**: fence-cleared, awaiting the agent's MCP placement + fill
   report.

   **MCP Heartbeat gate (real money only).** The real account, arming, and real-order placement
   require a live Robinhood MCP connection. Since the app can't see the agent's MCP session, the
   agent verifies the MCP and posts a timestamped heartbeat (`/api/agent/robinhood/heartbeat`);
   the connection is "live" only within a 10-minute freshness window. The gate is enforced in
   two places: the config endpoint refuses to select/arm real without a live heartbeat, and the
   Trade Fence re-checks liveness at placement time (so a heartbeat going stale after arming
   still blocks real orders — `realArmed` stored true is not sufficient). Paper trading needs no
   heartbeat. Scope was chosen as **real-money-only**, not the whole section: the paper sandbox
   stays usable with no MCP, since the app fills paper itself.

4. **Trade Fence is configurable and code-enforced.** Default: **max 15% of account per
   position**, medium risk, watchlist-only, a daily trade cap, paper account. Every limit is
   editable in setup, including removing it. (This overrides the old 5%-per-trade example in
   `CLAUDE.md`, which becomes the *default value of a configurable limit*, not a constant.)

5. **Strategy is an editable prompt + its limits.** A Default Strategy (medium-risk, 15% cap)
   ships; users can edit it or add their own Strategy prompts and pick the active one.

6. **Autopilot action set:** open new positions, add/trim existing, fully exit, and set/honor
   stop-losses autonomously.

7. **Notification + approval over Telegram.** A Telegram bot is the Notification Channel:
   free, self-hosted, and two-way — it both sends proposals/receipts and reads the human's
   approve/reject reply. Confirm Mode also surfaces proposals on an in-app **Pending Trades**
   screen (the push deep-links there). SMS was rejected because a two-way return path needs a
   paid service (Twilio) and a phone number.

8. **Paper by default.** Real-money trading stays off until the human explicitly arms it.

9. **Kill switch.** Flipping the mode to Off / toggling Halt freezes placement; the Guarded
   Order Tool re-reads the live mode + Halt immediately before every order, and the wake loop
   checks them each cycle.

## Rejected alternatives

- **Fully autonomous with the raw broker MCP and no app authorization step.** Placing via the
  Robinhood MCP without first clearing the order through `/api/trade/place` makes the fence
  bypassable and leaves no audit record. Rejected: the agent must always authorize + record
  through the app first, even though real execution is the agent's MCP.
- **App holds the Robinhood OAuth so it can forward real orders itself** (truly hard
  enforcement for real money). Rejected per the user: trading goes through their own Claude
  Code MCP session, not app-held broker credentials.
- **Wake-and-wait cancel window** (place unless cancelled within N minutes) and **purely
  interactive Confirm Mode**: superseded by Confirm-Mode-over-Telegram, which fits the
  unattended, self-waking model.
- **App spawning headless agents on price events:** heavier (app owns process-spawning + the
  Agent SDK) and unnecessary once triggers collapse into per-wake condition checks.

## Consequences

- New Local Database tables: agent config (singleton), strategies, paper positions/cash,
  and an orders/audit log that doubles as the Pending Trades queue.
- New guarded API surface: `/api/trade/place` (authorize + record), `/api/trade/:id/fill`
  (agent reports a real fill), pending-trade approve/reject, agent config + strategy CRUD, and
  a research-refresh endpoint for the wake loop.
- `CLAUDE.md` trading rules updated: authorize via `/api/trade/place` first; paper fills
  in-app; real orders place via the Robinhood MCP only on `authorized`, then report the fill.
- Paper execution is complete and fully enforced. Real execution runs through the agent's
  Robinhood MCP, gated by the app's authorization + the `realArmed` flag.
