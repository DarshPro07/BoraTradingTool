"use client";

import { useCallback, useEffect, useState } from "react";
import { Panel } from "@/components/system/Panel";
import { mutationFetch } from "@/lib/client/mutation-fetch";

/**
 * Forward evidence, on screen (workstream 1).
 *
 * Every challenger row answers: how many predictions were written before their outcomes existed,
 * how many the market has since resolved, and how far the forward record sits from the frozen
 * historical baseline it pinned at activation. INSUFFICIENT is the normal early state and is
 * shown as such — forward evidence accumulates at market speed, not at software speed.
 */

interface Scorecard {
  challengerId: string;
  specName: string;
  status: string;
  signals: number;
  resolved: number;
  open: number;
  sessionsObserved: number;
  winRate: number | null;
  meanNetReturn: number | null;
  unpricedOutcomes: number;
  driftScore: number | null;
  verdict: string;
  summary: string;
  policy: { minSignals: number; minSessions: number };
  baseline: { experimentId: string; snapshotId: string | null; trades: number } | null;
  alphaHealth: {
    status: string;
    reasons: string[];
    decay: { shadowVsHistorical: number | null; paperVsShadow: number | null };
    tca: {
      measured: { feeReturnDrag: number | null; entrySlippageReturn: number | null };
      estimated: { missedTradeCostReturn: number | null; method: string };
    };
  } | null;
  paper: {
    startingCash: number;
    cash: number;
    intents: number;
    executed: number;
    rejected: number;
    rejectReasons: Record<string, number>;
    openPositions: number;
    closedPositions: number;
    netPnl: number;
  } | null;
}

export function ForwardEvidencePanel() {
  const [cards, setCards] = useState<Scorecard[] | null>(null);
  const [eligible, setEligible] = useState<{ id: string; name: string }[]>([]);
  const [chosen, setChosen] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // P2: LIVE evaluates at the wall clock; REPLAY evaluates as of a stated instant over the same
  // frozen challengers and immutable stored bars. Replay is a property of a PASS, not of the app
  // — so the mode lives here, at the action, and every result is labelled by the server's own
  // mode/evaluatedAsOf echo rather than by client state.
  const [mode, setMode] = useState<"LIVE" | "REPLAY">("LIVE");
  const [asOfInput, setAsOfInput] = useState("");
  const asOfValid = mode === "LIVE" || !Number.isNaN(new Date(asOfInput).getTime());

  const load = useCallback(() => {
    fetch("/api/forward")
      .then(async (response) => {
        const body = (await response.json()) as { scorecards?: Scorecard[]; eligible?: { id: string; name: string }[] };
        setCards(body.scorecards ?? []);
        setEligible(body.eligible ?? []);
        setChosen((current) => current || body.eligible?.[0]?.id || "");
      })
      .catch((caught) => setNote(caught instanceof Error ? caught.message : "Request failed."));
  }, []);

  useEffect(load, [load]);

  async function post(path: string, payload: object) {
    setBusy(true);
    setNote(null);
    try {
      const response = await mutationFetch(path, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const body = (await response.json()) as {
        message?: string;
        summary?: string;
        mode?: "LIVE" | "REPLAY";
        evaluatedAsOf?: string;
      };
      const text = body.summary ?? body.message ?? (response.ok ? "Done." : `Refused with ${response.status}.`);
      // The label comes from the server's attestation of what actually ran — never from the
      // toggle. A replay result must say so, always; a live result says which instant "now" was.
      const label =
        body.mode === "REPLAY"
          ? `REPLAY — HISTORICAL EVIDENCE as of ${body.evaluatedAsOf} · `
          : body.mode === "LIVE"
            ? `LIVE (wall clock ${body.evaluatedAsOf}) · `
            : "";
      setNote(`${label}${text}`);
      load();
    } catch (caught) {
      setNote(caught instanceof Error ? caught.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="FORWARD EVIDENCE — PREDICTIONS WRITTEN BEFORE THEIR OUTCOMES">
      <div className="p-3 space-y-2 text-[11px]" data-testid="forward-panel">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={chosen}
            onChange={(event) => setChosen(event.target.value)}
            className="bg-background border border-panel px-2 py-1.5 text-xs outline-none focus:border-terminal max-w-[320px] min-w-0 truncate"
            data-testid="forward-activate-spec"
          >
            {eligible.length === 0 ? <option value="">no gauntlet-evaluated strategy awaits activation</option> : null}
            {eligible.map((spec) => (
              <option key={spec.id} value={spec.id}>
                {spec.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={busy || !chosen}
            onClick={() => post("/api/forward/activate", { specId: chosen, confirm: true })}
            className="border border-terminal text-terminal px-3 py-1.5 text-[11px] uppercase tracking-wider hover:bg-terminal/10 disabled:opacity-50"
            data-testid="forward-activate"
          >
            Activate challenger
          </button>
          <button
            type="button"
            disabled={busy || !asOfValid}
            onClick={() => post("/api/forward/run", mode === "REPLAY" ? { asOf: new Date(asOfInput).toISOString() } : {})}
            className="border border-panel px-3 py-1.5 text-[11px] uppercase tracking-wider text-muted-foreground hover:text-foreground disabled:opacity-50"
            data-testid="forward-run"
          >
            {mode === "REPLAY" ? "Run replay pass" : "Run shadow pass"}
          </button>
        </div>

        {/* P2: two explicit modes. REPLAY evaluates the same frozen challengers over the same
            immutable stored bars, as of a stated instant — the watermark still forbids anything
            retroactive, so playback cannot rewrite history. It is real recorded evidence, and it
            is never labelled live. */}
        <div className="flex flex-wrap items-center gap-2" data-testid="forward-mode">
          <button
            type="button"
            aria-pressed={mode === "LIVE"}
            onClick={() => setMode("LIVE")}
            className={`border px-2 py-1 text-[10px] uppercase tracking-wider ${
              mode === "LIVE" ? "border-terminal text-terminal" : "border-panel text-muted-foreground hover:text-foreground"
            }`}
            data-testid="forward-mode-live"
          >
            Live
          </button>
          <button
            type="button"
            aria-pressed={mode === "REPLAY"}
            onClick={() => setMode("REPLAY")}
            className={`border px-2 py-1 text-[10px] uppercase tracking-wider ${
              mode === "REPLAY" ? "border-amber text-amber" : "border-panel text-muted-foreground hover:text-foreground"
            }`}
            data-testid="forward-mode-replay"
          >
            Replay — historical evidence
          </button>
          {mode === "REPLAY" ? (
            <>
              <label htmlFor="forward-asof" className="text-[10px] text-muted-foreground uppercase tracking-wider">
                as of
              </label>
              <input
                id="forward-asof"
                type="datetime-local"
                value={asOfInput}
                onChange={(event) => setAsOfInput(event.target.value)}
                className="bg-background border border-panel px-2 py-1 text-[11px] outline-none focus:border-amber"
                data-testid="forward-asof"
              />
              {!asOfValid ? (
                <span className="text-[10px] text-amber">pick the instant to replay — it never defaults to now</span>
              ) : null}
            </>
          ) : null}
        </div>
        {note ? (
          <p className="text-[10px] text-muted-foreground" data-testid="forward-note">
            {note}
          </p>
        ) : null}

        {cards === null ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : cards.length === 0 ? (
          <p className="text-muted-foreground" data-testid="forward-empty">
            No forward challenger yet. Activation freezes a gauntlet-evaluated strategy version and
            starts recording its signals before their outcomes exist — the only unbiased evidence
            this system can produce.
          </p>
        ) : (
          <ul className="space-y-2">
            {cards.map((card) => (
              <li key={card.challengerId} className="border border-panel/60 px-2 py-1.5" data-testid="forward-challenger-row">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-bold">{card.specName}</span>
                  <span className="text-[9px] uppercase tracking-wider text-muted-foreground">{card.status}</span>
                  <span
                    className={
                      card.verdict === "MEETS_POLICY"
                        ? "text-gain text-[9px] uppercase tracking-wider"
                        : card.verdict === "FAILS_POLICY" || card.verdict === "DRIFTING"
                          ? "text-loss text-[9px] uppercase tracking-wider"
                          : "text-amber text-[9px] uppercase tracking-wider"
                    }
                  >
                    {card.verdict}
                  </span>
                </div>
                <div className="text-[10px] text-muted-foreground" data-testid="forward-scorecard">
                  {card.signals} signal(s) · {card.resolved} resolved · {card.open} open · {card.sessionsObserved}{" "}
                  session(s) (policy: {card.policy.minSignals} over {card.policy.minSessions}) · win{" "}
                  {card.winRate === null ? "n/a" : `${(card.winRate * 100).toFixed(0)}%`} · net/signal{" "}
                  {card.meanNetReturn === null ? "n/a" : `${(card.meanNetReturn * 100).toFixed(3)}%`}
                  {card.unpricedOutcomes > 0 ? ` · ${card.unpricedOutcomes} unpriced` : ""}
                  {card.driftScore !== null ? ` · drift ${card.driftScore.toFixed(2)}` : ""}
                  {card.baseline ? ` · baseline ${card.baseline.experimentId} (${card.baseline.trades} trades)` : " · no per-trade baseline"}
                </div>
                <p className="text-[10px] text-muted-foreground">{card.summary}</p>
                {card.alphaHealth ? (
                  <div className="text-[10px]" data-testid="forward-alpha">
                    <span
                      className={
                        card.alphaHealth.status === "HEALTHY"
                          ? "text-gain"
                          : card.alphaHealth.status === "INSUFFICIENT_EVIDENCE"
                            ? "text-amber"
                            : "text-loss"
                      }
                    >
                      ALPHA {card.alphaHealth.status}
                    </span>
                    <span className="text-muted-foreground">
                      {" "}· decay shadow/hist{" "}
                      {card.alphaHealth.decay.shadowVsHistorical === null
                        ? "n/a"
                        : card.alphaHealth.decay.shadowVsHistorical.toFixed(2)}
                      {" "}· paper/shadow{" "}
                      {card.alphaHealth.decay.paperVsShadow === null ? "n/a" : card.alphaHealth.decay.paperVsShadow.toFixed(2)}
                      {" "}· fees drag{" "}
                      {card.alphaHealth.tca.measured.feeReturnDrag === null
                        ? "unmeasured"
                        : (card.alphaHealth.tca.measured.feeReturnDrag * 100).toFixed(3) + "%"}
                      {" "}· missed-trade cost{" "}
                      {card.alphaHealth.tca.estimated.missedTradeCostReturn === null
                        ? "n/a"
                        : "ESTIMATED " + (card.alphaHealth.tca.estimated.missedTradeCostReturn * 100).toFixed(3) + "%"}
                      {" "}— {card.alphaHealth.reasons[0]}
                    </span>
                  </div>
                ) : null}
                {card.paper ? (
                  <div className="text-[10px] text-muted-foreground" data-testid="forward-paper">
                    PAPER (separate ledger) · start {card.paper.startingCash} · cash{" "}
                    {card.paper.cash.toFixed(2)} · {card.paper.executed} executed /{" "}
                    {card.paper.rejected} rejected
                    {Object.entries(card.paper.rejectReasons)
                      .map(([reason, count]) => ` (${reason} ×${count})`)
                      .join("")}{" "}
                    · {card.paper.closedPositions} closed · net P&L {card.paper.netPnl.toFixed(2)}
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => post("/api/forward/enroll", { challengerId: card.challengerId })}
                    className="border border-panel px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground disabled:opacity-50"
                    data-testid="forward-enroll"
                  >
                    Enroll in paper (real validation capital)
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}
