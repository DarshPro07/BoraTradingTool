import type { ReactNode } from "react";

export function Panel({
  title,
  action,
  children,
  className = "",
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`terminal-panel ${className}`}>
      <div className="panel-heading flex items-center justify-between gap-2">
        <span>{title}</span>
        {action}
      </div>
      <div className="p-3">{children}</div>
    </section>
  );
}

export function StatTile({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "neutral" | "good" | "bad" | "warn";
}) {
  const toneClass =
    tone === "good" ? "text-gain" : tone === "bad" ? "text-loss" : tone === "warn" ? "text-amber" : "";
  return (
    <div className="stat-tile border border-panel bg-panel-alt px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-xl leading-tight ${toneClass}`}>{value}</div>
      {hint ? <div className="text-[10px] text-muted-foreground mt-0.5">{hint}</div> : null}
    </div>
  );
}

/**
 * Renders the difference between "no data" and "zero" explicitly. Every screen uses this
 * rather than falling back to an empty table, because an empty table reads as a finding.
 */
export function DataState({
  code,
  message,
  source,
}: {
  code: string;
  message: string;
  source?: string | null;
}) {
  const tone =
    code === "RESOURCE_NOT_PROVIDED"
      ? "border-panel text-muted-foreground"
      : code === "RESOURCE_STALE"
        ? "inline-notice-warning"
        : "inline-notice-warning";

  // A degraded screen is still a live screen: it settles in like every other panel, and an
  // unavailable resource keeps a slow amber pulse so the page never looks frozen.
  return (
    <div className={`rise-1 border px-3 py-3 text-xs ${tone}`}>
      <div className="uppercase tracking-wider text-[10px] mb-1 flex items-center gap-2">
        <span className="pulse-amber inline-block w-1.5 h-1.5 rounded-full bg-[var(--amber)]" aria-hidden="true" />
        {code.replace(/_/g, " ")}
      </div>
      <p className="leading-relaxed">{message}</p>
      {source ? <p className="mt-1 text-[10px] text-muted-foreground">source: {source}</p> : null}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="text-xs text-muted-foreground py-4 text-center">{children}</p>;
}

const EPISTEMIC_TONE: Record<string, string> = {
  known: "text-gain",
  historically_observed: "text-gain",
  inferred: "text-amber",
  not_forward_validated: "text-amber",
  conflicting: "text-loss",
  unknown: "text-muted-foreground",
};

export function EpistemicBadge({ status }: { status: string }) {
  return (
    <span
      className={`text-[10px] uppercase tracking-wider border border-panel px-1.5 py-0.5 ${
        EPISTEMIC_TONE[status] ?? "text-muted-foreground"
      }`}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

export function Provenance({
  source,
  generatedAt,
  transport,
  stale,
}: {
  source?: string | null;
  generatedAt?: string | null;
  transport?: string;
  stale?: boolean;
}) {
  return (
    <div className="mt-2 pt-2 border-t border-panel text-[10px] text-muted-foreground flex flex-wrap gap-x-3 gap-y-1">
      {source ? <span>source: {source}</span> : null}
      {generatedAt ? <span>generated: {new Date(generatedAt).toLocaleString()}</span> : null}
      {transport ? <span>via: {transport}</span> : null}
      {stale ? <span className="text-amber">STALE</span> : null}
    </div>
  );
}
