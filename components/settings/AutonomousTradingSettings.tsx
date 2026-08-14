"use client";

import { useEffect, useState } from "react";
import { Bot, Plus, Save, ShieldCheck, Trash2 } from "lucide-react";
import { mutationFetch } from "@/lib/client/mutation-fetch";

interface Strategy {
  id: number;
  name: string;
  prompt: string;
  riskProfile: "low" | "medium" | "high";
  maxPositionPct: number | null;
  isDefault: boolean;
}

interface Config {
  pollMinutes: number;
  maxPositionPct: number;
  watchlistOnly: boolean;
  dailyTradeCap: number;
  activeStrategyId: number | null;
}

export function AutonomousTradingSettings() {
  const [config, setConfig] = useState<Config | null>(null);
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function load() {
    const [configResponse, strategiesResponse] = await Promise.all([
      fetch("/api/agent/config"),
      fetch("/api/agent/strategies"),
    ]);
    setConfig(await configResponse.json());
    setStrategies(await strategiesResponse.json());
  }

  useEffect(() => {
    void load();
  }, []);

  async function patch(body: Record<string, unknown>) {
    setError("");
    const response = await mutationFetch("/api/agent/config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      setError((await response.json().catch(() => null))?.message ?? "Unable to save policy.");
      return;
    }
    await load();
    setMessage("Research policy saved");
    window.setTimeout(() => setMessage(""), 2500);
  }

  if (!config) return <section className="terminal-panel p-6 text-xs text-muted-foreground">Loading policy...</section>;
  const active = strategies.find((strategy) => strategy.id === config.activeStrategyId) ?? strategies[0] ?? null;

  return (
    <section className="bg-panel border border-terminal/20 rounded p-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Bot className="w-4 h-4 text-terminal" />
            <h2 className="text-sm font-bold text-terminal">Research Agent Policy</h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            These limits shape research and paper proposals. They never authorize a broker order.
          </p>
        </div>
        {message && <span className="text-xs text-gain font-semibold">{message}</span>}
      </div>

      <div className="rounded border border-gain/40 bg-gain/5 p-4 flex gap-3">
        <ShieldCheck className="w-4 h-4 text-gain shrink-0" />
        <div>
          <p className="text-xs font-bold text-gain">Paper Research Mode active</p>
          <p className="text-xs text-muted-foreground mt-1">
            Live execution and Autopilot are unavailable. A future confirmed order stops at
            <code className="mx-1 text-amber">EXECUTION_ADAPTER_MISSING</code>.
          </p>
        </div>
      </div>

      <div className="border border-border p-3 text-xs text-muted-foreground leading-relaxed">
        Policy controls use the local security boundary automatically. No owner token unlock is required;
        broker execution remains disabled and constitutional limits are enforced in domain code.
      </div>

      <div className="space-y-6">
      <div className="grid sm:grid-cols-3 gap-4">
        <NumberField
          label="Refresh interval (min)"
          value={config.pollMinutes}
          min={1}
          max={1440}
          onCommit={(value) => patch({ pollMinutes: value })}
        />
        <NumberField
          label="Max paper position %"
          value={config.maxPositionPct}
          min={0.1}
          max={100}
          step={0.5}
          onCommit={(value) => patch({ maxPositionPct: value })}
        />
        <NumberField
          label="Max paper orders / day"
          value={config.dailyTradeCap}
          min={0}
          max={1000}
          onCommit={(value) => patch({ dailyTradeCap: value })}
        />
      </div>

      <label className="flex items-center gap-2 text-xs cursor-pointer min-h-11">
        <input
          type="checkbox"
          checked={config.watchlistOnly}
          onChange={(event) => void patch({ watchlistOnly: event.target.checked })}
        />
        Restrict opening paper positions to the watchlist
      </label>

      {active && (
        <StrategyEditor
          strategies={strategies}
          active={active}
          activeId={config.activeStrategyId}
          onSelect={(id) => patch({ activeStrategyId: id })}
          onReload={load}
          onMessage={setMessage}
          onError={setError}
        />
      )}
      </div>

      {error && <p role="alert" className="text-xs text-loss">{error}</p>}
    </section>
  );
}

function StrategyEditor({
  strategies,
  active,
  activeId,
  onSelect,
  onReload,
  onMessage,
  onError,
}: {
  strategies: Strategy[];
  active: Strategy;
  activeId: number | null;
  onSelect: (id: number) => void;
  onReload: () => Promise<void>;
  onMessage: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [prompt, setPrompt] = useState(active.prompt);
  const [riskProfile, setRiskProfile] = useState(active.riskProfile);

  useEffect(() => {
    setPrompt(active.prompt);
    setRiskProfile(active.riskProfile);
  }, [active.id, active.prompt, active.riskProfile]);

  async function save() {
    const response = await mutationFetch(`/api/agent/strategies/${active.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, riskProfile }),
    });
    if (!response.ok) return onError("Unable to save strategy.");
    await onReload();
    onMessage("Strategy saved");
  }

  async function add() {
    const response = await mutationFetch("/api/agent/strategies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `Strategy ${strategies.length + 1}`,
        prompt: active.prompt,
        riskProfile: "medium",
      }),
    });
    if (!response.ok) return onError("Unable to add strategy.");
    const created = (await response.json()) as Strategy;
    await onReload();
    onSelect(created.id);
    onMessage("Strategy added");
  }

  async function remove() {
    const response = await mutationFetch(`/api/agent/strategies/${active.id}`, { method: "DELETE" });
    if (!response.ok) return onError("Unable to delete strategy.");
    await onReload();
    onMessage("Strategy deleted");
  }

  return (
    <div className="space-y-2">
      <label htmlFor="strategy-select" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Research strategy
      </label>
      <div className="flex flex-wrap gap-2">
        <select
          id="strategy-select"
          value={activeId ?? active.id}
          onChange={(event) => onSelect(Number(event.target.value))}
          className="min-h-11 flex-1 px-3 bg-accent border border-border rounded text-xs"
        >
          {strategies.map((strategy) => (
            <option key={strategy.id} value={strategy.id}>
              {strategy.name}{strategy.isDefault ? " (default)" : ""}
            </option>
          ))}
        </select>
        <select
          aria-label="Risk profile"
          value={riskProfile}
          onChange={(event) => setRiskProfile(event.target.value as Strategy["riskProfile"])}
          className="min-h-11 px-3 bg-accent border border-border rounded text-xs"
        >
          <option value="low">Low risk</option>
          <option value="medium">Medium risk</option>
          <option value="high">High risk</option>
        </select>
        <button type="button" onClick={add} className="min-h-11 min-w-11 border border-border rounded" aria-label="Add strategy">
          <Plus className="w-4 h-4 mx-auto" />
        </button>
        {!active.isDefault && (
          <button type="button" onClick={remove} className="min-h-11 min-w-11 border border-border rounded text-loss" aria-label="Delete strategy">
            <Trash2 className="w-4 h-4 mx-auto" />
          </button>
        )}
      </div>
      <label htmlFor="strategy-prompt" className="sr-only">Strategy instructions</label>
      <textarea
        id="strategy-prompt"
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        rows={7}
        maxLength={8000}
        className="w-full px-3 py-2 bg-accent border border-border rounded text-xs font-mono leading-relaxed"
      />
      <button type="button" onClick={save} className="min-h-11 px-4 bg-terminal text-black text-xs font-bold rounded inline-flex items-center gap-2">
        <Save className="w-3.5 h-3.5" /> Save research strategy
      </button>
    </div>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  step = 1,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onCommit: (value: number) => void;
}) {
  return (
    <label className="text-xs text-muted-foreground">
      {label}
      <input
        type="number"
        defaultValue={value}
        min={min}
        max={max}
        step={step}
        onBlur={(event) => {
          const next = Number(event.target.value);
          if (Number.isFinite(next) && next !== value) onCommit(next);
        }}
        className="mt-1 min-h-11 w-full px-3 bg-accent border border-border rounded text-foreground font-mono"
      />
    </label>
  );
}
