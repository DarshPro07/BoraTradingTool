import { Bot, Database, Key, ShieldCheck, Terminal } from "lucide-react";
import { AutonomousTradingSettings } from "@/components/settings/AutonomousTradingSettings";
import { isConfigured } from "@/lib/providers";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  const providers = [
    { name: "Yahoo market data", active: true, detail: "Shared US, NSE, and BSE research baseline" },
    { name: "Finnhub enrichment", active: isConfigured(), detail: "Optional US fundamentals, ratings, and news" },
    { name: "Anthropic", active: !!process.env.ANTHROPIC_API_KEY?.trim(), detail: "Optional structured AI research" },
    { name: "OpenAI", active: !!process.env.OPENAI_API_KEY?.trim(), detail: "Optional structured AI research" },
  ];

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">
        <div>
          <p className="terminal-kicker">SYS / CONFIG</p>
          <h1 className="text-xl font-bold mt-1">Settings</h1>
          <p className="text-xs text-muted-foreground mt-2">
            Provider credentials are server environment variables. MarketPulse never writes secrets through HTTP.
          </p>
        </div>

        <section className="bg-panel border border-panel rounded p-6">
          <div className="flex items-center gap-2 mb-4">
            <Database className="w-4 h-4 text-terminal" />
            <h2 className="text-sm font-bold">Provider status</h2>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            {providers.map((provider) => (
              <div key={provider.name} className="border border-border rounded p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold">{provider.name}</span>
                  <span className={provider.active ? "status-dot status-dot-live" : "status-dot"} aria-label={provider.active ? "configured" : "not configured"} />
                </div>
                <p className="text-[11px] text-muted-foreground mt-1">{provider.detail}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="bg-panel border border-panel rounded p-6">
          <div className="flex items-center gap-2 mb-3">
            <Key className="w-4 h-4 text-terminal" />
            <h2 className="text-sm font-bold">Server-only credentials</h2>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Add optional keys to <code className="text-foreground">.env.local</code> yourself, then restart the server.
            Supported names are <code className="text-foreground">FINNHUB_API_KEY</code>,
            <code className="text-foreground"> ANTHROPIC_API_KEY</code>, and
            <code className="text-foreground"> OPENAI_API_KEY</code>. Never paste a key into a browser form.
          </p>
        </section>

        <AutonomousTradingSettings />

        <section className="bg-panel border border-gain/30 rounded p-6">
          <div className="flex items-center gap-2 mb-3">
            <ShieldCheck className="w-4 h-4 text-gain" />
            <h2 className="text-sm font-bold">Execution boundary</h2>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Paper Research Mode is active. No broker adapter, live heartbeat, real portfolio push, bulk approval,
            or Autopilot path is installed. Confirmed Live Mode remains unavailable until a separate broker security review.
          </p>
        </section>

        <section className="bg-panel border border-terminal/20 rounded p-6">
          <div className="flex items-center gap-2 mb-3">
            <Terminal className="w-4 h-4 text-terminal" />
            <h2 className="text-sm font-bold">Claude Code or Codex</h2>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Build the local MarketPulse MCP server with <code className="text-foreground">npm run build:mcp</code>, then
            register <code className="text-foreground">node E:/BoraTradingTool/dist/mcp/server.mjs</code> as a stdio server.
            Its tools are limited to bounded research reads and local knowledge writes. It has no external-write or order capability.
          </p>
          <div className="mt-3 flex items-center gap-2 text-xs text-amber">
            <Bot className="w-3.5 h-3.5" /> Model output is advisory and cannot create an order.
          </div>
        </section>
      </div>
    </div>
  );
}
