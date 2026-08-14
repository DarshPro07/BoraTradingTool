import { getDb, schema } from "@/lib/db";
import { Panel } from "@/components/system/Panel";
import { StateBody } from "@/components/system/PanelState";
import type { Standing } from "@/lib/strategy/promotion";
import type { Stage } from "@/lib/strategy/lifecycle";

/**
 * The validation funnel — how many strategies stand at or past each rung.
 *
 * Counted from the DERIVED STAGE MACHINE (`standings()`), not from raw tables. The raw-table
 * version could not tell the truth: its REHEARSED bar showed the last cycle's evaluation count —
 * which the rehearsal caps at ten, so the bar read "10" forever on any registry of ten-plus
 * drafts (the cap, presented as a measurement) — and its stage keys bypassed the one component
 * that knows WHY a strategy is where it is. One stage source everywhere, or the page argues
 * with itself.
 */

const LADDER: readonly { at: Stage[]; label: string; note: string }[] = [
  { at: [], label: "AUTHORED", note: "Compiled and stored" },
  { at: ["rehearsed"], label: "REHEARSED", note: "Replay says worth a trial; costs none" },
  { at: ["validated"], label: "VALIDATED", note: "Survived the gauntlet's spent trial" },
  { at: ["holdout_cleared"], label: "HOLDOUT", note: "Cleared the sealed, query-once set" },
  { at: ["paper_forward", "owner_review"], label: "FORWARD", note: "Accumulating paper evidence" },
];

const ORDER: readonly Stage[] = [
  "draft",
  "rehearsed",
  "validated",
  "holdout_cleared",
  "paper_forward",
  "owner_review",
];

export function ValidationFunnel({ standings }: { standings: Standing[] }) {
  if (standings.length === 0) {
    return (
      <Panel title="VALIDATION FUNNEL">
        <StateBody state="empty" reason="No strategies have been authored, so nothing has entered the funnel." />
      </Panel>
    );
  }

  const living = standings.filter((standing) => standing.stage !== "graveyard");
  const buried = standings.length - living.length;
  const rankOf = (stage: Stage) => ORDER.indexOf(stage);

  // Cumulative at-or-past counts: a strategy at paper_forward IS rehearsed and validated — the
  // funnel narrows monotonically by construction, which raw per-table counts never guaranteed.
  const counts = LADDER.map((rung, index) =>
    index === 0
      ? living.length
      : living.filter((standing) => rankOf(standing.stage) >= rankOf(rung.at[0])).length,
  );

  // The typed waiting summary — the blockedOn field that was computed every cycle and rendered
  // nowhere. This line is the funnel's actual answer to "why is it shaped like this".
  const waiting = new Map<string, number>();
  for (const standing of living) {
    if (standing.blockedOn === null) continue;
    waiting.set(standing.blockedOn, (waiting.get(standing.blockedOn) ?? 0) + 1);
  }
  const waitingText = [...waiting.entries()]
    .map(([what, count]) => `${count} on ${what.replace(/_/g, " ")}`)
    .join(" · ");

  // The trial denominator stays from the ledger it lives in — it is a spend count, not a stage.
  const trialsSpent = new Set(
    getDb().select().from(schema.trials).all().map((row) => row.strategySpecId),
  ).size;
  const validated = counts[2];

  const widest = Math.max(1, counts[0]);

  return (
    <Panel title="VALIDATION FUNNEL">
      <div className="space-y-1.5 mb-3" data-testid="validation-funnel">
        {LADDER.map((rung, index) => {
          const count = counts[index];
          const share = count / widest;
          return (
            <div key={rung.label} className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground w-24 shrink-0">
                {rung.label}
              </span>
              <div className="flex-1 h-4 bg-panel-alt border border-panel relative">
                <div
                  className={`h-full ${count === 0 ? "bg-transparent" : "bg-terminal/30"}`}
                  style={{ width: `${Math.max(share * 100, count > 0 ? 3 : 0)}%` }}
                />
                <span className="absolute inset-y-0 left-1.5 flex items-center text-[10px] tabular-nums">
                  {count}
                </span>
              </div>
              <span className="text-[9px] text-muted-foreground w-40 shrink-0">{rung.note}</span>
            </div>
          );
        })}
      </div>

      <p className="text-[10px] text-muted-foreground leading-relaxed" data-testid="funnel-waiting">
        {waitingText ? (
          <>
            <span className="text-amber">Waiting — {waitingText}.</span>{" "}
          </>
        ) : null}
        {validated === 0 && trialsSpent > 0 ? (
          <>
            {trialsSpent} strateg{trialsSpent === 1 ? "y" : "ies"} spent a trial and none passed. That is the
            gauntlet working, not a fault — most profitable-on-screen strategies are rejected.
          </>
        ) : trialsSpent === 0 ? (
          <>
            Nothing has been through the gauntlet. Rehearsal answers &ldquo;is it worth a
            trial?&rdquo; for free; the gauntlet costs one and permanently raises that
            strategy&rsquo;s bar.
          </>
        ) : (
          <>
            {validated} of {trialsSpent} that spent a trial cleared every gate. Passing is a licence
            to gather forward evidence, not a conclusion.
          </>
        )}
        {buried > 0 ? ` ${buried} buried and kept on record so they cannot be rediscovered.` : ""}
      </p>
    </Panel>
  );
}
