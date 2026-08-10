import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { getLearningMode } from "@/lib/governance/runtime";
import { securityMasterStatus } from "@/lib/market/security-master";

/**
 * The System Readiness contract (mission P0) — ONE authoritative answer to "what works, what is
 * partial, what is missing, why, and which job fixes it".
 *
 * The rule this replaces: screens independently discovering they have no data and printing
 * "insufficient data". A readiness item is never vague — MISSING always names the gap AND the
 * job that closes it. UNAVAILABLE-by-design (no live feed wired yet) is a stated architectural
 * fact, not an error.
 */

export type ReadinessStatus = "READY" | "PARTIAL" | "MISSING" | "UNAVAILABLE";

export interface ReadinessItem {
  area: string;
  status: ReadinessStatus;
  /** What is true right now, with numbers where they exist. */
  detail: string;
  /** Only for PARTIAL/MISSING/UNAVAILABLE: the job or dependency that changes the status. */
  fixedBy?: string;
}

export interface SystemReadiness {
  generatedAt: string;
  learningMode: string;
  items: ReadinessItem[];
  summary: { ready: number; partial: number; missing: number; unavailable: number };
}

export function systemReadiness(): SystemReadiness {
  const db = getDb();
  const items: ReadinessItem[] = [];

  // --- NSE universe ---
  const nseMaster = securityMasterStatus();
  const nseListingLabel = nseMaster.totalRows === 1 ? "security" : "securities";
  const nseMasterDetail = nseMaster.state === "INCOMPLETE"
    ? `${nseMaster.totalRows} currently-listed NSE ${nseListingLabel}; required official sources are missing: ${nseMaster.missingSourceKinds.join(", ")}.`
    : nseMaster.state === "STALE"
    ? `${nseMaster.totalRows} currently-listed NSE ${nseListingLabel} from a stale verified master.`
    : nseMaster.state === "FAILED_LAST_ATTEMPT"
      ? `${nseMaster.totalRows} currently-listed NSE ${nseListingLabel}; the last refresh failed, so the verified master remains in use.`
      : `${nseMaster.totalRows} currently-listed NSE ${nseListingLabel} from the official security master.`;
  items.push(
    nseMaster.state === "UNAVAILABLE"
      ? {
          area: "NSE universe",
          status: "MISSING",
          detail: "No verified NSE security master is available.",
          fixedBy: "Automatic official NSE bootstrap runs on the first NSE search; retry the search or run npm run sync:nse.",
        }
      : {
          area: "NSE universe",
          status: nseMaster.state === "CURRENT" ? "READY" : "PARTIAL",
          detail: nseMasterDetail,
          fixedBy: nseMaster.state === "CURRENT"
            ? undefined
            : "Refresh the official NSE security master; the last verified universe remains available.",
        },
  );

  // --- Historical bar coverage per resolution ---
  const byResolution: { resolution: string; instruments: number; bars: number }[] = [];
  for (const resolution of ["D", "5", "15", "1"]) {
    const rows = db
      .select()
      .from(schema.priceCandles)
      .where(eq(schema.priceCandles.resolution, resolution))
      .all();
    if (rows.length > 0) {
      byResolution.push({ resolution, instruments: new Set(rows.map((row) => row.ticker)).size, bars: rows.length });
    }
  }
  if (byResolution.length === 0) {
    items.push({
      area: "Historical bars",
      status: "MISSING",
      detail: "The canonical store holds no bars at any resolution.",
      fixedBy: "Intraday accumulator (runs each learning cycle) and dataset imports.",
    });
  } else {
    items.push({
      area: "Historical bars",
      status: byResolution.length >= 2 ? "READY" : "PARTIAL",
      detail: byResolution
        .map((entry) => `${entry.resolution === "D" ? "daily" : `${entry.resolution}m`}: ${entry.bars} bars across ${entry.instruments} instrument(s)`)
        .join(" · "),
      fixedBy: byResolution.length >= 2 ? undefined : "Accumulator/import jobs for the missing resolutions.",
    });
  }

  // --- Dataset snapshot freshness ---
  const latestSnapshot = db.select().from(schema.datasetSnapshots).orderBy(desc(schema.datasetSnapshots.createdAt)).limit(1).all()[0];
  items.push(
    latestSnapshot
      ? {
          area: "Dataset snapshots",
          status: "READY",
          detail: `${db.select().from(schema.datasetSnapshots).all().length} immutable snapshot(s); latest ${latestSnapshot.id} (${latestSnapshot.market} ${latestSnapshot.resolution}, ${latestSnapshot.barCount} bars).`,
        }
      : {
          area: "Dataset snapshots",
          status: "MISSING",
          detail: "No dataset snapshot recorded yet.",
          fixedBy: "Any research run (inspection/rehearsal/gauntlet) creates one from the store.",
        },
  );

  // --- Live feed ---
  items.push({
    area: "Live feed",
    status: "UNAVAILABLE",
    detail: "No streaming live feed is wired; quotes come from the provider on request, research from the canonical store.",
    fixedBy: "Engine lane: provider websocket ingestion (queued behind broker/data work). REPLAY mode covers demos meanwhile.",
  });

  // --- India sector indices (P1) ---
  items.push({
    area: "NSE sector indices",
    status: "MISSING",
    detail: "Nifty sector index series (Bank, IT, Auto, FMCG, Pharma, Metal, Realty, Telecom, …) are not ingested, so the India overview cannot show sector performance.",
    fixedBy: "Engine lane P1 job: ingest Nifty sectoral index quotes/history into the canonical store.",
  });

  // --- India VIX / pre-market context ---
  items.push({
    area: "India VIX & pre-market context",
    status: "MISSING",
    detail: "India VIX, GIFT Nifty and pre-open state are not ingested.",
    fixedBy: "Engine lane P1/M job: pre-market context ingestion.",
  });

  // --- Corporate events ---
  items.push({
    area: "Corporate events",
    status: "MISSING",
    detail: "Earnings/results/corporate-action calendar is not ingested.",
    fixedBy: "Engine lane job: corporate-events ingestion from licensed/official sources.",
  });

  // --- Research & strategies ---
  const specs = db.select().from(schema.strategySpecs).all();
  const validated = specs.filter((spec) => ["validated", "paper_challenger"].includes(spec.status)).length;
  items.push({
    area: "Strategy registry",
    status: specs.length > 0 ? "READY" : "MISSING",
    detail: `${specs.length} strategy version(s); ${validated} past the gauntlet.`,
    fixedBy: specs.length > 0 ? undefined : "Author one via the hypothesis composer or Studio.",
  });

  const challengers = db.select().from(schema.forwardChallengers).all();
  const paperAccounts = db.select().from(schema.paperForwardAccounts).all();
  items.push({
    area: "Forward & paper evidence",
    status: challengers.length > 0 ? "READY" : "PARTIAL",
    detail: `${challengers.filter((row) => row.status === "ACTIVE").length} active challenger(s), ${paperAccounts.length} paper account(s). Evidence accumulates at market speed.`,
    fixedBy: challengers.length > 0 ? undefined : "Activate a challenger from a gauntlet-evaluated strategy on /paper.",
  });

  // --- Knowledge ---
  const sources = db.select().from(schema.knowledgeSources).all().length;
  const hypotheses = db.select().from(schema.researchHypotheses).all().length;
  items.push({
    area: "Knowledge base",
    status: sources + hypotheses > 0 ? "READY" : "PARTIAL",
    detail: `${sources} research source(s), ${hypotheses} hypothesis(es).`,
    fixedBy: sources + hypotheses > 0 ? undefined : "Research intake (learning cycle) or manual hypothesis entry.",
  });

  const summary = { ready: 0, partial: 0, missing: 0, unavailable: 0 };
  for (const item of items) {
    if (item.status === "READY") summary.ready += 1;
    else if (item.status === "PARTIAL") summary.partial += 1;
    else if (item.status === "MISSING") summary.missing += 1;
    else summary.unavailable += 1;
  }

  return { generatedAt: new Date().toISOString(), learningMode: getLearningMode(), items, summary };
}
