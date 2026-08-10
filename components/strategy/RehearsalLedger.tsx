import { desc } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { Panel } from "@/components/system/Panel";

/**
 * The rehearsal ledger (13b, owner test 13): every persisted rehearsal verdict WITH the dataset
 * snapshot it was judged on.
 *
 * A verdict without its dataset identity is an opinion; with it, the exact evaluation can be
 * reproduced. Legacy rows from before the manifest era show "pre-manifest" rather than a
 * fabricated id.
 */
export function RehearsalLedger() {
  const rows = getDb()
    .select()
    .from(schema.rehearsalOutcomes)
    .orderBy(desc(schema.rehearsalOutcomes.rehearsedAt))
    .all()
    .slice(0, 12);

  const names = new Map(
    getDb().select().from(schema.strategySpecs).all().map((spec) => [spec.id, spec.name]),
  );

  return (
    <Panel title="REHEARSAL LEDGER — VERDICTS PINNED TO THEIR DATASET">
      <div className="p-3 text-[11px]" data-testid="rehearsal-ledger">
        {rows.length === 0 ? (
          <p className="text-muted-foreground" data-testid="rehearsal-ledger-empty">
            No rehearsal has been persisted yet. The learning cycle writes one per candidate, each
            pinned to the dataset snapshot it was judged on.
          </p>
        ) : (
          <ul className="space-y-1">
            {rows.map((row) => (
              <li key={row.strategySpecId} className="flex flex-wrap items-baseline gap-2" data-testid="rehearsal-ledger-row">
                <span className="font-bold">{names.get(row.strategySpecId) ?? row.strategySpecId}</span>
                <span
                  className={
                    row.verdict === "would_pass" ? "text-gain" : row.verdict === "would_fail" ? "text-loss" : "text-amber"
                  }
                >
                  {row.verdict}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {row.trades} trade(s) · dataset {row.datasetSnapshotId ?? "pre-manifest (no snapshot recorded)"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}
