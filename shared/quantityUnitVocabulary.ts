export const UNIT_WORDS = {
  gramas: "g|grs?|gramas?",
  quilos: "kg|quilos?",
  quilosOnly: "kg",
  miligramas: "mg",
  mililitros: "ml|mililitros?",
  mililitrosCompact: "ml|m\\s*l|mililitros?",
  mililitrosOnly: "ml",
  litros: "l|litros?",
  litrosOnly: "l",
  unidades: "un|und|unidades?",
  fatias: "fatias?",
  pedacos: "pedacos?",
  xicarasAccented: "x[ií]caras?",
  xicarasPlain: "xicaras?",
  copos: "copos?",
  colheresSopa: "colheres? de sopa",
  colheresCha: "colheres? de ch[aá]",
  colheresGeneric: "colheres?",
  doses: "doses?",
  scoops: "scoops?",
  longNeck: "long\\s*neck|longneck",
  latas: "latas?",
  garrafas: "garrafas?",
  porcoesAccented: "por[cç][oõ]es?|por[cç][aã]o",
  porcoesPlain: "porcoes?|porcao",
} as const;

export const COUNT_WORD_VALUES = {
  um: 1,
  uma: 1,
  dois: 2,
  duas: 2,
  tres: 3,
  quatro: 4,
  cinco: 5,
  seis: 6,
  sete: 7,
  oito: 8,
  nove: 9,
  dez: 10,
} as const;

export const COUNT_WORD_PATTERN =
  "um|uma|dois|duas|tr[eê]s|quatro|cinco|seis|sete|oito|nove|dez";
export const COUNTABLE_QUANTITY_PATTERN = `(?:\\d+(?:[,.]\\d+)?|${COUNT_WORD_PATTERN})`;
export const ADDITIONAL_MEASURE_QUALIFIER_PATTERN = "adiciona(?:l|is)|extras?|a\\s+mais";

export function parseCountableQuantity(value: string) {
  const numeric = value.trim().replace(",", ".");
  if (/^\d+(?:\.\d+)?$/.test(numeric)) {
    const parsed = Number(numeric);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  const normalized = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase() as keyof typeof COUNT_WORD_VALUES;
  return COUNT_WORD_VALUES[normalized] ?? null;
}

export type UnitWordKey = keyof typeof UNIT_WORDS;

export function joinUnitWords(keys: readonly UnitWordKey[]) {
  return keys.map(key => UNIT_WORDS[key]).join("|");
}


/** Syntax-only compatibility helpers for V1 ingestion. Never infer food identity or grams. */
function foldQuantityText(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
}

export function stripConsumptionPreface(text: string): string | null {
  const matched = text.trim().match(
    /^(?:(?:hoje|ontem|agora|nesta refeição|no almoço|no jantar|no café da manhã)\s+)?(?:eu\s+)?(?:comi|consumi|tomei|bebi|ingeri|adicionei|coloquei)\s+(.+)$/iu,
  );
  return matched?.[1]?.trim() || null;
}

export function isSpoonUnitPrefix(unit: string): boolean {
  return /^colher\b/iu.test(unit);
}

export function countCountableSpoonMentions(text: string): number {
  const folded = foldQuantityText(text);
  const matcher = new RegExp("\\b(?:" + COUNTABLE_QUANTITY_PATTERN + ")\\s+colher(?:es)?\\b", "gu");
  return [...folded.matchAll(matcher)].length;
}

export function hasCoffeeSugarSpoonSyntax(text: string): boolean {
  const folded = foldQuantityText(text);
  // Co-occurrence is not a component binding: "sem acucar ... colher de leite"
  // and "5 g de acucar ... colher de leite" are not sugar spoon requests.
  // A malformed quantity still belongs to the sugar component and must fail
  // closed, rather than bypass the spoon guard through a missing word boundary.
  const sugarSpoon = /\bcolher(?:es)?(?: de (?:cha|sopa))?\s+(?:de\s+)?acucar\b/u;
  return /\bcafe\b/u.test(folded) && sugarSpoon.test(folded);
}

/** A second measured component must not vanish when V1 splits coordinated text. */
/** Generic quantity-token grammar: no food names or nutritional conversions. */
const UNBOUND_QUANTITY_UNITS = new Set([
  "g", "gr", "grs", "grama", "gramas", "kg", "quilo", "quilos",
  "mg", "miligrama", "miligramas", "ml", "mililitro", "mililitros",
  "l", "litro", "litros", "sache", "saches", "pacote", "pacotes",
  "pitada", "pitadas", "gota", "gotas", "punhado", "punhados",
]);
const UNCERTAIN_QUANTITY_WORDS = new Set([
  "meio", "meia", "metade", "algum", "alguns", "alguma", "algumas",
]);

// Fractions are quantity syntax, not a safe gram conversion. Treat them as
// competing amounts, including vulgar glyphs, Unicode slashes and compact units.
function isFractionalQuantityToken(value: string): boolean {
  return /^(?:\d+)?(?:\d+[/\u2044\u2215]\d+|[\u00bc-\u00be\u2150-\u215e])$/u.test(value);
}

function scanMeasuredQuantityBindings(surface: string): Array<string | null> {
  const words = surface.split(/\s+/u)
    .map(word => word.replace(/^[,;!?()]+|[,;.!?()]+$/gu, ""))
    .filter(Boolean);
  const bindings: Array<string | null> = [];
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    // A sign does not make a competing measurement harmless or convertible.
    const unsigned = word.replace(/^[+\-\u2212\u2013\u2014]/u, "");
    let isQuantity = parseCountableQuantity(unsigned) !== null ||
      isFractionalQuantityToken(unsigned) || UNCERTAIN_QUANTITY_WORDS.has(unsigned);
    let compactUnit = false;
    if (!isQuantity) {
      for (const suffix of ["mg", "kg", "ml", "g", "l"]) {
        if (unsigned.endsWith(suffix) &&
            (parseCountableQuantity(unsigned.slice(0, -suffix.length)) !== null ||
              isFractionalQuantityToken(unsigned.slice(0, -suffix.length)))) {
          isQuantity = true;
          compactUnit = true;
          break;
        }
      }
    }
    if (!isQuantity) continue;

    const unit = words[index + 1] ?? "";
    // A measured quantity can have an intervening descriptive qualifier.
    const hasUnit = compactUnit || UNBOUND_QUANTITY_UNITS.has(unit);
    const subjectOffset = compactUnit && words[index + 1] === "de" ? 2 :
      hasUnit && words[index + 2] === "a" && words[index + 3] === "mais" &&
        words[index + 4] === "de" ? 5 :
      words[index + 2] === "de" ? 3 :
      words[index + 3] === "de" && hasUnit ? 4 : 0;
    // A missing unit is still a quantity when its ingredient is explicit:
    // "duas de <ingredient>" or "meia a mais de <ingredient>". Keep the
    // ingredient binding rather than silently dropping the second amount.
    const elidedSubject = !hasUnit && unit === "de" ? words[index + 2] :
      !hasUnit && unit === "a" && words[index + 2] === "mais" &&
        words[index + 3] === "de" ? words[index + 4] :
      !hasUnit && words[index + 3] === "de" ? words[index + 4] :
      !hasUnit && words[index + 4] === "de" ? words[index + 5] : null;
    if (subjectOffset && words[index + subjectOffset]) {
      bindings.push(words[index + subjectOffset]);
    } else if (elidedSubject) {
      bindings.push(elidedSubject);
    } else if (
      hasUnit || unit === "de" || !unit ||
      // A preceding alternative/coordination can lose its final operand
      // when the spoon matcher consumes only the last count ("1 ou 2").
      // It is unresolved quantity syntax, not an independent serving.
      /^(?:e|ou|a|ate)$/u.test(unit) ||
      /^(?:adicionais?|extras?)$/u.test(unit) ||
      (unit === "a" && words[index + 2] === "mais") ||
      (words[index - 1] === "mais" && unit === "e")
    ) {
      // "e mais 2" or "e meia a mais" has no identifiable ingredient.
      // Never resolve a preceding spoon with an unbound concurrent amount.
      bindings.push(null);
    }
  }
  return bindings;
}

/** Do not split an unresolved competing quantity away from its spoon component. */
function hasCompetingOrUnboundSugarMeasure(folded: string, spoon: RegExpMatchArray): boolean {
  const start = spoon.index ?? 0;
  const remaining = `${folded.slice(0, start)} ${folded.slice(start + spoon[0].length)}`;
  const spoonSubject = spoon[0].trim().split(" ").at(-1);
  return scanMeasuredQuantityBindings(remaining).some(
    subject => subject === null || subject === spoonSubject,
  );
}

export function readCoffeeSugarSpoonSyntax(text: string): { quantity: number; unit: string } | null {
  if (!hasCoffeeSugarSpoonSyntax(text)) return null;
  const folded = foldQuantityText(text).trim();
  // Contradictory explicit negation is a clarification, not measured sugar.
  if (/\b(?:sem\s+(?:adicao\s+de\s+)?acucar|zero\s+acucar)\b/u.test(folded)) return null;
  const matcher = new RegExp(
    "\\b(" + COUNTABLE_QUANTITY_PATTERN + ")\\s+(colher(?:es)?(?: de (?:cha|sopa))?)\\s+(?:de\\s+)?acucar\\b",
    "gu",
  );
  const matches = [...folded.matchAll(matcher)];
  if (matches.length !== 1 || [...folded.matchAll(/\bcolher(?:es)?\b/gu)].length !== 1) return null;
  // A word boundary can isolate the *last* operand of an expression.
  // Unicode math/dash signs and common fraction separators must behave like
  // their ASCII equivalents; never resolve a fragment as a whole spoon count.
  const beforeQuantity = folded.slice(0, matches[0].index).trimEnd();
  if (/(?:[\p{Sm}\p{Pd}*/\u00b7\u2044\u2215^%|]|\bx)$/u.test(beforeQuantity)) return null;
  // Colon is a ratio only when preceded by another quantity ("1:2"); a
  // natural label such as "café: 2 colheres" is not an expression.
  const precedingRatio = new RegExp("\\b(?:" + COUNTABLE_QUANTITY_PATTERN + ")\\s*:$", "u");
  if (precedingRatio.test(beforeQuantity)) return null;
  if (hasCompetingOrUnboundSugarMeasure(folded, matches[0])) return null;
  const quantity = parseCountableQuantity(matches[0][1]);
  return quantity && quantity > 0
    ? { quantity, unit: matches[0][2].replace(/^colheres\b/u, "colher") }
    : null;
}

export function replaceCoffeeSugarSpoonSyntax(text: string, replacement: string): string | null {
  const matcher = new RegExp(
    "\\b(?:" + COUNTABLE_QUANTITY_PATTERN + ")\\s+colher(?:es)?(?: de (?:ch[aá]|sopa))?\\s+(?:de\\s+)?a[cç][uú]car\\b",
    "giu",
  );
  const matches = [...text.matchAll(matcher)];
  if (matches.length !== 1 || !readCoffeeSugarSpoonSyntax(text)) return null;
  return text.replace(matcher, replacement);
}
