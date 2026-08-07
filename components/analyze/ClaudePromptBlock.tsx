"use client";

import Link from "next/link";
import { useState } from "react";
import { BrainCircuit, Check, Copy, Terminal } from "lucide-react";

export function ClaudePromptBlock({
  instrumentId,
  symbol,
  price,
  currency,
  signal,
}: {
  instrumentId: string;
  symbol: string;
  price: number;
  currency: "USD" | "INR";
  signal: "buy" | "hold" | "sell";
}) {
  const [copied, setCopied] = useState(false);
  const prompt = `Use the MarketPulse MCP tool marketpulse_get_research_snapshot with instrumentId "${instrumentId}" and format "detailed". Review ${symbol} at ${formatMoney(price, currency)}. The deterministic research signal is ${signal.toUpperCase()}.

Return a cited bull case, bear case, missing evidence, downside risks, and invalidation conditions. If you record the analysis, use the returned evidencePackage.snapshotHash and cite only IDs from that package. Do not create or execute an order.`;

  async function copy() {
    await navigator.clipboard.writeText(prompt);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="terminal-panel p-4">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-terminal" />
          <h2 className="text-xs font-bold text-terminal uppercase tracking-wider">External agent handoff</h2>
        </div>
        <div className="flex gap-2">
          <Link href={`/ai?instrument=${encodeURIComponent(instrumentId)}`} className="secondary-action">
            <BrainCircuit className="w-3.5 h-3.5" /> Open AI Desk
          </Link>
          <button type="button" onClick={copy} className="secondary-action">
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? "Copied" : "Copy MCP prompt"}
          </button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        Claude Code, Codex, or another MCP client can inspect the same bounded evidence through read-only tools.
      </p>
      <pre className="bg-accent rounded p-3 text-xs font-mono text-foreground overflow-x-auto whitespace-pre-wrap border border-border">
        {prompt}
      </pre>
    </div>
  );
}

function formatMoney(value: number, currency: "USD" | "INR") {
  return new Intl.NumberFormat(currency === "USD" ? "en-US" : "en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}
