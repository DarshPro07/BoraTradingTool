import {
  applyNseSecurityMasterSync,
  recordNseSecurityMasterFailure,
  securityMasterStatus,
  type NseSecurityMasterSource,
  type SecurityMasterSyncResult,
} from "./security-master";

export const NSE_SECURITY_MASTER_SOURCES = [
  {
    kind: "MAIN",
    url: "https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv",
  },
  {
    kind: "SME",
    url: "https://nsearchives.nseindia.com/emerge/corporates/content/SME_EQUITY_L.csv",
  },
  {
    kind: "ETF",
    url: "https://nsearchives.nseindia.com/content/equities/eq_etfseclist.csv",
  },
  {
    kind: "REIT",
    url: "https://nsearchives.nseindia.com/content/equities/REITS_L.csv",
  },
  {
    kind: "INVIT",
    url: "https://nsearchives.nseindia.com/content/equities/INVITS_L.csv",
  },
] as const;

interface OfficialSyncOptions {
  actor?: string;
  fetcher?: typeof fetch;
  minimumRows?: number;
  now?: () => Date;
  timeoutMs?: number;
}

export type NseSecurityMasterReadiness =
  | {
      ok: true;
      bootstrapped: boolean;
      securityMaster: ReturnType<typeof securityMasterStatus>;
    }
  | {
      ok: false;
      errorCode: Extract<SecurityMasterSyncResult, { ok: false }>["errorCode"];
      message: string;
      securityMaster: ReturnType<typeof securityMasterStatus>;
    };

let bootstrapInFlight: Promise<SecurityMasterSyncResult> | null = null;

export async function syncOfficialNseSecurityMaster(
  options: OfficialSyncOptions = {},
): Promise<SecurityMasterSyncResult> {
  const fetcher = options.fetcher ?? fetch;
  const observedAt = options.now?.() ?? new Date();
  const actor = options.actor ?? "nse-security-master-bootstrap";

  try {
    const sources: NseSecurityMasterSource[] = await Promise.all(
      NSE_SECURITY_MASTER_SOURCES.map(async (source) => {
        const response = await fetcher(source.url, {
          cache: "no-store",
          headers: { "user-agent": "MarketPulse Security Master/1.0" },
          signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
        });
        if (!response.ok) {
          throw new Error(`${source.kind} NSE source returned HTTP ${response.status}.`);
        }
        return { ...source, content: await response.text() };
      }),
    );

    return applyNseSecurityMasterSync({
      observedAt,
      actor,
      sources,
      minimumRows: options.minimumRows ?? 2_500,
      maxDropFraction: 0.2,
    });
  } catch (error) {
    return recordNseSecurityMasterFailure({
      observedAt,
      actor,
      sourceUrls: NSE_SECURITY_MASTER_SOURCES.map((source) => source.url),
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function ensureNseSecurityMasterReady(
  options: OfficialSyncOptions = {},
): Promise<NseSecurityMasterReadiness> {
  const existing = securityMasterStatus();
  // Browser tests seed a small, explicitly disposable master. Never replace that fixture with a
  // live exchange download: doing so makes expected counts network-dependent and can turn an
  // offline UI test into a production ingestion run.
  if (process.env.MARKETPULSE_TEST_MODE === "1" && existing.state !== "UNAVAILABLE") {
    return { ok: true, bootstrapped: false, securityMaster: existing };
  }
  if (existing.state !== "UNAVAILABLE" && existing.missingSourceKinds.length === 0) {
    return { ok: true, bootstrapped: false, securityMaster: existing };
  }

  if (!bootstrapInFlight) {
    bootstrapInFlight = syncOfficialNseSecurityMaster(options).finally(() => {
      bootstrapInFlight = null;
    });
  }
  const result = await bootstrapInFlight;
  const securityMaster = securityMasterStatus();
  if (result.ok && securityMaster.state !== "UNAVAILABLE") {
    return { ok: true, bootstrapped: true, securityMaster };
  }
  if (!result.ok) {
    return {
      ok: false,
      errorCode: result.errorCode,
      message: result.message,
      securityMaster,
    };
  }
  return {
    ok: false,
    errorCode: "MASTER_UNAVAILABLE",
    message: "The official NSE sync completed without a verified security master.",
    securityMaster,
  };
}
