import type { CapabilityClass } from "./policy";

/**
 * Owner-reviewed MCP capability boundary. The served tool list must match this manifest
 * exactly; MCP implementation and tests are protected by the write guard.
 */
export const MCP_TOOL_CAPABILITIES: Readonly<Record<string, CapabilityClass>> = Object.freeze({
  marketpulse_search_instruments: "READ",
  marketpulse_get_quote: "READ",
  marketpulse_get_research_snapshot: "READ",
  marketpulse_compare_instruments: "READ",
  marketpulse_get_watchlist: "READ",
  marketpulse_get_paper_portfolio: "READ",
  marketpulse_fund_report: "READ",
  marketpulse_get_risk_summary: "READ",
  marketpulse_quantcore: "READ",
  marketpulse_memory_trace: "READ",
  marketpulse_list_analyses: "READ",
  marketpulse_get_audit: "READ",
  marketpulse_system_status: "READ",
  marketpulse_record_analysis: "WRITE_LOCAL",
  marketpulse_record_source: "WRITE_LOCAL",
  marketpulse_record_claim: "WRITE_LOCAL",
  marketpulse_record_hypothesis: "WRITE_LOCAL",
  marketpulse_record_lesson: "WRITE_LOCAL",
  marketpulse_record_failure: "WRITE_LOCAL",
  marketpulse_enqueue_research: "WRITE_LOCAL",
  marketpulse_research_queue: "READ",
  marketpulse_runtime_status: "READ",
  marketpulse_system_identity: "READ",
  marketpulse_readiness: "READ",
  marketpulse_jobs_list: "READ",
  marketpulse_jobs_get: "READ",
});
