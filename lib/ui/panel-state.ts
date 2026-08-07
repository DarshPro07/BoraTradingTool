/**
 * The panel state language.
 *
 * From the reel architecture reference (`ui_inventory.md`): *every panel must distinguish
 * loading, streaming, current, delayed, stale, partial, unavailable, unsupported, unauthorized,
 * invalid, compute error, retrying, offline and empty.*
 *
 * That list is not UI polish. Each pair below renders identically in a naive implementation and
 * means something opposite:
 *
 *   empty vs unavailable     — "we looked and there is nothing" vs "we could not look"
 *   unavailable vs unsupported — "not configured here" vs "cannot exist here"
 *   unauthorized vs unavailable — "you lack entitlement" vs "nobody has it"
 *   stale vs delayed         — "should have updated and did not" vs "arrives late by design"
 *   partial vs current       — "some sources answered" vs "all did"
 *   invalid vs compute_error — "the input was wrong" vs "our code failed on good input"
 *
 * A screen that collapses these into a spinner and a blank box tells the operator that nothing
 * is happening, which is the one thing it does not know.
 *
 * This module is deliberately data-only — the states, their severity and their vocabulary. The
 * component that draws them lives in `components/system/PanelState.tsx`.
 */

export const PANEL_STATES = [
  "loading",
  "streaming",
  "current",
  "delayed",
  "stale",
  "partial",
  "unavailable",
  "unsupported",
  "unauthorized",
  "invalid",
  "compute_error",
  "retrying",
  "offline",
  "empty",
] as const;

export type PanelState = (typeof PANEL_STATES)[number];

/** Drives colour and ordering. `neutral` is not "good" — it is "no judgement available". */
export type StateTone = "good" | "warn" | "bad" | "neutral";

export interface StateDescriptor {
  state: PanelState;
  label: string;
  tone: StateTone;
  /** What this state asserts, in one sentence, for a tooltip or an empty-panel body. */
  meaning: string;
  /** True when the panel is showing data the operator may act on. */
  actionable: boolean;
}

export const STATE_DESCRIPTORS: Readonly<Record<PanelState, StateDescriptor>> = Object.freeze({
  loading: {
    state: "loading",
    label: "LOADING",
    tone: "neutral",
    meaning: "The first response has not arrived yet. Nothing is known about the data.",
    actionable: false,
  },
  streaming: {
    state: "streaming",
    label: "LIVE",
    tone: "good",
    meaning: "Updates are arriving continuously and the panel reflects the latest event.",
    actionable: true,
  },
  current: {
    state: "current",
    label: "CURRENT",
    tone: "good",
    meaning: "The data is complete and within its freshness budget.",
    actionable: true,
  },
  delayed: {
    state: "delayed",
    label: "DELAYED",
    tone: "warn",
    meaning: "Arriving late by entitlement, not by fault. The lag is known and expected.",
    actionable: true,
  },
  stale: {
    state: "stale",
    label: "STALE",
    tone: "warn",
    meaning: "Past its freshness budget. It should have updated and did not.",
    actionable: false,
  },
  partial: {
    state: "partial",
    label: "PARTIAL",
    tone: "warn",
    meaning: "Some sources answered and some did not. Totals here are lower bounds, not counts.",
    actionable: false,
  },
  unavailable: {
    state: "unavailable",
    label: "UNAVAILABLE",
    tone: "warn",
    meaning: "This deployment has no source for it. Absence here is not a zero.",
    actionable: false,
  },
  unsupported: {
    state: "unsupported",
    label: "UNSUPPORTED",
    tone: "neutral",
    meaning: "The quantity cannot exist for this instrument or market, so none will ever arrive.",
    actionable: false,
  },
  unauthorized: {
    state: "unauthorized",
    label: "UNAUTHORIZED",
    tone: "warn",
    meaning: "The data exists but this session lacks the entitlement to read it.",
    actionable: false,
  },
  invalid: {
    state: "invalid",
    label: "INVALID",
    tone: "bad",
    meaning: "The input was rejected. Nothing was computed from it.",
    actionable: false,
  },
  compute_error: {
    state: "compute_error",
    label: "COMPUTE ERROR",
    tone: "bad",
    meaning: "The inputs were good and our own computation failed. This is a defect, not a data gap.",
    actionable: false,
  },
  retrying: {
    state: "retrying",
    label: "RETRYING",
    tone: "warn",
    meaning: "A previous attempt failed and another is in flight. What is shown is from before the failure.",
    actionable: false,
  },
  offline: {
    state: "offline",
    label: "OFFLINE",
    tone: "bad",
    meaning: "No connection to the source at all. Nothing shown here is being refreshed.",
    actionable: false,
  },
  empty: {
    state: "empty",
    label: "EMPTY",
    tone: "neutral",
    meaning: "The source answered successfully and returned nothing. This is a real, observed zero.",
    actionable: false,
  },
});

/**
 * The one state pair that must never be confused, kept as an assertion the tests can point at:
 * `empty` is a measured zero, `unavailable` is an unmeasured unknown. Rendering them alike is
 * how a screen reports "no instruments are banned today" when it simply cannot see the ban list.
 */
export function isObservedZero(state: PanelState): boolean {
  return state === "empty";
}

/** Whether the operator may base a decision on what the panel is showing. */
export function isActionable(state: PanelState): boolean {
  return STATE_DESCRIPTORS[state].actionable;
}

/**
 * Worst state across several sources, for a panel that aggregates.
 *
 * Ordered by how badly the panel misleads if the state is ignored, not by how alarming it
 * sounds. `unavailable` outranks `stale`: stale data is wrong about *when*, missing data invites
 * a conclusion drawn from nothing.
 */
const SEVERITY: readonly PanelState[] = [
  "current",
  "streaming",
  "empty",
  "unsupported",
  "delayed",
  "loading",
  "retrying",
  "stale",
  "partial",
  "unauthorized",
  "unavailable",
  "invalid",
  "compute_error",
  "offline",
];

export function worstState(states: readonly PanelState[]): PanelState {
  if (states.length === 0) return "empty";
  return states.reduce((worst, state) =>
    SEVERITY.indexOf(state) > SEVERITY.indexOf(worst) ? state : worst,
  );
}

/**
 * Maps the quant-core contract's refusal codes onto the panel language, so a resource failure
 * and a UI state cannot drift apart.
 */
export function stateFromErrorCode(code: string): PanelState {
  switch (code) {
    case "RESOURCE_NOT_PROVIDED":
      return "unavailable";
    case "QUANT_CORE_UNAVAILABLE":
      return "offline";
    case "RESOURCE_STALE":
      return "stale";
    case "RESOURCE_MALFORMED":
    case "CONTRACT_VERSION_MISMATCH":
      return "invalid";
    case "UNKNOWN_CHECKPOINT":
      return "unsupported";
    default:
      // An unrecognised code is a compute error, never `current`. Defaulting an unknown failure
      // to a healthy state is how a broken panel looks fine.
      return "compute_error";
  }
}
