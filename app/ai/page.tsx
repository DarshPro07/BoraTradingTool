import { AiResearchDesk } from "@/components/ai/AiResearchDesk";
import { ShieldCheck } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AiPage({
  searchParams,
}: {
  searchParams: Promise<{ instrument?: string }>;
}) {
  const { instrument } = await searchParams;
  return (
    <div className="max-w-[1800px] mx-auto px-4 py-6 space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="terminal-kicker">INTEL / MODEL REVIEW</p>
          <h1 className="text-xl font-bold mt-1">AI Research Desk</h1>
          <p className="text-xs text-muted-foreground mt-2">Structured model analysis over cited application evidence.</p>
        </div>
        <div className="inline-notice">
          <ShieldCheck className="w-4 h-4 text-gain" />
          <span>Advisory only · no execution capability</span>
        </div>
      </div>
      <AiResearchDesk initialInstrumentId={instrument ?? "US:XNAS:AAPL"} />
    </div>
  );
}
