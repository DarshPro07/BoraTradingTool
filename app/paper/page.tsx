import { PaperOrderTicket } from "@/components/paper/PaperOrderTicket";
import { LossLedgerPanel } from "@/components/paper/LossLedgerPanel";
import { CostViabilityPanel } from "@/components/paper/CostViabilityPanel";
import { ForwardEvidencePanel } from "@/components/forward/ForwardEvidencePanel";

export const dynamic = "force-dynamic";

export default async function PaperPage({
  searchParams,
}: {
  searchParams: Promise<{ instrument?: string }>;
}) {
  const { instrument } = await searchParams;
  return (
    <div className="max-w-screen-2xl mx-auto px-4 py-6 space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="terminal-kicker">SIM / EXECUTION</p>
          <h1 className="text-xl font-bold mt-1">Paper Portfolio</h1>
          <p className="text-xs text-muted-foreground mt-2">Separate USD and INR capital. No broker capability.</p>
        </div>
        <span className="mode-badge">DETERMINISTIC FILLS</span>
      </div>
      {/* First, because it decides whether anything below it can work. A strategy with a genuine
          edge and a position too small to carry it loses money with perfect discipline. */}
      <CostViabilityPanel />
      {/* Workstream 1: prospective signals and their scorecards — shadow stage, pre-paper. */}
      <ForwardEvidencePanel />
      <LossLedgerPanel />
      <PaperOrderTicket defaultInstrumentId={instrument ?? "US:XNAS:AAPL"} />
    </div>
  );
}
