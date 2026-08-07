import { Panel } from "@/components/system/Panel";
import { DERIVABLE_FEATURES } from "@/lib/backtest/features";
import { UNSUPPORTED_BY_ENGINE, LOOKAHEAD_FEATURES } from "@/lib/strategy/dsl";

/**
 * What a strategy may reference, and what it may reference but never test.
 *
 * Shown where strategies are authored because the alternative is what actually happened: two
 * specs referencing `market_cap` and `sector_relative_strength` compiled cleanly, sat in `draft`
 * for weeks, and were only revealed as untestable when the autonomous rehearsal tried to replay
 * them and returned `FEATURE_NOT_AVAILABLE`.
 */
export function FeatureSupportPanel() {
  return (
    <Panel title="FEATURE SUPPORT">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-gain mb-1.5">
            Derivable from price data · {DERIVABLE_FEATURES.length}
          </div>
          <div className="flex flex-wrap gap-1" data-testid="derivable-features">
            {DERIVABLE_FEATURES.map((feature) => (
              <span key={feature} className="border border-panel bg-panel-alt px-1.5 py-0.5 text-[10px]">
                {feature}
              </span>
            ))}
          </div>
        </div>

        <div>
          <div className="text-[10px] uppercase tracking-wider text-amber mb-1.5">
            Permitted, but no engine here supplies them · {UNSUPPORTED_BY_ENGINE.length}
          </div>
          <div className="flex flex-wrap gap-1 mb-2" data-testid="unsupported-features">
            {UNSUPPORTED_BY_ENGINE.map((feature) => (
              <span key={feature} className="border border-amber/40 bg-panel-alt px-1.5 py-0.5 text-[10px] text-amber">
                {feature}
              </span>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            A strategy using these compiles and is a legitimate idea — the gap is in the data, not
            the strategy. It simply cannot be backtested until a source supplies them, so the
            compiler now says so at authoring time instead of at replay time.
          </p>
        </div>
      </div>

      <div className="mt-3 pt-3 border-t border-panel">
        <div className="text-[10px] uppercase tracking-wider text-loss mb-1.5">
          Rejected outright — they encode the future · {LOOKAHEAD_FEATURES.length}
        </div>
        <div className="flex flex-wrap gap-1" data-testid="lookahead-features">
          {LOOKAHEAD_FEATURES.map((feature) => (
            <span key={feature} className="border border-loss/30 px-1.5 py-0.5 text-[10px] text-loss/80">
              {feature}
            </span>
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground mt-1.5 leading-relaxed">
          These fail compilation rather than producing a warning. A strategy referencing them
          would be tested against information it could not have had, and every result it produced
          would be meaningless.
        </p>
      </div>
    </Panel>
  );
}
