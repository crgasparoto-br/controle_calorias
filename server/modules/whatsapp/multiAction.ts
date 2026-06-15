export type WhatsappMultiActionSegment = {
  index: number;
  text: string;
  reason: "explicit_separator";
};

const MAX_MULTI_ACTION_SEGMENTS = 6;
const ACTION_LEAD_PATTERN = String.raw`(?:n[aã]o\s+(?:e|é|era)|troca(?:r)?|substitui(?:r)?|corrige(?:ir)?|ajusta(?:r)?|remove(?:r)?|apaga(?:r)?|exclui(?:r)?|tira(?:r)?|adiciona(?:r)?|inclui(?:r)?|lan[cç]a(?:r)?|registra(?:r)?|coloca(?:r)?|bota(?:r)?|soma(?:r)?|desfaz(?:er)?)`;
const ACTION_SEPARATOR_PATTERN = new RegExp(`\\s*,\\s*(?=${ACTION_LEAD_PATTERN}(?:\\s|$))|\\s+e\\s+(?:depois\\s+)?(?=${ACTION_LEAD_PATTERN}(?:\\s|$))|\\s*;\\s*`, "giu");

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function startsWithExplicitAction(value: string) {
  const normalized = normalizeText(value);
  return /^(?:nao\s+(?:e|era)|troca(?:r)?|substitui(?:r)?|corrige(?:ir)?|ajusta(?:r)?|remove(?:r)?|apaga(?:r)?|exclui(?:r)?|tira(?:r)?|adiciona(?:r)?|inclui(?:r)?|lanca(?:r)?|registra(?:r)?|coloca(?:r)?|bota(?:r)?|soma(?:r)?|desfaz(?:er)?)\b/.test(normalized);
}

function isMealDeclaration(value: string) {
  const normalized = normalizeText(value);
  return /^(?:no|na)\s+(?:cafe\s+da\s+manha|almoco|jantar|lanche|ceia)\s+(?:foi|foram|comi|teve)\b/.test(normalized);
}

function splitCandidateText(text: string) {
  return text
    .replace(ACTION_SEPARATOR_PATTERN, " | ")
    .split("|")
    .map(part => part.trim().replace(/^[,;]+|[,;]+$/g, "").trim())
    .filter(Boolean)
    .slice(0, MAX_MULTI_ACTION_SEGMENTS);
}

export function detectWhatsappMultiActionSegments(text?: string | null): WhatsappMultiActionSegment[] | null {
  const trimmed = text?.trim();
  if (!trimmed || trimmed.length < 8) return null;

  const parts = splitCandidateText(trimmed);
  if (parts.length < 2) return null;

  const explicitActionCount = parts.filter(startsWithExplicitAction).length;
  const firstPartIsActionable = startsWithExplicitAction(parts[0]) || isMealDeclaration(parts[0]);
  if (explicitActionCount < 2 && !(firstPartIsActionable && explicitActionCount >= 1)) {
    return null;
  }

  return parts.map((part, index) => ({
    index: index + 1,
    text: part,
    reason: "explicit_separator",
  }));
}
