/** Reuse eligibility is proved by the governed read, independently of the
 * immutable historical decision. Missing metadata always requires a new read. */
import { z } from "zod";
import { isValidIsoInstant, nonEmptyText, nullablePositiveInt } from "./schemaShared";
import { FOOD_CONTRACT_LIMITS } from "./contracts";

const instant = z.string().refine(isValidIsoInstant);
export const foodKnowledgeValiditySchema = z.strictObject({
  checkedAt: instant,
  validUntil: instant.nullable(),
  userId: nullablePositiveInt,
  resolverVersion: nonEmptyText.max(FOOD_CONTRACT_LIMITS.shortText),
}).refine(value => value.validUntil === null ||
  Date.parse(value.checkedAt) < Date.parse(value.validUntil),
"Knowledge reuse eligibility must end after its governed read.");
export type FoodKnowledgeValidity = z.infer<typeof foodKnowledgeValiditySchema>;

export function isCurrentKnowledgeValidity(
  validity: FoodKnowledgeValidity | undefined,
  now: Date, userId: number | null, resolverVersion: string,
): boolean {
  const parsed = foodKnowledgeValiditySchema.safeParse(validity);
  if (!parsed.success) return false;
  const value = parsed.data;
  const time = now.getTime();
  return Number.isFinite(time) && value.userId === userId &&
    value.resolverVersion === resolverVersion && Date.parse(value.checkedAt) <= time &&
    (value.validUntil === null || time < Date.parse(value.validUntil));
}

/** Include every dependency checked during a read. Taking an earlier bound
 * than the selected dependency is conservative; missing/invalid dates cannot
 * authorize an indefinitely reusable result. */
export function createKnowledgeValidityTracker(
  now: Date, userId: number | null, resolverVersion: string,
) {
  let known = Number.isFinite(now.getTime());
  let until: number | null = null;
  function include(expiry: Date | null | undefined) {
    if (expiry === null) return;
    if (!(expiry instanceof Date) || !Number.isFinite(expiry.getTime())) {
      known = false; return;
    }
    until = until === null ? expiry.getTime() : Math.min(until, expiry.getTime());
  }
  return {
    include,
    includeFutureStart(start: Date | null | undefined) {
      if (start === null) return;
      if (!(start instanceof Date) || !Number.isFinite(start.getTime())) {
        known = false; return;
      }
      if (start.getTime() > now.getTime()) include(start);
    },
    snapshot(): FoodKnowledgeValidity | undefined {
      if (!known) return undefined;
      const parsed = foodKnowledgeValiditySchema.safeParse({
        checkedAt: now.toISOString(), validUntil: until === null ? null : new Date(until).toISOString(),
        userId, resolverVersion,
      });
      return parsed.success ? parsed.data : undefined;
    },
  };
}
