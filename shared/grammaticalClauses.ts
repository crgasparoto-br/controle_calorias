/** Syntax-only noun-clause boundaries shared by entrypoint parsers.
 * The caller owns the subject and existing quantity/unit decisions; this
 * utility does not identify foods, estimate nutrients or consult a catalog.
 */
export type NounClauseGrammar = {
  subject: string;
  parseCount: (token: string) => number | null;
  isMeasure: (token: string) => boolean;
  isSubtype: (token: string) => boolean;
  isGenitive: (token: string) => boolean;
  countSpoons: (text: string) => number;
};

function beginsSeparateNounClause(candidate: string, grammar: NounClauseGrammar): boolean {
  const owner = /^(.+?)\s+(?:com|sem|zero)\b/u.exec(candidate.trim())?.[1];
  if (!owner) return false;
  // The owner begins a separate scope only when its own modifier explicitly
  // mentions the measured subject. An indefinite continuation stays attached.
  const modifier = candidate.trim().slice(owner.length).trimStart();
  const explicitSubject = modifier.includes(grammar.subject) && (
    modifier.startsWith("sem ") || modifier.startsWith("zero ") ||
    modifier.startsWith(`com ${grammar.subject}`) ||
    grammar.countSpoons(modifier) > 0
  );
  if (!explicitSubject) return false;

  const words = owner.trim().split(/\s+/u);
  let index = 0;
  while (/^(?:mais|outro|outra|outros|outras)$/u.test(words[index] ?? "")) index += 1;
  if (grammar.parseCount(words[index] ?? "") !== null ||
      /^(?:uns|umas|alguns|algumas|meio|meia)$/u.test(words[index] ?? "")) index += 1;
  let head = words[index] ?? "";
  const measureHead = grammar.isMeasure(head);
  if (measureHead) {
    if (!grammar.isGenitive(words[index + 1] ?? "")) return false;
    head = words[index + 2] ?? "";
  }
  return Boolean(head && head !== grammar.subject && !grammar.isMeasure(head) &&
    !(measureHead && grammar.isSubtype(head)) &&
    !/^(?:com|sem|zero|de|do|da|dos|das|e|ou|mas|por|para|a|o|as|os|mais|menos|so|apenas|tambem|ainda|agora|entao|depois|logo|antes|hoje|ontem|amanha|fim|seguida|novo|novamente|isso|aquilo|nada|tudo|algum|alguma|alguns|algumas|pouco|pouca|pouquinho|pouquinha)$/u.test(head) &&
    !/mente$/u.test(head));
}

/** Keep competing quantities in their original scope unless a new noun
 * phrase has an explicit subject and its own material descriptor. */
export function splitIndependentNounClauses(surface: string, grammar: NounClauseGrammar): string[] {
  const parts: string[] = [];
  let start = 0;
  const boundaries = /(?<!\d)[,;.!?]|[,;.!?](?!\d)|\s+\b(?:e|mas|ou)\b\s+/gu;
  for (const boundary of surface.matchAll(boundaries)) {
    const index = boundary.index ?? 0;
    const next = index + boundary[0].length;
    if (!beginsSeparateNounClause(surface.slice(next), grammar)) continue;
    const prefix = surface.slice(start, index).trim();
    if (prefix) parts.push(prefix);
    start = next;
  }
  const remaining = surface.slice(start).trim();
  if (remaining) parts.push(remaining);
  return parts;
}
