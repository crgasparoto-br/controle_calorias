/** Pure, read-only V1/V2 item matching. No raw identity leaves this module. */
import type { FoodShadowV1Item } from "./shadowV1Snapshot";
import type { FoodResolutionDecision } from "./schemas";

/** Sequential timing integrity shared by producer, replay and direct aggregation. */
export const MAX_SHADOW_TIMING_MS = Math.floor(Number.MAX_SAFE_INTEGER / (10_000 * 1_000));
// Four independently rounded millisecond measurements permit 0.002 ms drift.
const TIMING_ROUNDING_TOLERANCE_MS = 0.002;

export function hasConsistentFoodShadowTimings(timings: {
  v1Ms: number; languageMs: number; resolverMs: number; totalMs: number;
}): boolean {
  const values = [timings.v1Ms, timings.languageMs, timings.resolverMs, timings.totalMs];
  return values.every(value => Number.isFinite(value) && value >= 0 && value <= MAX_SHADOW_TIMING_MS) &&
    timings.v1Ms + timings.languageMs + timings.resolverMs <=
      timings.totalMs + TIMING_ROUNDING_TOLERANCE_MS;
}

/** A replay contains at most 10,000 events; all aggregated counters must stay exact. */
export const MAX_SHADOW_REPLAY_EVENTS = 10_000;
export const MAX_SHADOW_EVENT_COUNT = Math.floor(Number.MAX_SAFE_INTEGER / MAX_SHADOW_REPLAY_EVENTS);
export const MAX_SHADOW_REPLAY_COUNT = MAX_SHADOW_EVENT_COUNT * MAX_SHADOW_REPLAY_EVENTS;

export function boundedShadowCount(value: number, limit = MAX_SHADOW_EVENT_COUNT): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > limit)
    throw new TypeError("invalid-shadow-count");
  return value;
}

/** Refuse malformed events and accumulated values outside the safe-integer envelope. */
export function sumShadowCounts(total: number, next: number): number {
  boundedShadowCount(total, MAX_SHADOW_REPLAY_COUNT);
  boundedShadowCount(next);
  return boundedShadowCount(total + next, MAX_SHADOW_REPLAY_COUNT);
}

export const metric = (n: number): number => Number.isFinite(n) && n >= 0 ? Math.round(n * 1000) / 1000 : 0;
/** Arithmetic bounds for 10,000 events at 0.001 precision, not nutrition SLOs. */
export const MAX_SHADOW_MACRO_EVENT_DELTA = Math.floor(Number.MAX_SAFE_INTEGER / (MAX_SHADOW_REPLAY_EVENTS * 1_000));
export const MAX_SHADOW_MACRO_REPLAY_DELTA = MAX_SHADOW_MACRO_EVENT_DELTA * MAX_SHADOW_REPLAY_EVENTS;

/** Reject overflow and preserve positive differences below display precision. */
export function boundedShadowMacroDelta(value: number, max = MAX_SHADOW_MACRO_EVENT_DELTA): number {
  if (!Number.isFinite(value) || value < 0 || value > max ||
      !Number.isSafeInteger(Math.round(value * 1_000))) {
    throw new TypeError("invalid-shadow-macro-delta");
  }
  const rounded = Math.round(value * 1_000) / 1_000;
  return value > 0 && rounded === 0 ? value : rounded;
}

export function shadowMacroDifference(left: number, right: number): number {
  if (![left, right].every(value =>
    Number.isFinite(value) && value >= 0 && value <= MAX_SHADOW_MACRO_EVENT_DELTA)) {
    throw new TypeError("invalid-shadow-macro-delta");
  }
  return boundedShadowMacroDelta(Math.abs(left - right));
}

/** Numeric integrity ceiling: 10,000 replay events at 1e-8 USD precision. */
const COST_PRECISION = 100_000_000;
export const MAX_SHADOW_EVENT_COST_USD = Math.floor(Number.MAX_SAFE_INTEGER / (MAX_SHADOW_REPLAY_EVENTS * COST_PRECISION));
export const MAX_SHADOW_REPLAY_COST_USD = MAX_SHADOW_EVENT_COST_USD * MAX_SHADOW_REPLAY_EVENTS;

/** Invalid/overflowed costs must never turn into measured zero. */
export function costMetric(n: number): number {
  if (!Number.isFinite(n) || n < 0 || n > MAX_SHADOW_REPLAY_COST_USD)
    throw new TypeError("invalid-shadow-capability-cost");
  const rounded = Math.round(n * COST_PRECISION) / COST_PRECISION;
  return n > 0 && rounded === 0 ? n : rounded;
}
export const abs = (a: number, b: number): number | null => {
  if (!Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b < 0) return null;
  const delta = Math.abs(a - b);
  return Number.isFinite(delta) && delta <= MAX_SHADOW_MACRO_REPLAY_DELTA
    ? boundedShadowMacroDelta(delta, MAX_SHADOW_MACRO_REPLAY_DELTA) : null;
};
const normalize = (s: string | null | undefined) =>
  (s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
export const exactDifference = (a: string | null | undefined, b: string | null | undefined) =>
  normalize(a) !== normalize(b);

/** Immutable historical namespaces must never be collapsed by display names. */
function savedRefId(item: FoodShadowV1Item, prefix: string): number | null {
  const reference = item.historicalRef;
  if (!reference?.startsWith(prefix)) return null;
  const text = reference.slice(prefix.length);
  const id = Number(text);
  return Number.isSafeInteger(id) && id > 0 && String(id) === text ? id : null;
}

/** Only a persisted V2 variant reference shares identity with identity.variantId. */
export function persistedVariantId(item: FoodShadowV1Item): number | null {
  return savedRefId(item, "variant:");
}

/** Persisted foods.id and V2 foodEntityId belong to the same family namespace. */
export function persistedFamilyId(item: FoodShadowV1Item): number | null {
  return savedRefId(item, "food:");
}

/**
 * A lower-cost candidate is only a preference among *compatible* identities.
 * In particular, a family mismatch may not be hidden by identical labels.
 */
function shadowPairCost(left: FoodShadowV1Item, right: FoodResolutionDecision): number {
  const nutrition = right.nutrition.consumed;
  const macroDelta = nutrition ?
    (abs(left.calories, nutrition.calories) ?? 0) +
    (abs(left.protein, nutrition.protein) ?? 0) +
    (abs(left.carbs, nutrition.carbs) ?? 0) +
    (abs(left.fat, nutrition.fat) ?? 0) : 0;
  return (exactDifference(left.canonicalName || left.foodName, right.identity.canonicalName) ? 1000000 : 0) +
    (exactDifference(left.brand, right.identity.brand) ? 1000000 : 0) +
    (exactDifference(left.productVariant, right.identity.variant) ? 1000000 : 0) +
    (exactDifference(left.unit, right.quantity.unit) ? 100000 : 0) +
    (right.quantity.value === null ? 1000 : (abs(left.quantity, right.quantity.value) ?? 1000)) * 1000 +
    (right.quantity.grams === null ? 0 : (abs(left.estimatedGrams, right.quantity.grams) ?? 1000) * 10) +
    macroDelta;
}

type Candidate = { i: number; j: number; cost: number };
type FlowEdge = {
  to: number;
  reverse: number;
  capacity: number;
  cost: number;
  pair?: { i: number; j: number };
};

/**
 * Minimum-cost maximum-cardinality matching, with deterministic index ties.
 * Greedily selecting the cheapest first pair can leave expensive wrong
 * duplicates behind. Residual edges allow an earlier pair to be reassigned.
 * Each pass is bounded by the number of V1/V2 items in this meal.
 */
function optimalPairs(candidates: readonly Candidate[]): Array<{ i: number; j: number }> {
  if (!candidates.length) return [];
  const leftKeys = [...new Set(candidates.map(candidate => candidate.i))].sort((a, b) => a - b);
  const rightKeys = [...new Set(candidates.map(candidate => candidate.j))].sort((a, b) => a - b);
  const leftPositions = new Map(leftKeys.map((key, index) => [key, index]));
  const rightPositions = new Map(rightKeys.map((key, index) => [key, index]));
  const firstLeft = 1;
  const firstRight = firstLeft + leftKeys.length;
  const sink = firstRight + rightKeys.length;
  const source = 0;
  const graph: FlowEdge[][] = Array.from({ length: sink + 1 }, () => []);
  const pairedEdges: FlowEdge[] = [];
  const connect = (from: number, to: number, cost: number, pair?: FlowEdge["pair"]) => {
    const forward: FlowEdge = { to, reverse: graph[to].length, capacity: 1, cost, pair };
    const backward: FlowEdge = { to: from, reverse: graph[from].length, capacity: 0, cost: -cost };
    graph[from].push(forward);
    graph[to].push(backward);
    if (pair) pairedEdges.push(forward);
  };

  for (let i = 0; i < leftKeys.length; i++) connect(source, firstLeft + i, 0);
  for (let j = 0; j < rightKeys.length; j++) connect(firstRight + j, sink, 0);
  for (const candidate of [...candidates].sort((a, b) => a.i - b.i || a.j - b.j)) {
    // The telemetry cost has millesimal precision; keep integral edge costs
    // and bound pathological inputs without turning them into a food decision.
    const cost = Number.isFinite(candidate.cost)
      ? Math.max(0, Math.min(1_000_000_000_000, Math.round(candidate.cost * 1000)))
      : 1_000_000_000_000;
    connect(firstLeft + leftPositions.get(candidate.i)!,
      firstRight + rightPositions.get(candidate.j)!, cost,
      { i: candidate.i, j: candidate.j });
  }

  const potential = Array<number>(graph.length).fill(0);
  while (true) {
    const dist = Array<number>(graph.length).fill(Infinity);
    const previous = Array<number>(graph.length).fill(-1);
    const previousEdge = Array<number>(graph.length).fill(-1);
    const visited = Array<boolean>(graph.length).fill(false);
    dist[source] = 0;

    for (let step = 0; step < graph.length; step++) {
      let from = -1;
      for (let node = 0; node < graph.length; node++) {
        if (!visited[node] && Number.isFinite(dist[node]) &&
            (from < 0 || dist[node] < dist[from])) from = node;
      }
      if (from < 0) break;
      visited[from] = true;
      for (let edgeIndex = 0; edgeIndex < graph[from].length; edgeIndex++) {
        const edge = graph[from][edgeIndex];
        if (!edge.capacity || visited[edge.to]) continue;
        const candidateDistance = dist[from] + edge.cost + potential[from] - potential[edge.to];
        if (candidateDistance < dist[edge.to]) {
          dist[edge.to] = candidateDistance;
          previous[edge.to] = from;
          previousEdge[edge.to] = edgeIndex;
        }
      }
    }
    if (previous[sink] < 0) break;
    for (let node = 0; node < graph.length; node++) {
      if (Number.isFinite(dist[node])) potential[node] += dist[node];
    }
    for (let node = sink; node !== source; node = previous[node]) {
      const from = previous[node];
      const edge = graph[from][previousEdge[node]];
      edge.capacity = 0;
      graph[node][edge.reverse].capacity = 1;
    }
  }
  return pairedEdges.filter(edge => edge.capacity === 0).map(edge => edge.pair!);
}

/**
 * Stable variant IDs take precedence over stable family IDs; legacy catalog
 * references are not a V2 namespace and remain label-only diagnostics.
 * No known family mismatch can become a nutrition pair on label similarity.
 * Within each precedence tier, optimize *all* duplicates jointly.
 */
export function pairFoodShadowItems(
  left: readonly FoodShadowV1Item[], right: readonly FoodResolutionDecision[],
): { pairs: Array<{ left: FoodShadowV1Item; right: FoodResolutionDecision }>; unpairedVariantChanges: number } {
  const usedLeft = new Set<number>();
  const usedRight = new Set<number>();
  const pairs: Array<{ left: FoodShadowV1Item; right: FoodResolutionDecision }> = [];
  const leftVariantIds = left.map(persistedVariantId);
  const leftFamilyIds = left.map(persistedFamilyId);
  const leftNames = left.map(item => normalize(item.canonicalName || item.foodName));
  const rightNames = right.map(item => normalize(item.identity.canonicalName));

  const matchTier = (compatible: (i: number, j: number) => boolean) => {
    const candidates: Candidate[] = [];
    for (let i = 0; i < left.length; i++) {
      if (usedLeft.has(i)) continue;
      for (let j = 0; j < right.length; j++) {
        if (usedRight.has(j) || !compatible(i, j)) continue;
        candidates.push({ i, j, cost: shadowPairCost(left[i], right[j]) });
      }
    }
    for (const { i, j } of optimalPairs(candidates)) {
      usedLeft.add(i);
      usedRight.add(j);
      pairs.push({ left: left[i], right: right[j] });
    }
  };

  matchTier((i, j) => leftVariantIds[i] !== null &&
    leftVariantIds[i] === right[j].identity.variantId);
  matchTier((i, j) => leftFamilyIds[i] !== null &&
    leftFamilyIds[i] === right[j].identity.foodEntityId);

  for (const exactVariant of [true, false]) {
    matchTier((i, j) => {
      // A saved family ID may only pair with that same known V2 family, never
      // fall back to a name when the target family is missing or differs.
      if (leftFamilyIds[i] !== null) return false;
      if (!leftNames[i] || leftNames[i] !== rightNames[j]) return false;
      // Two distinct known variants are not interchangeable, even if their
      // names, quantities and nutrition happen to be identical.
      if (leftVariantIds[i] !== null && right[j].identity.variantId !== null) return false;
      if (exactVariant && (exactDifference(left[i].brand, right[j].identity.brand) ||
        exactDifference(left[i].productVariant, right[j].identity.variant))) return false;
      return true;
    });
  }

  // Known variant changes remain visible without comparing unrelated macros.
  const knownLeftByName = new Map<string, number>();
  for (let i = 0; i < left.length; i++) {
    if (usedLeft.has(i) || leftVariantIds[i] === null) continue;
    const name = leftNames[i];
    if (name) knownLeftByName.set(name, (knownLeftByName.get(name) ?? 0) + 1);
  }
  let unpairedVariantChanges = 0;
  for (let j = 0; j < right.length; j++) {
    if (usedRight.has(j) || right[j].identity.variantId === null) continue;
    const name = rightNames[j];
    const remaining = knownLeftByName.get(name) ?? 0;
    if (!remaining) continue;
    unpairedVariantChanges++;
    knownLeftByName.set(name, remaining - 1);
  }
  return { pairs, unpairedVariantChanges };
}
