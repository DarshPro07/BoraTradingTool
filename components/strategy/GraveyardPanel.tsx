import { Panel } from "@/components/system/Panel";
import { StateBody } from "@/components/system/PanelState";
import { listGraveyard } from "@/lib/strategy/graveyard";

/**
 * The strategy graveyard — what died, why, and what it cost.
 *
 * The reel's interface showed a graveyard counter with 244 items and no explanation of any of
 * them. A count is decoration; the reason a strategy failed is the only part with research
 * value, because it is what stops the next candidate repeating it.
 *
 * The rediscovery check that consumes this runs in the rehearsal, before any data is fetched.
 */
export function GraveyardPanel({ limit = 12 }: { limit?: number }) {
  const graves = listGraveyard(limit);

  return (
    <Panel title="GRAVEYARD">
      {graves.length === 0 ? (
        <StateBody
          state="empty"
          reason="Nothing has been rejected yet. This is an observed zero — no strategy has been through the gauntlet and failed — not a missing record."
        />
      ) : (
        <ul className="space-y-1.5 text-xs" data-testid="graveyard">
          {graves.map((grave) => (
            <li key={grave.specId} className="border-b border-panel pb-1.5">
              <div className="flex flex-wrap items-baseline gap-2">
                {/* break-all: generated names are one long unbreakable token, and a name must
                    never widen the page past a phone viewport. */}
                <span className="text-muted-foreground line-through break-all">
                  {grave.name} v{grave.version}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {grave.buriedAt ? grave.buriedAt.toISOString().slice(0, 10) : "date unknown"}
                </span>
                <span className="text-[10px] text-loss">
                  {grave.trialsSpent} trial{grave.trialsSpent === 1 ? "" : "s"} spent
                </span>
              </div>
              {grave.reasons.length > 0 ? (
                <p className="text-[10px] text-muted-foreground mt-0.5 leading-relaxed">
                  {grave.reasons.slice(0, 3).join(" · ")}
                </p>
              ) : (
                <p className="text-[10px] text-amber mt-0.5">
                  No reason recorded. A burial without a cause teaches nothing.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="text-[10px] text-muted-foreground mt-2 leading-relaxed">
        Identity is hashed from the strategy alone, not from the compiler that produced it — so a
        compiler release does not empty the graveyard and let every buried strategy look new.
      </p>
    </Panel>
  );
}
