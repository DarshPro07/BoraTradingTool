import { describe, it, expect } from "vitest";
import { evaluateFence, type OrderIntent, type FenceContext } from "./fence";
import type { AgentConfig, Strategy } from "@/lib/db/schema";
import type { AccountState } from "./robinhood-portfolio";

// --- factories: a fully-open "happy path" context that every lock test mutates ---

function makeConfig(over: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id: 1,
    mode: "autopilot",
    broker: "real",
    halt: false,
    pollMinutes: 10,
    maxPositionPct: 15,
    watchlistOnly: true,
    dailyTradeCap: 5,
    activeStrategyId: 1,
    telegramBotToken: null,
    telegramChatId: null,
    telegramLastOffset: 0,
    robinhoodConnectedAt: new Date(),
    robinhoodAccount: "Agentic",
    updatedAt: new Date(),
    ...over,
  };
}

function makeAccount(over: Partial<AccountState> = {}): AccountState {
  return {
    cash: 10_000,
    equity: 10_000,
    positions: [],
    fresh: true,
    fetchedAt: new Date().toISOString(),
    ...over,
  };
}

function makeCtx(over: Partial<FenceContext> = {}): FenceContext {
  return {
    config: makeConfig(),
    strategy: null,
    account: makeAccount(),
    inWatchlist: true,
    tradesToday: 0,
    robinhoodLive: true,
    priceLive: true,
    executionAvailable: true,
    ...over,
  };
}

const buy = (over: Partial<OrderIntent> = {}): OrderIntent => ({
  ticker: "AAPL",
  side: "buy",
  quantity: 10,
  price: 100, // $1,000 order vs $10k account = 10% (under 15% cap, under cash)
  ...over,
});

describe("evaluateFence — retired live modes", () => {
  it("never authorizes the retired autopilot mode", () => {
    const r = evaluateFence(buy(), makeCtx());
    expect(r.ok).toBe(false);
    expect(r.checks.mode).toEqual({ ok: false, detail: "Live trading mode autopilot is retired" });
  });

  it("never authorizes the retired confirm mode", () => {
    const r = evaluateFence(buy(), makeCtx({ config: makeConfig({ mode: "confirm" }) }));
    expect(r.ok).toBe(false);
    expect(r.checks.mode).toEqual({ ok: false, detail: "Live trading mode confirm is retired" });
  });
});

describe("evaluateFence — gating locks", () => {
  it("blocks when no execution adapter is installed", () => {
    const r = evaluateFence(buy(), makeCtx({ executionAvailable: false }));
    expect(r.ok).toBe(false);
    expect(r.checks.execution).toEqual({ ok: false, detail: "EXECUTION_ADAPTER_MISSING" });
  });

  it("blocks when mode is off", () => {
    const r = evaluateFence(buy(), makeCtx({ config: makeConfig({ mode: "off" }) }));
    expect(r.ok).toBe(false);
    expect(r.checks.mode.ok).toBe(false);
  });

  it("blocks when halted", () => {
    const r = evaluateFence(buy(), makeCtx({ config: makeConfig({ halt: true }) }));
    expect(r.ok).toBe(false);
    expect(r.checks.halt.ok).toBe(false);
  });

  it("blocks when the Robinhood heartbeat is stale", () => {
    const r = evaluateFence(buy(), makeCtx({ robinhoodLive: false }));
    expect(r.ok).toBe(false);
    expect(r.checks.robinhood.ok).toBe(false);
  });

  it("blocks when there is no fresh account snapshot", () => {
    const r = evaluateFence(buy(), makeCtx({ account: makeAccount({ fresh: false }) }));
    expect(r.ok).toBe(false);
    expect(r.checks.account.ok).toBe(false);
  });

  it("blocks when the price is not live (simulated/mock)", () => {
    const r = evaluateFence(buy(), makeCtx({ priceLive: false }));
    expect(r.ok).toBe(false);
    expect(r.checks.priceData.ok).toBe(false);
  });
});

describe("evaluateFence — watchlist", () => {
  it("blocks a buy of a non-watchlist ticker when watchlist-only is on", () => {
    const r = evaluateFence(buy(), makeCtx({ inWatchlist: false }));
    expect(r.ok).toBe(false);
    expect(r.checks.watchlist.ok).toBe(false);
  });

  it("passes the watchlist check when watchlist-only is off but keeps live mode blocked", () => {
    const r = evaluateFence(
      buy(),
      makeCtx({ inWatchlist: false, config: makeConfig({ watchlistOnly: false }) })
    );
    expect(r.ok).toBe(false);
    expect(r.checks.mode.ok).toBe(false);
  });

  it("never blocks a sell on watchlist (exits always allowed)", () => {
    const r = evaluateFence(
      { ticker: "AAPL", side: "sell", quantity: 5, price: 100 },
      makeCtx({ inWatchlist: false, account: makeAccount({ positions: [{ ticker: "AAPL", quantity: 5, marketValue: 500 }] }) })
    );
    expect(r.checks.watchlist.ok).toBe(true);
    expect(r.ok).toBe(false);
    expect(r.checks.mode.ok).toBe(false);
  });
});

describe("evaluateFence — daily cap", () => {
  it("blocks when the daily trade cap is reached", () => {
    const r = evaluateFence(buy(), makeCtx({ tradesToday: 5 }));
    expect(r.ok).toBe(false);
    expect(r.checks.dailyCap.ok).toBe(false);
  });
});

describe("evaluateFence — sizing", () => {
  it("blocks when cost exceeds cash (buying power)", () => {
    const r = evaluateFence(
      buy({ quantity: 200, price: 100 }), // $20k > $10k cash
      makeCtx({ config: makeConfig({ maxPositionPct: 100 }) }) // isolate buying-power
    );
    expect(r.ok).toBe(false);
    expect(r.checks.buyingPower.ok).toBe(false);
  });

  it("blocks when the resulting position exceeds the max-position cap", () => {
    // $2,000 order on a $10,000 account = 20% > 15% cap
    const r = evaluateFence(buy({ quantity: 20, price: 100 }), makeCtx());
    expect(r.ok).toBe(false);
    expect(r.checks.maxPosition.ok).toBe(false);
  });

  it("honors a strategy's tighter maxPositionPct override", () => {
    const strategy = { maxPositionPct: 5 } as Strategy;
    // $1,000 order = 10% of $10k → under config 15% but over strategy 5%
    const r = evaluateFence(buy(), makeCtx({ strategy }));
    expect(r.ok).toBe(false);
    expect(r.checks.maxPosition.ok).toBe(false);
  });

  it("counts an existing holding toward the position cap", () => {
    // already hold $1,300; +$1,000 = $2,300 = 23% > 15%
    const r = evaluateFence(
      buy(),
      makeCtx({ account: makeAccount({ positions: [{ ticker: "AAPL", quantity: 13, marketValue: 1300 }] }) })
    );
    expect(r.ok).toBe(false);
    expect(r.checks.maxPosition.ok).toBe(false);
  });
});

describe("evaluateFence — sells", () => {
  it("blocks selling more than held", () => {
    const r = evaluateFence(
      { ticker: "AAPL", side: "sell", quantity: 10, price: 100 },
      makeCtx({ account: makeAccount({ positions: [{ ticker: "AAPL", quantity: 5, marketValue: 500 }] }) })
    );
    expect(r.ok).toBe(false);
    expect(r.checks.holdings.ok).toBe(false);
  });

  it("blocks selling a ticker not held at all", () => {
    const r = evaluateFence(
      { ticker: "TSLA", side: "sell", quantity: 1, price: 100 },
      makeCtx()
    );
    expect(r.ok).toBe(false);
    expect(r.checks.holdings.ok).toBe(false);
  });

  it("passes the holdings check for a covered sell but keeps live mode blocked", () => {
    const r = evaluateFence(
      { ticker: "AAPL", side: "sell", quantity: 5, price: 100 },
      makeCtx({ account: makeAccount({ positions: [{ ticker: "AAPL", quantity: 5, marketValue: 500 }] }) })
    );
    expect(r.ok).toBe(false);
    expect(r.checks.mode.ok).toBe(false);
  });
});

describe("evaluateFence — reason reporting", () => {
  it("reports the first failed check as the reason", () => {
    const r = evaluateFence(buy(), makeCtx({ config: makeConfig({ mode: "off", halt: true }) }));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("Trading is off"); // mode is evaluated before halt
  });
});
