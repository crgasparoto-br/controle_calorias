/**
 * #1304 — leitura de léxico governado V2, independente de alias/decisão nutricional.
 * Falha de banco, proprietário inválido ou revisão divergente = fail-closed.
 */
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb } from "../../db";
import { foodLexiconEntries, userFoodLexiconEntries } from "../../../drizzle/food-intelligence-v2-schema";
import type { GovernedLexiconEntry, LinguisticLexiconStore } from "./linguisticComprehension";

type SnapshotInput = { locale: "pt-BR"; ownerUserId: number | null; now: Date };

export async function readGovernedLinguisticLexicon(input: SnapshotInput): Promise<{
  revision: string;
  entries: GovernedLexiconEntry[];
}> {
  if (input.ownerUserId !== null &&
      (!Number.isSafeInteger(input.ownerUserId) || input.ownerUserId <= 0) ||
      Number.isNaN(input.now.getTime())) throw new Error("invalid-lexicon-scope");
  const db = await getDb();
  if (!db) throw new Error("governed-lexicon-unavailable");
  const global = await db.select().from(foodLexiconEntries).where(and(
    eq(foodLexiconEntries.locale, input.locale),
    eq(foodLexiconEntries.currentSlot, 1),
    eq(foodLexiconEntries.status, "verified"),
  )).limit(5001);
  const personal = input.ownerUserId === null ? [] : await db
    .select().from(userFoodLexiconEntries).where(and(
      eq(userFoodLexiconEntries.userId, input.ownerUserId),
      eq(userFoodLexiconEntries.locale, input.locale),
      eq(userFoodLexiconEntries.currentSlot, 1),
      eq(userFoodLexiconEntries.status, "active"),
      eq(userFoodLexiconEntries.source, "user_confirmed"),
    )).limit(5001);
  if (global.length + personal.length > 5000) throw new Error("governed-lexicon-size-limit");

  const rows: GovernedLexiconEntry[] = [];
  for (const item of global) {
    if (item.validFrom && item.validFrom > input.now ||
        item.validTo && item.validTo <= input.now) continue;
    rows.push({
      id: item.id, term: item.term, normalizedTerm: item.normalizedTerm,
      kind: item.kind, targetType: item.targetType, targetRef: item.targetRef,
      scope: "global", userId: null, source: null, locale: item.locale,
      status: item.status, confidence: item.confidence,
      requiresClarification: item.requiresClarification === 1,
      current: item.currentSlot === 1, validFrom: item.validFrom, validTo: item.validTo,
    });
  }
  for (const item of personal) {
    // A claim of "confirmed" without confirmation evidence is not a personal preference.
    if (!item.confirmedAt || item.revokedAt) continue;
    rows.push({
      id: item.id, term: item.term, normalizedTerm: item.normalizedTerm,
      kind: item.kind, targetType: item.targetType, targetRef: item.targetRef,
      scope: "user", userId: item.userId, source: item.source, locale: item.locale,
      status: item.status, confidence: item.confidence,
      requiresClarification: false, current: item.currentSlot === 1,
      validFrom: item.confirmedAt, validTo: null,
    });
  }
  rows.sort((a, b) => a.scope.localeCompare(b.scope) ||
    a.normalizedTerm.localeCompare(b.normalizedTerm) ||
    a.kind.localeCompare(b.kind) || a.id - b.id);
  // This hash is a snapshot revision, not a credential or anonymization.
  // Owner is included to prevent cross-user replay even with identical vocabulary.
  const revision = createHash("sha256").update(JSON.stringify({
    locale: input.locale, ownerUserId: input.ownerUserId,
    rows: rows.map(({ id, term, normalizedTerm, kind, targetType, targetRef,
      scope, userId, source, status, confidence, requiresClarification,
      current, validFrom, validTo }) => ({
        id, term, normalizedTerm, kind, targetType, targetRef, scope,
        userId, source, status, confidence, requiresClarification,
        current, validFrom: validFrom?.toISOString() ?? null,
        validTo: validTo?.toISOString() ?? null,
      })),
  })).digest("hex");
  return { revision, entries: rows };
}

/**
 * Requires an exact lexicon revision pinned by the authorized operation
 * envelope. A revocation/change between reads invalidates the request instead
 * of silently replaying an old personal or global alias.
 */
export const governedLinguisticLexiconStore: LinguisticLexiconStore = {
  async load(input) {
    const result = await readGovernedLinguisticLexicon(input);
    if (result.revision !== input.revision) throw new Error("stale-governed-lexicon-revision");
    return result.entries;
  },
};
