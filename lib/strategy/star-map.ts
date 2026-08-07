import { createHash } from "node:crypto";

/**
 * Star Map layout — strategies as constellations, clustered by family.
 *
 * From the reel (frame 1216): a perspective field where each star is one parameterised strategy
 * variant, position encodes family, **brightness encodes screen P&L**, and lines join members of
 * the same family. Hovering names the variant; clicking opens the inspector.
 *
 * Why it earns its place rather than being decoration: a registry table shows twenty rows and
 * hides the shape of the search. The map shows at a glance that a family has sixty variants and
 * two survivors, which is the multiple-testing problem made visible — and that problem is
 * invisible in every list view.
 *
 * Positions are derived from a hash of the strategy id, so the map is **stable across renders**.
 * A layout that moved every reload would make the eye's memory of "the bright one on the left"
 * worthless.
 */

export interface StarInput {
  id: string;
  name: string;
  family: string;
  status: string;
  /** Realised or screen P&L. Null when the strategy has never produced one. */
  pnl: number | null;
  trades: number;
}

export interface Star extends StarInput {
  x: number;
  y: number;
  /** 0..1. Null P&L renders dim rather than dark — unknown is not zero. */
  brightness: number;
  /** True when the strategy was rejected or retired. */
  buried: boolean;
}

export interface Constellation {
  family: string;
  count: number;
  /** Centre of the cluster, for the family label. */
  x: number;
  y: number;
  stars: Star[];
  /** Line segments joining consecutive stars, so a family reads as one shape. */
  links: { x1: number; y1: number; x2: number; y2: number }[];
}

export interface StarMap {
  constellations: Constellation[];
  width: number;
  height: number;
  total: number;
  /** Families with more members than this were the wide searches. */
  largestFamily: number;
  /** True when no strategy has a P&L, so brightness carries no information. */
  brightnessUnavailable: boolean;
}

/** Deterministic 0..1 from a string, so a star keeps its position between renders. */
function jitter(seed: string): number {
  const digest = createHash("sha256").update(seed).digest();
  return ((digest[0] << 8) | digest[1]) / 65_535;
}

const BURIED = new Set(["rejected", "retired", "degraded"]);

export function buildStarMap(
  inputs: readonly StarInput[],
  width = 900,
  height = 420,
): StarMap {
  if (inputs.length === 0) {
    return { constellations: [], width, height, total: 0, largestFamily: 0, brightnessUnavailable: true };
  }

  const byFamily = new Map<string, StarInput[]>();
  for (const input of inputs) {
    const family = input.family || "unfamilied";
    const list = byFamily.get(family);
    if (list) list.push(input);
    else byFamily.set(family, [input]);
  }

  // Brightness is relative to the best result on the board. Scaling each family to its own
  // maximum would make a family of losers look as bright as a family of winners.
  const pnls = inputs.map((input) => input.pnl).filter((value): value is number => value !== null && Number.isFinite(value));
  const peak = pnls.length > 0 ? Math.max(...pnls.map(Math.abs)) : 0;
  const brightnessUnavailable = peak === 0;

  const families = [...byFamily.entries()].sort((a, b) => b[1].length - a[1].length);
  const columns = Math.min(families.length, Math.max(1, Math.ceil(Math.sqrt(families.length))));
  const rows = Math.max(1, Math.ceil(families.length / columns));
  const cellWidth = width / columns;
  const cellHeight = height / rows;

  const constellations: Constellation[] = families.map(([family, members], index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const centreX = cellWidth * (column + 0.5);
    const centreY = cellHeight * (row + 0.5);
    // Radius grows with membership but sub-linearly, so a family of two hundred does not
    // swallow its neighbours.
    const radius = Math.min(cellWidth, cellHeight) * 0.34 * Math.min(1, 0.4 + Math.sqrt(members.length) / 10);

    const stars: Star[] = members.map((member, position) => {
      // Golden-angle spiral: evenly spread without the ring artefacts of a plain circle, and
      // deterministic because it depends only on the member's index and its id.
      const angle = position * 2.399963 + jitter(member.id) * 0.6;
      const distance = radius * Math.sqrt((position + 0.5) / members.length);
      return {
        ...member,
        x: centreX + Math.cos(angle) * distance,
        y: centreY + Math.sin(angle) * distance,
        brightness: brightnessUnavailable || member.pnl === null ? 0.22 : Math.min(1, 0.2 + Math.abs(member.pnl) / peak),
        buried: BURIED.has(member.status),
      };
    });

    return {
      family,
      count: members.length,
      x: centreX,
      y: centreY,
      stars,
      links: stars.slice(1).map((star, position) => ({
        x1: stars[position].x,
        y1: stars[position].y,
        x2: star.x,
        y2: star.y,
      })),
    };
  });

  return {
    constellations,
    width,
    height,
    total: inputs.length,
    largestFamily: Math.max(...families.map(([, members]) => members.length)),
    brightnessUnavailable,
  };
}

/**
 * Family from a strategy name.
 *
 * `sma_cross_20_50` and `sma_cross_10_30` are the same idea at different parameters, and the
 * multiple-testing correction only means anything if they are counted as one search. Trailing
 * numeric segments are the parameters; what remains is the family.
 */
export function familyOf(name: string): string {
  const parts = name.split("_").filter(Boolean);
  const base = parts.filter((part) => !/^\d+(\.\d+)?$/.test(part));
  return (base.length > 0 ? base : parts).join("_") || name;
}
