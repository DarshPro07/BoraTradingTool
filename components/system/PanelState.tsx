import { STATE_DESCRIPTORS, type PanelState, type StateTone } from "@/lib/ui/panel-state";

/**
 * One badge, one body, fourteen states — see `lib/ui/panel-state.ts` for why they are distinct.
 *
 * The rule this component exists to enforce: a panel with no data must still say *which kind*
 * of nothing it has. A blank box and a spinner are the two most common ways a terminal reports
 * "everything is fine" when it means "I cannot see".
 */

const TONE_CLASS: Record<StateTone, string> = {
  good: "text-gain border-gain/40",
  warn: "text-amber border-amber/40",
  bad: "text-loss border-loss/40",
  neutral: "text-muted-foreground border-panel",
};

export function StateBadge({ state, detail }: { state: PanelState; detail?: string }) {
  const descriptor = STATE_DESCRIPTORS[state];
  return (
    <span
      className={`inline-flex items-center gap-1 border px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${TONE_CLASS[descriptor.tone]}`}
      title={descriptor.meaning}
      data-testid={`state-${state}`}
      data-state={state}
    >
      {descriptor.label}
      {detail ? <span className="text-muted-foreground normal-case tracking-normal">· {detail}</span> : null}
    </span>
  );
}

/**
 * The body of a panel that has nothing to show.
 *
 * `reason` is the specific cause when one is known; the state's own meaning is the fallback.
 * Never render this with neither — "no data" alone is exactly the message that hides whether
 * the source was consulted.
 */
export function StateBody({
  state,
  reason,
  source,
}: {
  state: PanelState;
  reason?: string;
  source?: string;
}) {
  const descriptor = STATE_DESCRIPTORS[state];
  return (
    <div className="py-4 text-center" data-testid={`state-body-${state}`}>
      <StateBadge state={state} />
      <p className="mt-2 text-[11px] text-muted-foreground leading-relaxed max-w-prose mx-auto">
        {reason ?? descriptor.meaning}
      </p>
      {source ? <p className="mt-1 text-[10px] text-muted-foreground/70">{source}</p> : null}
    </div>
  );
}
