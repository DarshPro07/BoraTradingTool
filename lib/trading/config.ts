import { eq, desc } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { agentConfig, strategies } from "@/lib/db/schema";
import type { AgentConfig, Strategy } from "@/lib/db/schema";

export type TradingMode = "off" | "confirm" | "autopilot";

/** The singleton agent config row (id = 1). Seeded on first DB open. */
export function getAgentConfig(): AgentConfig {
  const db = getDb();
  const row = db.select().from(agentConfig).where(eq(agentConfig.id, 1)).get();
  if (!row) {
    // Defensive: seedTradingDefaults should have created it.
    db.insert(agentConfig).values({ id: 1, updatedAt: new Date() }).run();
    return db.select().from(agentConfig).where(eq(agentConfig.id, 1)).get()!;
  }
  return row;
}

export type AgentConfigPatch = Partial<
  Pick<
    AgentConfig,
    | "mode"
    | "halt"
    | "pollMinutes"
    | "maxPositionPct"
    | "watchlistOnly"
    | "dailyTradeCap"
    | "activeStrategyId"
  >
>;

export function updateAgentConfig(patch: AgentConfigPatch): AgentConfig {
  const db = getDb();
  getAgentConfig(); // ensure row exists
  db.update(agentConfig)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(agentConfig.id, 1))
    .run();
  return getAgentConfig();
}

export function listStrategies(): Strategy[] {
  return getDb().select().from(strategies).orderBy(desc(strategies.isDefault), strategies.id).all();
}

export function getActiveStrategy(): Strategy | null {
  const cfg = getAgentConfig();
  const db = getDb();
  if (cfg.activeStrategyId != null) {
    const s = db.select().from(strategies).where(eq(strategies.id, cfg.activeStrategyId)).get();
    if (s) return s;
  }
  // Fall back to the default strategy, else the first one.
  return (
    db.select().from(strategies).where(eq(strategies.isDefault, true)).get() ??
    db.select().from(strategies).orderBy(strategies.id).get() ??
    null
  );
}

export function createStrategy(input: {
  name: string;
  prompt: string;
  riskProfile?: string;
  maxPositionPct?: number | null;
}): Strategy {
  const db = getDb();
  const info = db
    .insert(strategies)
    .values({
      name: input.name,
      prompt: input.prompt,
      riskProfile: input.riskProfile ?? "medium",
      maxPositionPct: input.maxPositionPct ?? null,
      isDefault: false,
      createdAt: new Date(),
    })
    .run();
  return db.select().from(strategies).where(eq(strategies.id, Number(info.lastInsertRowid))).get()!;
}

export function updateStrategy(
  id: number,
  patch: Partial<Pick<Strategy, "name" | "prompt" | "riskProfile" | "maxPositionPct">>
): Strategy | null {
  const db = getDb();
  db.update(strategies).set(patch).where(eq(strategies.id, id)).run();
  return db.select().from(strategies).where(eq(strategies.id, id)).get() ?? null;
}

export function deleteStrategy(id: number): boolean {
  const db = getDb();
  const s = db.select().from(strategies).where(eq(strategies.id, id)).get();
  if (!s || s.isDefault) return false; // never delete the default
  db.delete(strategies).where(eq(strategies.id, id)).run();
  // If it was active, clear the pointer so getActiveStrategy falls back.
  const cfg = getAgentConfig();
  if (cfg.activeStrategyId === id) {
    updateAgentConfig({ activeStrategyId: null as unknown as number });
  }
  return true;
}
