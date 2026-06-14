export type WhatsappInformalNormalizationMatch = {
  kind: "abbreviation" | "typo" | "regionalism" | "brand" | "portion" | "command";
  original: string;
  normalized: string;
  confidence: number;
  needsReview: boolean;
};

export type WhatsappInformalNormalizationResult = {
  originalText: string | null;
  normalizedText: string | null;
  matches: WhatsappInformalNormalizationMatch[];
  uncertainTerms: string[];
  needsClarification: boolean;
  clarificationQuestion: string | null;
  candidateAliases: Array<{
    alias: string;
    candidate: string;
    kind: WhatsappInformalNormalizationMatch["kind"];
    confidence: number;
  }>;
};

type InformalReplacementRule = {
  pattern: RegExp;
  normalized: string;
  kind: WhatsappInformalNormalizationMatch["kind"];
  confidence: number;
  needsReview?: boolean;
};

const safeReplacementRules: InformalReplacementRule[] = [
  { pattern: /\bqjo\b/gi, normalized: "queijo", kind: "abbreviation", confidence: 0.96 },
  { pattern: /\bc\s*\/\s*q(?:jo|ueijo)?\b|\bc\s+q(?:jo|ueijo)?\b/gi, normalized: "com queijo", kind: "abbreviation", confidence: 0.93 },
  { pattern: /\bs\s*\/\s*a[cç][uú]car\b|\bs\s+a[cç][uú]car\b/gi, normalized: "sem açúcar", kind: "abbreviation", confidence: 0.92 },
  { pattern: /\brefri\b/gi, normalized: "refrigerante", kind: "abbreviation", confidence: 0.94 },
  { pattern: /\bcafe\b/gi, normalized: "café", kind: "typo", confidence: 0.98 },
  { pattern: /\bpao\b/gi, normalized: "pão", kind: "typo", confidence: 0.98 },
  { pattern: /\bfeijao\b/gi, normalized: "feijão", kind: "typo", confidence: 0.98 },
  { pattern: /\bmacarrao\b/gi, normalized: "macarrão", kind: "typo", confidence: 0.98 },
  { pattern: /\bproteina\b/gi, normalized: "proteína", kind: "typo", confidence: 0.98 },
  { pattern: /\b2\s+fatia\b/gi, normalized: "2 fatias", kind: "portion", confidence: 0.95 },
  { pattern: /\b1\s+fatia\b/gi, normalized: "1 fatia", kind: "portion", confidence: 0.98 },
  { pattern: /\bum\s+tiquinho\s+de\b/gi, normalized: "pequena quantidade de", kind: "portion", confidence: 0.62, needsReview: true },
  { pattern: /\btiquinho\s+de\b/gi, normalized: "pequena quantidade de", kind: "portion", confidence: 0.62, needsReview: true },
  { pattern: /\bprat[aã]o\s+de\b/gi, normalized: "prato grande de", kind: "portion", confidence: 0.7, needsReview: true },
  { pattern: /\bmiojo\s+turma\s+da\s+monica\b/gi, normalized: "macarrão instantâneo Turma da Mônica", kind: "brand", confidence: 0.88 },
  { pattern: /\bcafe\s+lor\b/gi, normalized: "café L'or", kind: "brand", confidence: 0.86 },
  { pattern: /\blor\b/gi, normalized: "L'or", kind: "brand", confidence: 0.68, needsReview: true },
  { pattern: /\bzero\b/gi, normalized: "zero açúcar", kind: "brand", confidence: 0.72, needsReview: true },
  { pattern: /\bregistra\b/gi, normalized: "registrar", kind: "command", confidence: 0.9 },
  { pattern: /\badd\b/gi, normalized: "adicionar", kind: "command", confidence: 0.9 },
];

const uncertainPatterns = [
  /\btiquinho\b/i,
  /\bprat[aã]o\b/i,
  /\blor\b/i,
  /\bzero\b/i,
];

function cleanText(value?: string | null) {
  const trimmed = value?.replace(/\s+/g, " ").trim();
  return trimmed || null;
}

function applyRule(value: string, rule: InformalReplacementRule) {
  let matched = false;
  let firstOriginal: string | null = null;
  const nextValue = value.replace(rule.pattern, (match) => {
    matched = true;
    firstOriginal ??= match;
    return rule.normalized;
  });

  if (!matched || !firstOriginal) {
    return { value, match: null };
  }

  return {
    value: nextValue,
    match: {
      kind: rule.kind,
      original: firstOriginal,
      normalized: rule.normalized,
      confidence: rule.confidence,
      needsReview: Boolean(rule.needsReview),
    } satisfies WhatsappInformalNormalizationMatch,
  };
}

function uniqueValues(values: string[]) {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}

export function normalizeWhatsappInformalText(text?: string | null): WhatsappInformalNormalizationResult {
  const originalText = cleanText(text);
  if (!originalText) {
    return {
      originalText: null,
      normalizedText: null,
      matches: [],
      uncertainTerms: [],
      needsClarification: false,
      clarificationQuestion: null,
      candidateAliases: [],
    };
  }

  let normalizedText = originalText;
  const matches: WhatsappInformalNormalizationMatch[] = [];
  for (const rule of safeReplacementRules) {
    const result = applyRule(normalizedText, rule);
    normalizedText = result.value;
    if (result.match) {
      matches.push(result.match);
    }
  }

  normalizedText = normalizedText.replace(/\s+/g, " ").trim();
  const uncertainTerms = uniqueValues(matches.filter(match => match.needsReview).map(match => match.original));
  const hasOnlyUncertainPortion = matches.some(match => match.kind === "portion" && match.needsReview);
  const needsClarification = hasOnlyUncertainPortion && !/\b\d+(?:[,.]\d+)?\s*(?:g|kg|ml|l|un|unidade|fatias?)\b/i.test(normalizedText);

  return {
    originalText,
    normalizedText,
    matches,
    uncertainTerms: uniqueValues([
      ...uncertainTerms,
      ...uncertainPatterns.flatMap(pattern => pattern.test(originalText) ? [originalText.match(pattern)?.[0] ?? ""] : []),
    ]),
    needsClarification,
    clarificationQuestion: needsClarification
      ? "Entendi uma quantidade informal. Pode confirmar a porção aproximada para eu registrar com segurança?"
      : null,
    candidateAliases: matches.map(match => ({
      alias: match.original,
      candidate: match.normalized,
      kind: match.kind,
      confidence: match.confidence,
    })),
  };
}
