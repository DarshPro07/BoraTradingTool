import { readPaperPortfolio } from "./repository";

export function getPaperRiskSummary() {
  const portfolio = readPaperPortfolio();
  const positionValueByCurrency = new Map<string, number>();
  for (const position of portfolio.positions) {
    const order = portfolio.orders.find((item) => item.instrumentId === position.instrumentId);
    const currency = order?.currency ?? "UNKNOWN";
    positionValueByCurrency.set(
      currency,
      (positionValueByCurrency.get(currency) ?? 0) + position.quantity * position.averageCost,
    );
  }
  return {
    accounts: portfolio.accounts.map((account) => {
      const costExposure = positionValueByCurrency.get(account.currency) ?? 0;
      return {
        currency: account.currency,
        cash: account.cash,
        startingCash: account.startingCash,
        costExposure,
        capitalUtilizationPct: account.startingCash > 0
          ? ((account.startingCash - account.cash) / account.startingCash) * 100
          : 0,
      };
    }),
    openPositions: portfolio.positions.filter((position) => position.quantity > 1e-9).length,
    paperOnly: true,
  };
}
