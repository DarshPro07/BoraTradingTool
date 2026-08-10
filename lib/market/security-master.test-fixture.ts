import { useTemporaryDatabase } from "@/lib/db/testing";
import { applyNseSecurityMasterSync } from "./security-master";

const HEADER =
  "SYMBOL,NAME OF COMPANY,SERIES,DATE OF LISTING,PAID UP VALUE,MARKET LOT,ISIN NUMBER,FACE VALUE";

const ROWS = Array.from({ length: 20 }, (_unused, index) => {
  const number = String(index + 1).padStart(9, "0");
  return `NSE${String(index + 1).padStart(2, "0")},NSE Test Security ${index + 1},EQ,01-JAN-2020,10,1,INE${number},10`;
});

export function useNseSecurityMasterFixture(): void {
  useTemporaryDatabase(() => {
    const result = applyNseSecurityMasterSync({
      observedAt: new Date("2026-08-09T00:00:00Z"),
      actor: "unit-test-nse-fixture",
      minimumRows: 1,
      sources: [
        {
          kind: "MAIN",
          url: "https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv",
          content: [HEADER, ...ROWS].join("\n"),
        },
      ],
    });
    if (!result.ok) throw new Error(result.message);
  });
}
