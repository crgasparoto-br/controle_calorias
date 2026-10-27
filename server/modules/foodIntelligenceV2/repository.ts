/**
 * #1302 / B2 — Drizzle-backed governed knowledge adapter. This is the only
 * storage-facing reader for V2 food identities and profiles. Not wired into
 * the V1 entrypoints until the ADR's shadow/cutover gates.
 */
import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { foodAliases, foodBrands, foodPortions, foodSources, foods } from "../../../drizzle/schema";
import {
  foodBarcodes, foodEvidence, foodNutritionProfiles, foodSourceReadGrants, foodVariantSources,
  foodVariants, userFoodAliases,
} from "../../../drizzle/food-intelligence-v2-schema";
import { normalizeFoodName } from "../../../scripts/import-foods/normalize_food_name";
import { canReadFoodSource, canPersistProvisionalEvidence, canPublishGlobalKnowledge, isAuthorizedSourceReference, isValidHttpsSourceReference } from "./sourceGrants";
import { isGovernedFamilyVisible, eligibleCommercialProfileProofScope, hasCurrentBarcodeProof, isTrustedBrandlessSelection } from "./knowledgeEligibility";
import { isExternalFoodAssertionConsistent, isNutritionFacts } from "./knowledgeRead";
import { foodPortionSnapshotSchema, type GovernedFoodPortion } from "./portionProvenance";
import { getDb } from "../../db";
import type {
  ExternalProvisionalCandidate, FoodKnowledgeLocalResult, FoodKnowledgeRequest,
  FoodKnowledgeStore, GovernedFoodMatch, NutritionFacts,
} from "./knowledgeRead";

const MAX_CANDIDATES = 30;
type V2Database = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type MatchType = GovernedFoodMatch["matchingEvidence"];

const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const at = (request: FoodKnowledgeRequest) => request.now ?? new Date();
const currentlyValid = (from: Date | null, to: Date | null, now: Date) =>
  (!from || from.getTime() <= now.getTime()) &&
  (!to || to.getTime() > now.getTime());


function evidenceCacheKey(request: FoodKnowledgeRequest) {
  // Keyed by the specific user, policy/resolver revision and exact query.
  // Hashes are identifiers, not anonymization or authorization.
  return "v2cache:" + hash({
    u: request.userId,
    n: request.normalizedName,
    b: request.brand ?? null,
    e: request.barcode ?? null,
    resolver: request.resolverVersion,
    policy: request.policyVersion,
  });
}

async function readApprovedSource(
  db: V2Database, sourceId: number, now: Date, requireGlobalPublication = false,
) {
  const [row] = await db.select({
    source: foodSources,
    grant: foodSourceReadGrants,
  }).from(foodSources)
    .innerJoin(foodSourceReadGrants, eq(foodSourceReadGrants.sourceId, foodSources.id))
    .where(eq(foodSources.id, sourceId))
    .limit(1);
  if (
    !row ||
    !canReadFoodSource(row.grant, row.source.version, now) ||
    (requireGlobalPublication && !canPublishGlobalKnowledge(row.grant, row.source.version, now))
  ) return null;
  return row;
}

async function eligibleVariant(
  db: V2Database, variantId: number, request: FoodKnowledgeRequest, match: MatchType,
) {
  const [row] = await db.select({
    variant: foodVariants, family: foods, brand: foodBrands,
  }).from(foodVariants)
    .innerJoin(foods, eq(foodVariants.foodId, foods.id))
    .leftJoin(foodBrands, eq(foodVariants.brandId, foodBrands.id))
    .where(eq(foodVariants.id, variantId))
    .limit(1);
  if (!row || row.variant.status !== "active" ||
      row.variant.governanceStatus === "rejected" ||
      row.variant.governanceStatus === "revoked" ||
      row.family.status !== "active" ||
      !isGovernedFamilyVisible(row.family.scope, row.family.ownerUserId, request.userId)) return null;

  if (request.brand?.trim()) {
    if (!row.brand || normalizeFoodName(row.brand.name) !== normalizeFoodName(request.brand)) {
      return null;
    }
  } else if (row.variant.variantType === "branded" &&
             !isTrustedBrandlessSelection(match, request.barcode)) {
    // Brandless input does not silently resolve to one commercial SKU.
    return null;
  }
  return row;
}

/** An explicit food name accompanying a barcode is another identity claim,
 * not decorative text. Permit only the same governed variant/family or a
 * still-authorized alias; never silently ignore a contradictory name. */
async function barcodeNameIsCompatible(
  db: V2Database,
  request: FoodKnowledgeRequest,
  row: NonNullable<Awaited<ReturnType<typeof eligibleVariant>>>,
): Promise<boolean> {
  const name = normalizeFoodName(request.normalizedName);
  if (!name) return true;
  if ([row.variant.normalizedName, row.family.normalizedName].some(
    known => typeof known === "string" && normalizeFoodName(known) === name,
  )) return true;

  if (request.userId !== null) {
    const personal = await db.select({ id: userFoodAliases.foodVariantId })
      .from(userFoodAliases).where(and(
        eq(userFoodAliases.userId, request.userId),
        eq(userFoodAliases.foodVariantId, row.variant.id),
        eq(userFoodAliases.normalizedAlias, name),
        eq(userFoodAliases.source, "user_confirmed"),
        eq(userFoodAliases.status, "active"),
      )).limit(1);
    if (personal.length === 1) return true;
  }
  if (row.family.scope !== "global") return false;
  const aliases = await db.select().from(foodAliases).where(and(
    eq(foodAliases.foodVariantId, row.variant.id),
    eq(foodAliases.normalizedAlias, name),
    eq(foodAliases.status, "active"),
    eq(foodAliases.governanceStatus, "verified"),
  )).limit(MAX_CANDIDATES + 1);
  if (aliases.length > MAX_CANDIDATES) return false;
  for (const alias of aliases) {
    if (alias.foodId !== row.family.id || !alias.sourceVersion || !alias.sourceId) continue;
    const approval = await readApprovedSource(db, alias.sourceId, at(request), true);
    if (approval?.source.version === alias.sourceVersion) return true;
  }
  return false;
}

async function readCurrentProfile(
  db: V2Database, variantId: number, request: FoodKnowledgeRequest,
  variantType: "generic" | "branded" | "custom",
  familyScope: "global" | "user" | null,
): Promise<{ profile: typeof foodNutritionProfiles.$inferSelect; sourceId: number; sourceVersion: string; sourceReference: string; personalEvidence: boolean } | "conflict" | null> {
  // An explicit commercial assertion needs same-product nutritional proof
  // even when a stored variant was classified as generic or custom.
  const commercial = variantType === "branded" ||
    !!request.brand?.trim() || !!request.barcode?.trim();
  const rows = await db.select().from(foodNutritionProfiles)
    .where(eq(foodNutritionProfiles.foodVariantId, variantId))
    .limit(MAX_CANDIDATES + 1);
  if (rows.length > MAX_CANDIDATES) return "conflict";

  const usable: Array<{
    profile: typeof foodNutritionProfiles.$inferSelect;
    sourceId: number;
    sourceVersion: string;
    sourceReference: string;
    personalEvidence: boolean;
  }> = [];
  for (const profile of rows) {
    if (profile.currentSlot !== 1 ||
        (profile.status !== "verified" && profile.status !== "provisional") ||
        !currentlyValid(profile.validFrom, profile.validTo, at(request))) continue;
    const permission = await readApprovedSource(db, profile.sourceId, at(request), familyScope === "global");
    // A freshly approved grant does not certify older source-version macros.
    // Unversioned B1/legacy rows are ineligible until explicitly reviewed.
    if (!permission || !profile.sourceVersion ||
        profile.sourceVersion !== permission.source.version) continue;
    const [mapping] = profile.foodVariantSourceId === null
      ? [null]
      : await db.select().from(foodVariantSources)
        .where(eq(foodVariantSources.id, profile.foodVariantSourceId)).limit(1);
    // An explicit but retired/broken mapping invalidates the profile.
    if (profile.foodVariantSourceId !== null &&
        (!mapping || mapping.status !== "active" ||
          mapping.foodVariantId !== variantId || mapping.sourceId !== profile.sourceId)) continue;
    let personalEvidence = false;
    if (commercial) {
      const proofs = await db.select().from(foodEvidence)
        .where(and(
          eq(foodEvidence.foodVariantId, variantId),
          eq(foodEvidence.sourceId, profile.sourceId),
        )).limit(MAX_CANDIDATES + 1);
      if (proofs.length > MAX_CANDIDATES) continue;
      const proofScope = eligibleCommercialProfileProofScope(
        {
          variantId, sourceId: profile.sourceId, mapping,
          sourceUrl: permission.source.sourceUrl,
          sourceVersion: permission.source.version,
          nutrition: {
            basisQuantity: profile.basisQuantity, basisUnit: profile.basisUnit,
            caloriesKcal: profile.caloriesKcal, proteinG: profile.proteinG,
            carbG: profile.carbG, fatG: profile.fatG,
          },
        },
        proofs, at(request), familyScope === "user" ? "user" : "global", request.userId,
      );
      if (!proofScope) continue;
      personalEvidence = proofScope === "personal";
    }
    // A license reference proves permission, never nutritional provenance.
    // Exact commercial mapping already passed the same-SKU proof above.
    const sourceReference = commercial
      ? mapping?.sourceUrl : permission.source.sourceUrl;
    if (!isValidHttpsSourceReference(sourceReference)) continue;
    usable.push({
      profile, sourceId: permission.source.id,
      sourceVersion: permission.source.version,
      sourceReference, personalEvidence,
    });
  }
  if (usable.length === 0) return null;

  const verified = usable.filter(row => row.profile.status === "verified");
  const eligible = verified.length ? verified : usable;
  // Do not adjudicate conflicting strong sources via latest timestamp/write.
  const nutritionalSignatures = new Set(eligible.map(row =>
    hash([
      row.profile.basisQuantity, row.profile.basisUnit, row.profile.caloriesKcal,
      row.profile.proteinG, row.profile.carbG, row.profile.fatG,
    ])
  ));
  if (nutritionalSignatures.size !== 1) return "conflict";
  eligible.sort((a, b) => a.profile.id - b.profile.id);
  return eligible[0];
}

async function portionsFor(
  db: V2Database, variantId: number, familyId: number, request: FoodKnowledgeRequest,
  familyScope: "global" | "user" | null,
): Promise<GovernedFoodMatch["portions"]> {
  const rows = await db.select().from(foodPortions)
    .where(eq(foodPortions.foodVariantId, variantId))
    .limit(50);
  const result: GovernedFoodPortion[] = [];
  for (const portion of rows) {
    // The two independent foreign keys do not guarantee that a portion's
    // family is the family owning the selected variant. Never return a
    // serving measure from another food, even if its variant ID matches.
    if (portion.foodId !== familyId || portion.foodVariantId !== variantId ||
        (portion.status !== "verified" && portion.status !== "provisional") ||
        !currentlyValid(portion.validFrom, portion.validTo, at(request)) ||
        !portion.sourceId || !portion.sourceVersion ||
        !Number.isFinite(portion.grams) || portion.grams <= 0) continue;
    const approvedPortionSource = await readApprovedSource(
      db, portion.sourceId, at(request), familyScope === "global",
    );
    if (!approvedPortionSource ||
        portion.sourceVersion !== approvedPortionSource.source.version) continue;
    // Preserve the actual record and its approved source; never borrow the profile source.
    const snapshot = foodPortionSnapshotSchema.safeParse({
      portionId: portion.id, foodEntityId: portion.foodId, variantId: portion.foodVariantId,
      label: portion.label, unit: portion.unit, quantity: portion.quantity, grams: portion.grams,
      measureKind: portion.measureKind, confidence: portion.confidence,
      sourceId: portion.sourceId, sourceVersion: portion.sourceVersion,
      sourceReference: approvedPortionSource.source.sourceUrl,
      sourcePortionCode: portion.sourcePortionCode, evidenceId: portion.evidenceId,
      status: portion.status,
      validFrom: portion.validFrom?.toISOString() ?? null,
      validTo: portion.validTo?.toISOString() ?? null,
      updatedAt: portion.updatedAt?.toISOString(),
    });
    if (snapshot.success) result.push(snapshot.data);
  }
  return result;
}

export function createFoodV2KnowledgeRepository(): FoodKnowledgeStore {
  return {
    async readLocal(request): Promise<FoodKnowledgeLocalResult> {
      const db = await getDb();
      if (!db) throw new Error("Governed Food V2 database unavailable");

      const name = request.normalizedName.trim();
      const groups: Array<{ match: MatchType; ids: number[]; identitySourceId?: number; barcodeEvidenceOwnerUserId?: number | null; matchedBarcode?: string; aliasFamilyIds?: Map<number, number> }> = [];
      if (request.barcode?.trim()) {
        const barcodeRows = await db.select().from(foodBarcodes)
          .where(eq(foodBarcodes.barcode, request.barcode.trim())).limit(MAX_CANDIDATES + 1);
        if (barcodeRows.length !== 1) return { kind: "miss", reason: "incompatible_evidence" };
        const barcode = barcodeRows[0];
        if (barcode.status !== "active" || !barcode.sourceId || !barcode.evidenceId) {
          return { kind: "miss", reason: "incompatible_evidence" };
        }
        const source = await readApprovedSource(db, barcode.sourceId, at(request));
        if (!source) return { kind: "miss", reason: "incompatible_evidence" };
        const [proof] = await db.select().from(foodEvidence)
          .where(eq(foodEvidence.id, barcode.evidenceId)).limit(1);
        // A barcode assertion must independently bind the same commercial
        // product resource and source item, not merely the source homepage.
        const mappings = await db.select().from(foodVariantSources)
          .where(and(
            eq(foodVariantSources.foodVariantId, barcode.foodVariantId),
            eq(foodVariantSources.sourceId, barcode.sourceId),
            eq(foodVariantSources.status, "active"),
          )).limit(2);
        if (mappings.length !== 1 || !hasCurrentBarcodeProof(
          proof, request.barcode.trim(), barcode.foodVariantId, barcode.sourceId,
          source.source.sourceUrl, mappings[0], request.userId, at(request),
          source.source.version,
        )) {
          return { kind: "miss", reason: "incompatible_evidence" };
        }
        groups.push({
          match: "barcode", ids: [barcode.foodVariantId], identitySourceId: barcode.sourceId,
          barcodeEvidenceOwnerUserId: proof?.ownerUserId,
          matchedBarcode: barcode.barcode,
        });
      } else if (name) {
        // Personal confirmation takes precedence over a homonymous generic
        // exact name, but must never override an explicitly supplied brand.
        if (request.userId !== null && !request.brand?.trim()) {
          const personal = await db.select({ id: userFoodAliases.foodVariantId })
            .from(userFoodAliases)
            .where(and(
              eq(userFoodAliases.userId, request.userId),
              eq(userFoodAliases.normalizedAlias, name),
              eq(userFoodAliases.status, "active"),
              eq(userFoodAliases.source, "user_confirmed"),
            )).limit(MAX_CANDIDATES + 1);
          groups.push({ match: "personal_alias", ids: personal.map(row => row.id) });
        }
        const exact = await db.select({ id: foodVariants.id }).from(foodVariants)
          .where(eq(foodVariants.normalizedName, name)).limit(MAX_CANDIDATES + 1);
        groups.push({ match: "exact_variant", ids: exact.map(row => row.id) });
        const global = await db.select().from(foodAliases)
          .where(and(eq(foodAliases.normalizedAlias, name), eq(foodAliases.status, "active")))
          .limit(MAX_CANDIDATES + 1);
        const licensedGlobalIds: number[] = [];
        const aliasFamilyIds = new Map<number, number>();
        for (const alias of global) {
          if (!alias.foodVariantId || alias.governanceStatus !== "verified" ||
              !alias.sourceId || !alias.sourceVersion) continue;
          // A current grant cannot silently re-approve an alias asserted by an
          // older source revision. Unversioned V1 aliases remain ineligible.
          const approval = await readApprovedSource(db, alias.sourceId, at(request), true);
          if (approval?.source.version !== alias.sourceVersion) continue;
          licensedGlobalIds.push(alias.foodVariantId);
          aliasFamilyIds.set(alias.foodVariantId, alias.foodId);
        }
        groups.push({ match: "global_alias", ids: licensedGlobalIds, aliasFamilyIds });
        if (!request.brand?.trim()) {
          const familyRows = await db.select({ id: foodVariants.id }).from(foodVariants)
            .innerJoin(foods, eq(foods.id, foodVariants.foodId))
            .where(and(eq(foods.normalizedName, name), eq(foodVariants.variantType, "generic")))
            .limit(MAX_CANDIDATES + 1);
          groups.push({ match: "generic_family", ids: familyRows.map(row => row.id) });
        }
      }

      for (const group of groups) {
        if (group.ids.length > MAX_CANDIDATES ||
            (group.match === "personal_alias" && new Set(group.ids).size > 1)) {
          return { kind: "conflict", reason: "multiple_identities" };
        }
        const matches: GovernedFoodMatch[] = [];
        for (const id of new Set(group.ids)) {
          const row = await eligibleVariant(db, id, request, group.match);
          if (!row) continue;
          // food_aliases retains a V1 food_id as well as the V2 variant FK.
          // Reject a mismatched family instead of borrowing another food's macros.
          if (group.match === "global_alias" && group.aliasFamilyIds?.get(id) !== row.family.id) continue;
          // A globally shared barcode cannot derive its identity from private
          // user evidence, even when its source is licensed for publication.
          // Private variants may continue to use their own owner-bound proof.
          if (group.match === "barcode" && row.family.scope === "global" &&
              group.barcodeEvidenceOwnerUserId !== null) {
            return { kind: "miss", reason: "incompatible_evidence" };
          }
          if (group.match === "barcode" && !await barcodeNameIsCompatible(db, request, row)) {
            return { kind: "conflict", reason: "multiple_identities" };
          }
          // A globally visible barcode identity also needs permission to
          // publish the barcode's source, independently of the macro profile.
          if (group.identitySourceId && row.family.scope === "global" &&
              !await readApprovedSource(db, group.identitySourceId, at(request), true)) continue;
          const profileResult = await readCurrentProfile(
            db, id, request, row.variant.variantType, row.family.scope,
          );
          if (profileResult === "conflict") {
            return { kind: "conflict", reason: "material_nutrition_conflict" };
          }
          if (!profileResult) continue;
          const p = profileResult.profile;
          const profileValues: NutritionFacts = {
            caloriesKcal: p.caloriesKcal, proteinG: p.proteinG, carbG: p.carbG,
            fatG: p.fatG, basisQuantity: p.basisQuantity, basisUnit: p.basisUnit,
          };
          matches.push({
            kind: "match", matchingEvidence: group.match,
            foodId: row.family.id, variantId: id, profileId: p.id,
            variantName: row.variant.displayName,
            // Return the stored identity that passed the governance checks,
            // never manufacture commercial proof from the request assertions.
            matchedBrand: row.brand?.name ?? null,
            matchedBarcode: group.matchedBarcode ?? null,
            sourceId: profileResult.sourceId, sourceVersion: profileResult.sourceVersion,
            sourceReference: profileResult.sourceReference,
            nutrition: profileValues,
            governanceStatus: p.status === "verified" &&
              row.variant.governanceStatus === "verified" &&
              !profileResult.personalEvidence ? "verified" : "provisional",
            portions: await portionsFor(db, id, row.family.id, request, row.family.scope),
          });
        }
        if (matches.length > 1) return { kind: "conflict", reason: "multiple_identities" };
        if (matches.length === 1) return matches[0];
        // An existing confirmed personal alias already fixes identity. If its
        // variant/profile is revoked, expired or unavailable, never borrow
        // macros from a same-name variant or an external cache/provider.
        if (group.match === "personal_alias" && group.ids.length > 0) {
          return { kind: "miss", reason: "no_governed_profile" };
        }
        if (request.barcode?.trim()) {
          return { kind: "miss", reason: "incompatible_evidence" };
        }
      }
      return { kind: "miss", reason: "not_found" };
    },

    async readPendingEvidence(request) {
      if (request.userId === null) return null;
      const db = await getDb();
      if (!db) throw new Error("Governed Food V2 evidence store unavailable");
      const rows = await db.select().from(foodEvidence).where(and(
        eq(foodEvidence.ownerUserId, request.userId),
        eq(foodEvidence.subjectKey, evidenceCacheKey(request)),
        eq(foodEvidence.evidenceType, "external_source"),
      )).limit(MAX_CANDIDATES + 1);
      if (rows.length > MAX_CANDIDATES) return null;
      const candidates: ExternalProvisionalCandidate[] = [];
      for (const row of rows) {
        if (!row.sourceId || !row.retentionUntil || !(row.capturedAt instanceof Date)) continue;
        const now = at(request);
        const source = await readApprovedSource(db, row.sourceId, now);
        const retentionDays = source?.grant.retentionDays;
        if (!source || !canPersistProvisionalEvidence(source.grant, source.source.version, now) ||
            retentionDays == null) continue;
        // The CURRENT source policy applies to the ORIGINAL capture, not the
        // last cache hit or replay. A shortened policy invalidates old entries
        // immediately even when their persisted TTL is still in the future.
        const capturedAt = row.capturedAt.getTime();
        const persistedUntil = row.retentionUntil.getTime();
        if (!Number.isFinite(capturedAt) || !Number.isFinite(persistedUntil) ||
            capturedAt > now.getTime() ||
            now.getTime() >= Math.min(persistedUntil, capturedAt + retentionDays * 86400000)) continue;
        try {
          const payload = JSON.parse(row.payloadJson) as {
            status?: unknown; sourceVersion?: unknown; sourceReference?: unknown;
            nutrition?: NutritionFacts; policyVersion?: unknown; resolverVersion?: unknown;
            identity?: ExternalProvisionalCandidate["identity"];
          };
          // A matching cache key is not enough: rehash the fetched evidence.
          if (row.contentHash !== hash(payload) ||
              payload.status !== "provisional" ||
              payload.sourceVersion !== source.source.version ||
              payload.policyVersion !== request.policyVersion ||
              payload.resolverVersion !== request.resolverVersion ||
              typeof payload.sourceReference !== "string" ||
              row.sourceReference !== payload.sourceReference ||
              !isAuthorizedSourceReference(payload.sourceReference, source.source.sourceUrl) ||
              !payload.nutrition || !isNutritionFacts(payload.nutrition)) continue;
          const candidate: ExternalProvisionalCandidate = {
            sourceId: row.sourceId, sourceReference: payload.sourceReference,
            nutrition: payload.nutrition, ...(payload.identity === undefined ? {} : { identity: payload.identity }),
          };
          if (!isExternalFoodAssertionConsistent(request, candidate)) continue;
          candidates.push(candidate);
        } catch { /* Invalid legacy JSON is never silently trusted. */ }
      }
      const signatures = new Set(candidates.map(c => hash(c)));
      if (signatures.size > 1) return { kind: "conflict" as const };
      return signatures.size === 1 ? candidates[0] : null;
    },

    async stagePendingEvidence(request, candidate) {
      if (request.userId === null || !isNutritionFacts(candidate.nutrition) ||
          !isExternalFoodAssertionConsistent(request, candidate)) return false;
      const db = await getDb();
      if (!db) return false;
      const now = new Date();
      const source = await readApprovedSource(db, candidate.sourceId, now);
      const days = source?.grant.retentionDays;
      if (!source || !canPersistProvisionalEvidence(source.grant, source.source.version, now) || !days) return false;
      // Exact provenance, not just a same-brand/website heuristic.
      if (!isAuthorizedSourceReference(candidate.sourceReference, source.source.sourceUrl)) return false;

      const payload = {
        status: "provisional" as const, sourceVersion: source.source.version,
        sourceReference: candidate.sourceReference,
        resolverVersion: request.resolverVersion, policyVersion: request.policyVersion,
        nutrition: candidate.nutrition,
        ...(candidate.identity === undefined ? {} : { identity: candidate.identity }),
      };
      const subjectKey = evidenceCacheKey(request);
      const contentHash = hash(payload);
      const payloadJson = JSON.stringify(payload);
      const retentionUntil = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
      await db.insert(foodEvidence).values({
        subjectKey,
        evidenceType: "external_source",
        sourceId: candidate.sourceId,
        ownerUserId: request.userId,
        contentHash,
        sourceReference: candidate.sourceReference,
        payloadJson,
        retentionUntil,
      }).onDuplicateKeyUpdate({ set: {
        // Replays cannot restart a retention clock measured from first capture.
        // A shortened grant can only reduce the original deadline.
        retentionUntil: sql`LEAST(${foodEvidence.retentionUntil}, DATE_ADD(${foodEvidence.capturedAt}, INTERVAL ${days} DAY))`,
      } });
      const [stored] = await db.select({
        retentionUntil: foodEvidence.retentionUntil,
        sourceReference: foodEvidence.sourceReference,
        payloadJson: foodEvidence.payloadJson,
      }).from(foodEvidence)
        .where(and(
          eq(foodEvidence.ownerUserId, request.userId),
          eq(foodEvidence.subjectKey, subjectKey),
          eq(foodEvidence.contentHash, contentHash),
        )).limit(1);
      // An expired duplicate must not be presented as newly persisted.
      // No variants, profiles, global aliases or publication are created here.
      return !!stored?.retentionUntil && stored.retentionUntil > now &&
        stored.sourceReference === candidate.sourceReference &&
        stored.payloadJson === payloadJson;
    },
  };
}
