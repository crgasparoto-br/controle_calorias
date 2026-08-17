export type WhatsappInformalAliasKind = "food" | "brand" | "preparation" | "command";
export type WhatsappInformalAliasScope = "personal" | "global_candidate" | "reviewed_global";

export type WhatsappInformalAlias = {
  raw: string;
  normalized: string;
  kind: WhatsappInformalAliasKind;
  scope: WhatsappInformalAliasScope;
  confidence: number;
};

export type WhatsappInformalReplacement = {
  raw: string;
  normalized: string;
  kind: WhatsappInformalAliasKind | "quantity" | "spelling" | "regionalism";
  confidence: number;
  source: "built_in" | WhatsappInformalAliasScope;
};

export type WhatsappInformalNormalizationResult = {
  originalText: string;
  normalizedText: string;
  replacements: WhatsappInformalReplacement[];
  uncertainTerms: string[];
  candidateGlobalAliases: WhatsappInformalAlias[];
  requiresClarification: boolean;
  clarificationQuestion: string | null;
};

const BUILT_IN_REPLACEMENTS: Array<{
  pattern: RegExp;
  raw: string;
  normalized: string;
  kind: WhatsappInformalReplacement["kind"];
  confidence: number;
}> = [
  { pattern: /\bc\s+(?=\p{L})/giu, raw: "c", normalized: "com ", kind: "spelling", confidence: 0.94 },
  { pattern: /\brefri\s+zero\b/giu, raw: "refri zero", normalized: "refrigerante zero", kind: "food", confidence: 0.92 },
  { pattern: /\bmiojo\s+turma\s+da\s+monica\b/giu, raw: "miojo turma da monica", normalized: "miojo Turma da Monica", kind: "brand", confidence: 0.9 },
  { pattern: /\bcafe\s+lor\b/giu, raw: "cafe lor", normalized: "café L'Or", kind: "brand", confidence: 0.88 },
  { pattern: /\b(\d+(?:[,.]\d+)?)\s+fatia\s+(?=\p{L})/giu, raw: "fatia", normalized: "$1 fatias ", kind: "quantity", confidence: 0.95 },
  { pattern: /\bpa?o\b/giu, raw: "pao", normalized: "pão", kind: "spelling", confidence: 0.9 },
  { pattern: /\bmacarrao\b/giu, raw: "macarrao", normalized: "macarrão", kind: "spelling", confidence: 0.9 },
  { pattern: /\bpratao\s+de\b/giu, raw: "pratao de", normalized: "prato grande de", kind: "regionalism", confidence: 0.72 },
];

const UNCERTAIN_PORTION_PATTERNS = [
  /\b(?:tiquinho|tantinho|pouquinho|punhado|pratada|pratao|prat[aã]o|montanha|bastante)\b/iu,
];

function compactText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeForMatch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function applyBuiltInReplacements(value: string) {
  let normalizedText = value;
  const replacements: WhatsappInformalReplacement[] = [];

  for (const replacement of BUILT_IN_REPLACEMENTS) {
    if (!replacement.pattern.test(normalizedText)) {
      replacement.pattern.lastIndex = 0;
      continue;
    }
    replacement.pattern.lastIndex = 0;
    normalizedText = normalizedText.replace(replacement.pattern, replacement.normalized);
    replacements.push({
      raw: replacement.raw,
      normalized: replacement.normalized.replace("$1 ", "").trim(),
      kind: replacement.kind,
      confidence: replacement.confidence,
      source: "built_in",
    });
  }

  return { normalizedText, replacements };
}

function applyAliases(value: string, aliases: WhatsappInformalAlias[]) {
  let normalizedText = value;
  const replacements: WhatsappInformalReplacement[] = [];
  const candidateGlobalAliases: WhatsappInformalAlias[] = [];

  for (const alias of aliases) {
    const raw = compactText(alias.raw);
    if (!raw) continue;

    const pattern = new RegExp(`\\b${raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "giu");
    if (!pattern.test(normalizedText)) {
      pattern.lastIndex = 0;
      continue;
    }
    pattern.lastIndex = 0;

    if (alias.scope === "global_candidate" || alias.confidence < 0.75) {
      candidateGlobalAliases.push(alias);
      continue;
    }

    normalizedText = normalizedText.replace(pattern, alias.normalized);
    replacements.push({
      raw: alias.raw,
      normalized: alias.normalized,
      kind: alias.kind,
      confidence: alias.confidence,
      source: alias.scope,
    });
  }

  return { normalizedText, replacements, candidateGlobalAliases };
}

function findUncertainTerms(value: string) {
  const normalized = normalizeForMatch(value);
  return UNCERTAIN_PORTION_PATTERNS
    .flatMap(pattern => normalized.match(pattern) ?? [])
    .filter((term, index, terms) => terms.indexOf(term) === index);
}

export function normalizeWhatsappInformalLanguage(
  text: string | null | undefined,
  options: { aliases?: WhatsappInformalAlias[] } = {},
): WhatsappInformalNormalizationResult | null {
  const originalText = compactText(text ?? "");
  if (!originalText) return null;

  const builtIn = applyBuiltInReplacements(originalText);
  const aliasResult = applyAliases(builtIn.normalizedText, options.aliases ?? []);
  const normalizedText = compactText(aliasResult.normalizedText);
  const uncertainTerms = findUncertainTerms(normalizedText);
  const requiresClarification = uncertainTerms.length > 0 || aliasResult.candidateGlobalAliases.length > 0;

  return {
    originalText,
    normalizedText,
    replacements: [...builtIn.replacements, ...aliasResult.replacements],
    uncertainTerms,
    candidateGlobalAliases: aliasResult.candidateGlobalAliases,
    requiresClarification,
    clarificationQuestion: requiresClarification
      ? "Alguns termos ficaram imprecisos. Pode informar quantidade, marca ou preparo com um pouco mais de detalhe?"
      : null,
  };
}
