/**
 * #1307 / A-004: bounded, read-only replay of previously sanitised C4 telemetry.
 * This is a diagnostic, not an approval verifier or a production event sink.
 */
import { z } from "zod";
import { MAX_SHADOW_REPLAY_EVENTS } from "./shadowPairing";
import { buildFoodShadowBaseline, type FoodShadowEvent } from "./shadowComparison";
import { sanitizedFoodShadowEventSchema } from "./shadowEventValidation";

const replayEnvelope = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("food-v2-sanitized-shadow-events"),
  events: z.array(sanitizedFoodShadowEventSchema).min(1).max(MAX_SHADOW_REPLAY_EVENTS),
}).strict();

/**
 * Never accepts a claimed approval or an accuracy label. No trace IDs or
 * individual events leave this function. The caller must independently prove
 * capture provenance, Gate A, sampling window, oracle and privacy approval.
 */
export function replaySanitizedFoodShadowEvents(raw: unknown) {
  const checked = replayEnvelope.safeParse(raw);
  if (!checked.success) throw new TypeError("invalid-sanitized-shadow-events");
  const ids = new Set<string>();
  for (const event of checked.data.events) {
    if (ids.has(event.traceId)) throw new TypeError("duplicate-shadow-trace-id");
    ids.add(event.traceId);
  }
  const baseline = buildFoodShadowBaseline(checked.data.events as FoodShadowEvent[]);
  return {
    schemaVersion: 1 as const,
    status: "diagnostic-only" as const,
    gateAApproved: false as const,
    sampleProvenanceVerified: false as const,
    baseline,
  };
}
