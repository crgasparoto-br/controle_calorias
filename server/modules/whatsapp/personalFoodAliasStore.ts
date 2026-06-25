/**
 * Armazenamento efêmero de aliases pessoais de alimentos por usuário.
 *
 * Um alias pessoal mapeia um texto informal usado pelo usuário
 * (ex: "franguinho grelhado") para o nome canônico do catálogo
 * (ex: "frango grelhado"), aprendido silenciosamente após um
 * registro bem-sucedido.
 *
 * Regras de segurança:
 * - Aliases com menos de 3 caracteres são descartados.
 * - Aliases que sejam apenas números ou unidades de medida são descartados.
 * - Aliases idênticos ao nome canônico (após normalização) são descartados.
 * - Textos com palavras suspeitas de prompt injection são descartados.
 * - Cada usuário pode ter no máximo MAX_ALIASES_PER_USER aliases ativos.
 * - Aliases expiram após ALIAS_TTL_DAYS dias sem uso.
 */

const MAX_ALIASES_PER_USER = 200;
const ALIAS_TTL_DAYS = 90;
const ALIAS_TTL_MS = ALIAS_TTL_DAYS * 24 * 60 * 60 * 1000;

export type PersonalFoodAlias = {
  /** Texto original normalizado enviado pelo usuário */
  aliasText: string;
  /** Nome canônico no catálogo */
  canonicalName: string;
  /** Slug do item no catálogo, se disponível */
  canonicalSlug?: string;
  /** Timestamp de criação */
  createdAt: number;
  /** Timestamp do último uso (para TTL) */
  lastUsedAt: number;
  /** Número de vezes que o alias foi confirmado */
  hitCount: number;
};

/** Mapa de userId → lista de aliases pessoais */
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

function isUnsafeAliasText(value: string): boolean {
  const normalized = normalizeAlias(value);
  return /\b(?:ignore|prompt|sistema|developer|regra global|todos usuarios|todos os usuarios|base global|sem revisao|aprovar global)\b/.test(normalized);
}

function isTrivialAlias(aliasText: string, canonicalName: string): boolean {
  const normalizedAlias = normalizeAlias(aliasText);
  const normalizedCanonical = normalizeAlias(canonicalName);

  // Muito curto
  if (normalizedAlias.length < 3) return true;

  // Apenas números ou unidades de medida
  if (/^\d+(?:[,.]\d+)?\s*(?:g|gr|gramas?|kg|ml|l|un|unidades?|fatias?|xicaras?|copos?|colheres?|porcoes?|porcao)?$/.test(normalizedAlias)) return true;

  // Idêntico ao canônico
  if (normalizedAlias === normalizedCanonical) return true;

  return false;
}

function pruneExpired(aliases: PersonalFoodAlias[], now: number): PersonalFoodAlias[] {
  return aliases.filter(alias => now - alias.lastUsedAt < ALIAS_TTL_MS);
}

function pruneOverLimit(aliases: PersonalFoodAlias[]): PersonalFoodAlias[] {
  if (aliases.length <= MAX_ALIASES_PER_USER) return aliases;
  // Remove os menos usados e mais antigos
  return [...aliases]
    .sort((a, b) => b.hitCount - a.hitCount || b.lastUsedAt - a.lastUsedAt)
    .slice(0, MAX_ALIASES_PER_USER);
}

/**
 * Registra um alias pessoal silenciosamente após um registro bem-sucedido.
 * Retorna true se o alias foi registrado, false se foi descartado.
 */
export function learnPersonalFoodAlias(input: {
  userId: number;
  aliasText: string;
  canonicalName: string;
  canonicalSlug?: string;
}): boolean {
  const normalizedAlias = normalizeAlias(input.aliasText);

  if (isUnsafeAliasText(normalizedAlias)) return false;
  if (isTrivialAlias(normalizedAlias, input.canonicalName)) return false;

  const now = Date.now();
  let aliases = store.get(input.userId) ?? [];
  aliases = pruneExpired(aliases, now);

  const existing = aliases.find(a => a.aliasText === normalizedAlias && normalizeAlias(a.canonicalName) === normalizeAlias(input.canonicalName));
  if (existing) {
    existing.lastUsedAt = now;
    existing.hitCount += 1;
    return true;
  }

  aliases.push({
    aliasText: normalizedAlias,
    canonicalName: input.canonicalName,
    canonicalSlug: input.canonicalSlug,
    createdAt: now,
    lastUsedAt: now,
    hitCount: 1,
  });

  store.set(input.userId, pruneOverLimit(aliases));
  return true;
}

/**
 * Resolve um texto de alimento consultando os aliases pessoais do usuário.
 * Retorna o alias encontrado ou null se não houver correspondência.
 */
export function resolvePersonalFoodAlias(input: {
  userId: number;
  foodText: string;
}): PersonalFoodAlias | null {
  const aliases = store.get(input.userId);
  if (!aliases?.length) return null;

  const normalized = normalizeAlias(input.foodText);
  const now = Date.now();

  const match = aliases
    .filter(alias => now - alias.lastUsedAt < ALIAS_TTL_MS)
    .find(alias => alias.aliasText === normalized || normalized.includes(alias.aliasText) || alias.aliasText.includes(normalized));

  if (match) {
    match.lastUsedAt = now;
    match.hitCount += 1;
  }

  return match ?? null;
}

/**
 * Lista todos os aliases pessoais ativos de um usuário.
 */
export function listPersonalFoodAliases(userId: number): PersonalFoodAlias[] {
  const aliases = store.get(userId) ?? [];
  const now = Date.now();
  return aliases.filter(alias => now - alias.lastUsedAt < ALIAS_TTL_MS);
}

/**
 * Remove todos os aliases pessoais de um usuário (para testes ou LGPD).
 */
export function clearPersonalFoodAliases(userId: number): void {
  store.delete(userId);
}

/** Apenas para testes — reseta todo o store */
export function __resetPersonalFoodAliasStoreForTests(): void {
  store.clear();
}
