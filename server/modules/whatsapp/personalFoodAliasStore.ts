import {
  listPersistedWhatsappLearningArtifacts,
  persistWhatsappLearningArtifact,
  removePersistedWhatsappLearningArtifact,
} from "./learningArtifactPersistence";

/**
 * Memória pessoal de alimentos.
 *
 * O mapa abaixo existe somente para compatibilidade com testes e fallback
 * explicitamente permitido fora de produção. O fluxo durável usa
 * `learnPersonalFoodAliasDurably`/`resolvePersonalFoodAliasDurably` e nunca
 * considera o mapa uma confirmação de persistência.
 */

const MAX_ALIASES_PER_USER = 200;
const ALIAS_TTL_DAYS = 90;
const ALIAS_TTL_MS = ALIAS_TTL_DAYS * 24 * 60 * 60 * 1000;
const PERSONAL_ALIAS_ARTIFACT_KIND = "personal_food_alias";

export type PersonalFoodAliasPortion = {
  quantity: number | null;
  unit: string | null;
  label: string | null;
};

export type PersonalFoodAliasIdentity = {
  canonicalName: string;
  canonicalSlug?: string | null;
  brand?: string | null;
  variant?: string | null;
  context?: string | null;
  portion?: Partial<PersonalFoodAliasPortion> | null;
};

export type PersonalFoodAlias = PersonalFoodAliasIdentity & {
  /** Texto original normalizado enviado pelo usuário. */
  aliasText: string;
  /** Timestamp de criação. */
  createdAt: number;
  /** Timestamp do último uso (para TTL). */
  lastUsedAt: number;
  /** Número de vezes que o alias foi confirmado ou resolvido. */
  hitCount: number;
  confidence: number;
  source: "confirmation" | "feedback" | "manual" | "imported";
  sourceHistoryId: string | number | null;
  sourceFeedbackId: string | number | null;
  expiresAt: number | null;
  status: "active" | "revoked" | "expired";
  revokedAt: number | null;
  replacesAliasKey: string | null;
  replacedByAliasKey: string | null;
};

type PersistedAliasArtifact = {
  active: PersonalFoodAlias | null;
  history: PersonalFoodAlias[];
};

type AliasLookupInput = {
  userId: number;
  foodText: string;
  identity?: Partial<PersonalFoodAliasIdentity>;
  explicitBrand?: string | null;
  explicitVariant?: string | null;
  explicitContext?: string | null;
  explicitPortion?: Partial<PersonalFoodAliasPortion> | null;
};

/** Mapa apenas para testes/fallback explicitamente permitido. */
const store = new Map<number, PersonalFoodAlias[]>();

function normalizeAlias(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeOptional(value: string | null | undefined) {
  return value ? normalizeAlias(value) : "";
}

function normalizePortion(portion?: Partial<PersonalFoodAliasPortion> | null): PersonalFoodAliasPortion | null {
  if (!portion) return null;
  const quantity = portion.quantity === undefined || portion.quantity === null
    ? null
    : Number(portion.quantity);
  return {
    quantity: quantity !== null && Number.isFinite(quantity) && quantity > 0 ? quantity : null,
    unit: portion.unit?.trim() ? normalizeOptional(portion.unit) : null,
    label: portion.label?.trim() ? normalizeOptional(portion.label) : null,
  };
}

function normalizeIdentity(input: PersonalFoodAliasIdentity): PersonalFoodAliasIdentity {
  return {
    canonicalName: input.canonicalName.trim(),
    canonicalSlug: input.canonicalSlug?.trim() || null,
    brand: input.brand?.trim() || null,
    variant: input.variant?.trim() || null,
    context: input.context?.trim() || null,
    portion: normalizePortion(input.portion),
  };
}

function identityKey(input: PersonalFoodAliasIdentity) {
  const identity = normalizeIdentity(input);
  return JSON.stringify({
    canonicalName: normalizeOptional(identity.canonicalName),
    canonicalSlug: normalizeOptional(identity.canonicalSlug),
    brand: normalizeOptional(identity.brand),
    variant: normalizeOptional(identity.variant),
    context: normalizeOptional(identity.context),
    portion: identity.portion,
  });
}

function aliasArtifactKey(aliasText: string) {
  return `alias:${normalizeAlias(aliasText)}`;
}

function isUnsafeAliasText(value: string): boolean {
  const normalized = normalizeAlias(value);
  return /\b(?:ignore|prompt|sistema|developer|regra global|todos usuarios|todos os usuarios|base global|sem revisao|aprovar global)\b/.test(normalized);
}

function isTrivialAlias(aliasText: string, canonicalName: string): boolean {
  const normalizedAlias = normalizeAlias(aliasText);
  const normalizedCanonical = normalizeAlias(canonicalName);
  if (normalizedAlias.length < 3) return true;
  if (/^\d+(?:[,.]\d+)?\s*(?:g|gr|gramas?|kg|ml|l|un|unidades?|fatias?|xicaras?|copos?|colheres?|porcoes?|porcao)?$/.test(normalizedAlias)) return true;
  if (normalizedAlias === normalizedCanonical) return true;
  return false;
}

function isGenericSingleWordAlias(value: string): boolean {
  const words = value.split(/\s+/).filter(Boolean);
  return words.length === 1 && value.length <= 4;
}

function pruneExpired(aliases: PersonalFoodAlias[], now: number): PersonalFoodAlias[] {
  return aliases.filter(alias => {
    if (alias.status !== "active") return false;
    return !alias.expiresAt || now < alias.expiresAt;
  });
}

function pruneOverLimit(aliases: PersonalFoodAlias[]): PersonalFoodAlias[] {
  if (aliases.length <= MAX_ALIASES_PER_USER) return aliases;
  return [...aliases]
    .sort((a, b) => b.hitCount - a.hitCount || b.lastUsedAt - a.lastUsedAt)
    .slice(0, MAX_ALIASES_PER_USER);
}

function buildAlias(input: {
  aliasText: string;
  identity: PersonalFoodAliasIdentity;
  now: number;
  previous?: PersonalFoodAlias | null;
  source?: PersonalFoodAlias["source"];
  sourceHistoryId?: string | number | null;
  sourceFeedbackId?: string | number | null;
  confidence?: number;
}): PersonalFoodAlias {
  const identity = normalizeIdentity(input.identity);
  return {
    ...identity,
    aliasText: normalizeAlias(input.aliasText),
    createdAt: input.previous?.createdAt ?? input.now,
    lastUsedAt: input.now,
    hitCount: (input.previous?.hitCount ?? 0) + 1,
    confidence: Math.max(0, Math.min(1, Number((input.confidence ?? input.previous?.confidence ?? 0.8).toFixed(2)))),
    source: input.source ?? input.previous?.source ?? "confirmation",
    sourceHistoryId: input.sourceHistoryId ?? input.previous?.sourceHistoryId ?? null,
    sourceFeedbackId: input.sourceFeedbackId ?? input.previous?.sourceFeedbackId ?? null,
    expiresAt: input.now + ALIAS_TTL_MS,
    status: "active",
    revokedAt: null,
    replacesAliasKey: input.previous ? identityKey(input.previous) : null,
    replacedByAliasKey: null,
  };
}

function identityMatchesExplicit(alias: PersonalFoodAlias, input: AliasLookupInput) {
  const identity = input.identity ?? {};
  const brand = identity.brand ?? input.explicitBrand;
  const variant = identity.variant ?? input.explicitVariant;
  const context = identity.context ?? input.explicitContext;
  const portion = identity.portion ?? input.explicitPortion;

  if (brand !== undefined && normalizeOptional(alias.brand) !== normalizeOptional(brand)) return false;
  if (variant !== undefined && normalizeOptional(alias.variant) !== normalizeOptional(variant)) return false;
  if (context !== undefined && normalizeOptional(alias.context) !== normalizeOptional(context)) return false;
  if (portion !== undefined) {
    const expected = normalizePortion(portion);
    const actual = normalizePortion(alias.portion);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) return false;
  }
  return true;
}

function findAlias(aliases: PersonalFoodAlias[], input: AliasLookupInput, now: number) {
  const normalized = normalizeAlias(input.foodText);
  return pruneExpired(aliases, now).find(alias => {
    if (!identityMatchesExplicit(alias, input)) return false;
    if (alias.aliasText === normalized) return true;
    if (isGenericSingleWordAlias(alias.aliasText) || isGenericSingleWordAlias(normalized)) return false;
    return normalized.includes(alias.aliasText) || alias.aliasText.includes(normalized);
  }) ?? null;
}

function normalizeLoadedAlias(value: unknown): PersonalFoodAlias | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Partial<PersonalFoodAlias>;
  if (typeof input.aliasText !== "string" || typeof input.canonicalName !== "string") return null;
  const now = Date.now();
  return {
    ...normalizeIdentity({
      canonicalName: input.canonicalName,
      canonicalSlug: input.canonicalSlug,
      brand: input.brand,
      variant: input.variant,
      context: input.context,
      portion: input.portion,
    }),
    aliasText: normalizeAlias(input.aliasText),
    createdAt: Number.isFinite(input.createdAt) ? Number(input.createdAt) : now,
    lastUsedAt: Number.isFinite(input.lastUsedAt) ? Number(input.lastUsedAt) : now,
    hitCount: Number.isFinite(input.hitCount) ? Math.max(1, Number(input.hitCount)) : 1,
    confidence: Number.isFinite(input.confidence) ? Math.max(0, Math.min(1, Number(input.confidence))) : 0.8,
    source: input.source ?? "imported",
    sourceHistoryId: input.sourceHistoryId ?? null,
    sourceFeedbackId: input.sourceFeedbackId ?? null,
    expiresAt: input.expiresAt === null ? null : (Number.isFinite(input.expiresAt) ? Number(input.expiresAt) : now + ALIAS_TTL_MS),
    status: input.status ?? "active",
    revokedAt: Number.isFinite(input.revokedAt) ? Number(input.revokedAt) : null,
    replacesAliasKey: input.replacesAliasKey ?? null,
    replacedByAliasKey: input.replacedByAliasKey ?? null,
  };
}

function activeAliasFromArtifact(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const candidate = (value as Partial<PersistedAliasArtifact>).active ?? value;
  const alias = normalizeLoadedAlias(candidate);
  return alias?.status === "active" ? alias : null;
}

function updateLocalAlias(userId: number, nextAlias: PersonalFoodAlias) {
  const now = Date.now();
  let aliases = pruneExpired(store.get(userId) ?? [], now);
  const sameAlias = aliases.filter(alias => alias.aliasText === nextAlias.aliasText);
  for (const previous of sameAlias) {
    if (identityKey(previous) !== identityKey(nextAlias)) {
      previous.status = "revoked";
      previous.revokedAt = now;
      previous.replacedByAliasKey = identityKey(nextAlias);
    }
  }
  const existingIndex = aliases.findIndex(alias => identityKey(alias) === identityKey(nextAlias) && alias.aliasText === nextAlias.aliasText);
  if (existingIndex >= 0) aliases[existingIndex] = nextAlias;
  else aliases.push(nextAlias);
  store.set(userId, pruneOverLimit(aliases));
}

function validateLearningInput(input: { userId: number; aliasText: string; canonicalName: string }) {
  const normalizedAlias = normalizeAlias(input.aliasText);
  if (!Number.isInteger(input.userId) || input.userId <= 0) return { normalizedAlias, valid: false };
  if (isUnsafeAliasText(normalizedAlias) || isTrivialAlias(normalizedAlias, input.canonicalName)) return { normalizedAlias, valid: false };
  return { normalizedAlias, valid: true };
}

/** Compatibilidade síncrona para testes/fallback explicitamente permitido. */
export function learnPersonalFoodAlias(input: {
  userId: number;
  aliasText: string;
  canonicalName: string;
  canonicalSlug?: string | null;
  brand?: string | null;
  variant?: string | null;
  context?: string | null;
  portion?: Partial<PersonalFoodAliasPortion> | null;
  confidence?: number;
  source?: PersonalFoodAlias["source"];
  sourceHistoryId?: string | number | null;
  sourceFeedbackId?: string | number | null;
}): boolean {
  const validation = validateLearningInput(input);
  if (!validation.valid) return false;
  const now = Date.now();
  const identity = normalizeIdentity(input);
  const aliases = pruneExpired(store.get(input.userId) ?? [], now);
  const existing = aliases.find(alias => alias.aliasText === validation.normalizedAlias && identityKey(alias) === identityKey(identity));
  const nextAlias = buildAlias({ aliasText: validation.normalizedAlias, identity, now, previous: existing, source: input.source, sourceHistoryId: input.sourceHistoryId, sourceFeedbackId: input.sourceFeedbackId, confidence: input.confidence });
  updateLocalAlias(input.userId, nextAlias);
  return true;
}

export async function learnPersonalFoodAliasDurably(input: Parameters<typeof learnPersonalFoodAlias>[0]) {
  const validation = validateLearningInput(input);
  if (!validation.valid) return { learned: false as const, persisted: false, alias: null, reason: "unsafe_or_trivial" };

  const now = Date.now();
  const identity = normalizeIdentity(input);
  const artifact = await listPersistedWhatsappLearningArtifacts<PersistedAliasArtifact>({ scope: "user", userId: input.userId, kind: PERSONAL_ALIAS_ARTIFACT_KIND });
  if (artifact === null) return { learned: false as const, persisted: false, alias: null, reason: "persistence_unavailable" };
  const previousArtifact = artifact.find(item => item.key === aliasArtifactKey(validation.normalizedAlias)
    || activeAliasFromArtifact(item.value)?.aliasText === validation.normalizedAlias);
  const previous = activeAliasFromArtifact(previousArtifact?.value);
  const nextAlias = buildAlias({ aliasText: validation.normalizedAlias, identity, now, previous, source: input.source, sourceHistoryId: input.sourceHistoryId, sourceFeedbackId: input.sourceFeedbackId, confidence: input.confidence });
  const history = previous
    ? [previous, ...(previousArtifact?.value && typeof previousArtifact.value === "object" && Array.isArray((previousArtifact.value as PersistedAliasArtifact).history) ? (previousArtifact.value as PersistedAliasArtifact).history : [])]
    : [];
  const persisted = await persistWhatsappLearningArtifact({
    scope: "user",
    userId: input.userId,
    kind: PERSONAL_ALIAS_ARTIFACT_KIND,
    key: aliasArtifactKey(validation.normalizedAlias),
    value: { active: nextAlias, history: history.slice(0, 20) } satisfies PersistedAliasArtifact,
  });
  if (!persisted) return { learned: false as const, persisted: false, alias: null, reason: "persistence_failed" };
  updateLocalAlias(input.userId, nextAlias);
  return { learned: true as const, persisted: true, alias: nextAlias };
}

/** Resolve somente depois de consultar a fonte persistente autoritativa. */
export async function resolvePersonalFoodAliasDurably(input: AliasLookupInput): Promise<{
  status: "resolved" | "missing" | "unavailable";
  alias: PersonalFoodAlias | null;
}> {
  const artifacts = await listPersistedWhatsappLearningArtifacts<PersistedAliasArtifact>({ scope: "user", userId: input.userId, kind: PERSONAL_ALIAS_ARTIFACT_KIND });
  if (artifacts === null) return { status: "unavailable", alias: null };
  const aliases = artifacts.map(item => activeAliasFromArtifact(item.value)).filter((alias): alias is PersonalFoodAlias => Boolean(alias));
  const match = findAlias(aliases, input, Date.now());
  if (!match) return { status: "missing", alias: null };
  const now = Date.now();
  const updated = { ...match, lastUsedAt: now, hitCount: match.hitCount + 1, expiresAt: now + ALIAS_TTL_MS };
  await persistWhatsappLearningArtifact({
    scope: "user",
    userId: input.userId,
    kind: PERSONAL_ALIAS_ARTIFACT_KIND,
    key: aliasArtifactKey(updated.aliasText),
    value: { active: updated, history: [] } satisfies PersistedAliasArtifact,
  });
  updateLocalAlias(input.userId, updated);
  return { status: "resolved", alias: updated };
}

export async function listPersistedPersonalFoodAliases(userId: number): Promise<PersonalFoodAlias[] | null> {
  const artifacts = await listPersistedWhatsappLearningArtifacts<PersistedAliasArtifact>({ scope: "user", userId, kind: PERSONAL_ALIAS_ARTIFACT_KIND });
  if (artifacts === null) return null;
  const now = Date.now();
  return artifacts
    .map(item => activeAliasFromArtifact(item.value))
    .filter((alias): alias is PersonalFoodAlias => Boolean(alias))
    .filter(alias => !alias.expiresAt || alias.expiresAt > now);
}

export async function clearPersonalFoodAliasesDurably(userId: number): Promise<boolean> {
  const aliases = await listPersistedPersonalFoodAliases(userId);
  if (aliases === null) return false;
  await Promise.all(aliases.map(alias => removePersistedWhatsappLearningArtifact({
    scope: "user",
    userId,
    kind: PERSONAL_ALIAS_ARTIFACT_KIND,
    key: aliasArtifactKey(alias.aliasText),
  })));
  clearPersonalFoodAliases(userId);
  return true;
}

export function resolvePersonalFoodAlias(input: AliasLookupInput): PersonalFoodAlias | null {
  const aliases = store.get(input.userId);
  if (!aliases?.length) return null;
  const match = findAlias(aliases, input, Date.now());
  if (match) {
    match.lastUsedAt = Date.now();
    match.hitCount += 1;
  }
  return match;
}

export function listPersonalFoodAliases(userId: number): PersonalFoodAlias[] {
  const aliases = store.get(userId) ?? [];
  return pruneExpired(aliases, Date.now());
}

export function clearPersonalFoodAliases(userId: number): void {
  store.delete(userId);
}

export function __resetPersonalFoodAliasStoreForTests(): void {
  store.clear();
}

export const PERSONAL_FOOD_ALIAS_POLICY = {
  maxAliasesPerUser: MAX_ALIASES_PER_USER,
  ttlDays: ALIAS_TTL_DAYS,
  persistence: "whatsapp_learning_artifacts",
  localMapIsAuthoritative: false,
  precedence: "explicit_current_message_wins",
  directGlobalPromotionAllowed: false,
} as const;
