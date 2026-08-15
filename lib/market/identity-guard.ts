/**
 * The identity invariant — EVERY provider, not one.
 *
 * The worst bug a market-data pipeline can have is not a failed fetch; it is a SUCCESSFUL fetch
 * of the wrong instrument stored under the right name:
 *
 *     requested TCS → received NIFTY → stored as TCS
 *
 * A bar that reaches the canonical store is indistinguishable from history forever after, and
 * every downstream verdict — rehearsal, gauntlet, DSR, sealed holdout, forward, paper — would be
 * computed on a lie that no later test could detect. So the store's write path requires evidence
 * that the data is what was asked for.
 *
 * This is not hypothetical. The probe of `openchart` 0.2.0 on 2026-08-16 found its search
 * endpoint returning the same default index list for EVERY query, while the library's own
 * fallback is "use the first search result" — i.e. requesting TCS and silently receiving
 * NIFTY 50 (recorded in `docs/external/nse-data-connectors.md`). The guard exists so that no
 * connector, present or future, can make that mistake regardless of what its upstream does.
 *
 * ## The three verdicts
 *
 *   MATCHED    the provider stated an identity and it is the one requested — the only verdict
 *              that may silently proceed
 *   MISMATCHED the provider stated a DIFFERENT identity — throws; nothing is stored
 *   UNSTATED   the provider stated no identity at all — proceeds, but the caller must RECORD it
 *              (the ingestion ledger carries this), because "we could not verify" is a fact
 *              about the data, not an absence of one
 *
 * UNSTATED does not throw deliberately: a provider that reports no symbol gives no evidence in
 * EITHER direction, and refusing every such source would be a fabricated certainty of its own.
 * It is made visible instead of silent — which is the same rule this repository applies to
 * unmeasured tokens, unpriceable costs and unreconciled totals.
 */

export type IdentityVerdict = "MATCHED" | "MISMATCHED" | "UNSTATED";

export class IdentityMismatchError extends Error {
  readonly code = "IDENTITY_MISMATCH";
  constructor(
    readonly providerId: string,
    readonly requested: string,
    readonly returned: string,
  ) {
    super(
      `IDENTITY_MISMATCH: ${providerId} was asked for ${requested} and answered for ${returned}. ` +
        "Nothing was stored — a bar written under the wrong instrument is undetectable afterwards.",
    );
    this.name = "IdentityMismatchError";
  }
}

/** Case- and whitespace-insensitive; nothing else. An alias must be an explicit mapping decision. */
function normalize(symbol: string): string {
  return symbol.trim().toUpperCase();
}

/**
 * Compare what was requested against what the provider says it served.
 *
 * THROWS on a stated mismatch. Returns the verdict otherwise, so the caller can record an
 * UNSTATED result rather than assume verification happened.
 */
export function assertProviderIdentity(
  providerId: string,
  requested: string,
  returned: string | null | undefined,
): IdentityVerdict {
  if (returned === null || returned === undefined || returned.trim().length === 0) return "UNSTATED";
  if (normalize(returned) !== normalize(requested)) {
    throw new IdentityMismatchError(providerId, requested, returned.trim());
  }
  return "MATCHED";
}
