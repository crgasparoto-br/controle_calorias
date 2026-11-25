/** Canonical locale pt-BR surface grammar for Food Intelligence V2 (#1304).
 * Syntax, units, numerals and source spans only: no catalog, identity or macros.
 * Maintained separately from orchestration to keep one auditable owner per layer.
 */
import { FOOD_CONTRACT_LIMITS } from "./contracts";

export type Span = { start: number; end: number };
export type Segment = Span & { text: string };
/** Pre-authorized S2 aliases only; a null unit denotes conflicting meanings. */
export type GovernedUnitAlias = {
  term: string;
  unit: string | null;
  entryId: number | null;
  confidence: number | null;
  candidates: readonly {
    entryId: number; unit: string; confidence: number | null; requiresClarification: boolean;
  }[];
};

const unitMap: Readonly<Record<string, string>> = {
  g: "g", gr: "g", grama: "g", gramas: "g",
  kg: "kg", quilo: "kg", quilos: "kg",
  ml: "ml", mililitro: "ml", mililitros: "ml",
  l: "l", litro: "l", litros: "l",
  un: "un", unidade: "un", unidades: "un",
  fatia: "fatia", fatias: "fatia",
  colher: "colher", colheres: "colher",
  xicara: "xícara", xicaras: "xícara",
  copo: "copo", copos: "copo",
  porcao: "porção", porcoes: "porção",
};
const writtenNumbers: Readonly<Record<string, number>> = {
  um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4,
  cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10,
  onze: 11, doze: 12, treze: 13, catorze: 14, quatorze: 14,
  quinze: 15, dezesseis: 16, dezasseis: 16, dezessete: 17,
  dezoito: 18, dezenove: 19,
  vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50,
  sessenta: 60, setenta: 70, oitenta: 80, noventa: 90,
  cem: 100, cento: 100, duzentos: 200, duzentas: 200,
  trezentos: 300, trezentas: 300, quatrocentos: 400, quatrocentas: 400,
  quinhentos: 500, quinhentas: 500, seiscentos: 600, seiscentas: 600,
  setecentos: 700, setecentas: 700, oitocentos: 800, oitocentas: 800,
  novecentos: 900, novecentas: 900,
  meio: 0.5, meia: 0.5,
};
const onesPattern = "um|uma|dois|duas|tr[eê]s|quatro|cinco|seis|sete|oito|nove";
const tensPattern = "vinte|trinta|quarenta|cinquenta|sessenta|setenta|oitenta|noventa";
const teensPattern = "onze|doze|treze|catorze|quatorze|quinze|dezesseis|dezasseis|dezessete|dezoito|dezenove|dez";
const underHundredPattern = "(?:" + tensPattern + ")(?:\\s+e\\s+(?:" + onesPattern + "))?|" +
  teensPattern + "|" + onesPattern;
const hundredsPattern = "cem|cento|duzent[oa]s|trezent[oa]s|quatrocent[oa]s|quinhent[oa]s|" +
  "seiscent[oa]s|setecent[oa]s|oitocent[oa]s|novecent[oa]s";
// Compose hundreds only with another valid number phrase. Never consume a food
// name after an 'e' (e.g. 'cem ovos e banana'). The original text is untouched.
const writtenPattern = "(?:(?:" + hundredsPattern + ")(?:\\s+e\\s+(?:" + underHundredPattern + "))?)|" +
  underHundredPattern + "|meio|meia";
const unitPattern = "g|gr|gramas?|kg|quilos?|ml|mililitros?|l|litros?|un|unidades?|fatias?|colher(?:es)?|x[ií]caras?|copos?|por[cç][oõ](?:es|s)?|por[cç][aã]o";
// Slash fractions and vulgar fractions are quantitative only in the leading
// quantity slot; the original surface/UTF-16 anchors are never rewritten.
const quantityPattern = "\\d+/\\d+|\\d+(?:[,.]\\d+)?|[¼½¾]|" + writtenPattern;
const quantified = new RegExp("^(" + quantityPattern + ")(?:\\s+(?:de\\s+)?|(?<=\\d))(" + unitPattern + ")\\b\\s*(?:de\\s+)?", "iu");
const halfAfterUnit = new RegExp("^(" + quantityPattern + ")(?:\\s+(?:de\\s+)?|(?<=\\d))(" + unitPattern + ")\\s+e\\s+mei[ao]\\b\\s*(?:de\\s+)?", "iu");
const counted = new RegExp("^(" + quantityPattern + ")\\s+(?:de\\s+)?", "iu");

export function foldFoodSurface(value: string, foodNamePunctuation = false): string {
  // Only for S1 food identity hints: a comma plus a material qualifier
  // coordinator is syntax. All other consumers keep their existing folding.
  const nameSurface = foodNamePunctuation
    ? value.replace(/,\s*e\s+(?=(?:sem|com|zero)\s+(?:a[c\u00e7][u\u00fa]car|lactose|gl[u\u00fa]ten|sal|gordura|cafe[i\u00ed]na)\b|(?:frit[ao]s?|cozid[ao]s?|desnatad[ao]s?|integral|diet|light|uht)\b)/giu, " ")
      .replace(/,(?!\d)\s*/gu, " ")
    : value;
  return nameSurface.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR").replace(/\s+/gu, " ").trim();
}

function parseNumber(value: string): number | null {
  const folded = foldFoodSurface(value);
  if (Object.prototype.hasOwnProperty.call(writtenNumbers, folded)) return writtenNumbers[folded];
  const words = folded.split(" e ");
  // S1 grammar: 20..99 and 100..999, including 'cento e vinte e duas'.
  // 'cem' does not take a following additive suffix in pt-BR ('cento' does).
  if (words.length === 2 && writtenNumbers[words[0]] >= 20 &&
      writtenNumbers[words[0]] < 100 && writtenNumbers[words[0]] % 10 === 0 &&
      writtenNumbers[words[1]] >= 1 && writtenNumbers[words[1]] <= 9) {
    return writtenNumbers[words[0]] + writtenNumbers[words[1]];
  }
  if (words.length >= 2 && words.length <= 3 && words[0] !== "cem" &&
      writtenNumbers[words[0]] >= 100 && writtenNumbers[words[0]] <= 900 &&
      writtenNumbers[words[0]] % 100 === 0) {
    const remainder = parseNumber(words.slice(1).join(" e "));
    if (remainder !== null && Number.isInteger(remainder) && remainder >= 1 && remainder < 100) {
      return writtenNumbers[words[0]] + remainder;
    }
  }
  const vulgar: Readonly<Record<string, number>> = { "¼": 0.25, "½": 0.5, "¾": 0.75 };
  if (Object.prototype.hasOwnProperty.call(vulgar, folded)) return vulgar[folded];
  const fraction = /^(\d{1,2})\/(\d{1,2})$/u.exec(folded);
  if (fraction) {
    const numerator = Number(fraction[1]);
    const denominator = Number(fraction[2]);
    // Only unambiguous common serving fractions; not dates/IDs or zero division.
    return numerator > 0 && denominator > 1 && denominator <= 8 &&
      numerator <= denominator * 2 ? numerator / denominator : null;
  }
  // '1.000' and '1,500' remain ambiguous (decimal vs thousands).
  // A leading 0 cannot be a thousands group: 0,125 kg is 125 g.
  // Reject arbitrary padded forms rather than weakening the ambiguity gate.
  if (/^\d{1,3}[,.]\d{3}$/.test(folded) && !/^0[,.]\d{3}$/.test(folded)) return null;
  if (!/^\d+(?:[,.]\d+)?$/.test(folded)) return null;
  const number = Number(folded.replace(",", "."));
  return Number.isFinite(number) && number > 0 ? number : null;
}

export function recognizedUnit(value: string): string | null {
  return unitMap[foldFoodSurface(value)] ?? null;
}

export type FoodQuantitySourceSpans = {
  name?: Span; quantity?: Span;
  // A literal nominal slot, not a selected unit or measured amount.
  nameAfterConflictingUnit?: Span;
  // The governed production reached the end before any nominal slot.
  orphanedGovernedUnit?: true;
};

export function readQuantity(
  text: string, governedUnits: readonly GovernedUnitAlias[] = [], requireExplicitUnit = false,
  sourceSpans?: FoodQuantitySourceSpans,
): {
  value: number | null; unit: string | null; name: string;
  servingText: string | null; uncertain: boolean; governedAlias?: GovernedUnitAlias;
} {
  const source = text.trim();
  // Optional evidence only: raw UTF-16 offsets from the selected production,
  // never a new parse or a lookup of a normalized/value-equivalent string.
  const sourceStart = sourceSpans ? text.length - text.trimStart().length : 0;
  const endConnector = /\s+de$/iu;
  const leading = (consumed: number, name: string, trailingConnector = true) => {
    if (!sourceSpans) return;
    const nameStart = source.length - name.length;
    if (name && nameStart >= consumed && source.endsWith(name)) {
      sourceSpans.name = { start: sourceStart + nameStart, end: sourceStart + source.length };
    }
    const prefix = source.slice(0, consumed).trimEnd();
    const end = (trailingConnector ? prefix.replace(endConnector, "").trimEnd() : prefix).length;
    if (end > 0) sourceSpans.quantity = { start: sourceStart, end: sourceStart + end };
  };
  const relay = (nested: FoodQuantitySourceSpans | undefined, offset: number) => {
    if (!sourceSpans || !nested) return;
    for (const key of ["name", "quantity"] as const) {
      const span = nested[key];
      if (span) sourceSpans[key] = {
        start: sourceStart + offset + span.start, end: sourceStart + offset + span.end,
      };
    }
  };
  // A-044: a standalone pictographic marker may precede a complete quantity.
  // Keep the caller's raw source/span unchanged; never infer food identity from
  // an emoji, or discard an emoji when the following quantity is ambiguous.
  const pictographicPrefix = /^(?:\p{Extended_Pictographic}\uFE0F?(?:\u200D\p{Extended_Pictographic}\uFE0F?)*\s+)+/u.exec(source);
  if (pictographicPrefix) {
    const nested = sourceSpans ? {} : undefined;
    const following = readQuantity(source.slice(pictographicPrefix[0].length), governedUnits, requireExplicitUnit, nested);
    if (following.value !== null && following.unit !== null && following.name) {
      relay(nested, pictographicPrefix[0].length);
      return following;
    }
  }
  const unresolved = () => ({
    value: null, unit: null, name: source, servingText: source, uncertain: true,
  });
  // A-022: an interval/choice is evidence of an uncertain quantity, never
  // permission to select its first bound. Keep the entire original phrase.
  const bounds = "(?:" + quantityPattern + ")";
  const quantityRange = new RegExp(
    "^(?:(?:de\\s+)?" + bounds + "\\s+(?:a|ou|at[eé])\\s+" + bounds +
      "|entre\\s+" + bounds + "\\s+e\\s+" + bounds +
      "|" + bounds + "\\s*[-–]\\s*" + bounds + ")(?=\\s|$|\\p{L})", "iu",
  );
  // Permit an adjacent unit suffix: "30 a 40g" and "30 a 40 g" are the
  // same uncertain range, not an exact count of 30 food items.
  if (quantityRange.test(source)) return unresolved();
  // A choice of different foods is not an exact quantity of the first food.
  // Preserve both alternatives in the original serving text for downstream
  // clarification instead of interpreting "2 bananas ou 3 maçãs" as 2 bananas.
  if (/\s+ou\s+/iu.test(source)) return unresolved();
  // Qualified spoon measures are distinct units, not "sopa/cha" food names.
  // A second "de <food>" is required: "colher de sopa" by itself describes
  // a spoonful of soup, not an absent food. Never invent mass or volume.
  const qualifiedSpoon = new RegExp(
    "^(" + quantityPattern + ")\\s+(?:de\\s+)?colher(?:es)?(\\s+e\\s+mei[ao])?\\s+de\\s+" +
      "(sopa|ch[aá]|sobremesa|caf[eé])\\s+de\\s+", "iu",
  ).exec(source);
  if (qualifiedSpoon) {
    const amount = parseNumber(qualifiedSpoon[1]);
    const qualifier = foldFoodSurface(qualifiedSpoon[3]);
    const unit = "colher de " + (qualifier === "cha" ? "chá" :
      qualifier === "cafe" ? "café" : qualifier);
    const foodName = source.slice(qualifiedSpoon[0].length).trim();
    if (amount !== null && foodName) {
      leading(qualifiedSpoon[0].length, foodName);
      return {
        value: amount + (qualifiedSpoon[2] ? 0.5 : 0), unit, name: foodName,
        servingText: qualifiedSpoon[0].trim(), uncertain: false,
      };
    }
    return unresolved();
  }
  // A terminal half refers to the already counted food, not to a new item:
  // "duas fatias de pão e meia" and "dois ovos e meio".
  // Require a terminal half so "2 ovos e meio copo de leite" is not coerced.
  const halfAfterFoodWithUnit = new RegExp(
    "^(" + quantityPattern + ")\\s+(" + unitPattern + ")\\s+(?:de\\s+)?(.+?)\\s+e\\s+mei[ao]\\s*$", "iu",
  ).exec(source);
  if (halfAfterFoodWithUnit) {
    const value = parseNumber(halfAfterFoodWithUnit[1]);
    const unit = recognizedUnit(halfAfterFoodWithUnit[2]);
    if (value !== null && unit !== null) return {
      value: value + 0.5, unit, name: halfAfterFoodWithUnit[3].trim(),
      servingText: source, uncertain: false,
    };
  }
  // Independent from any name correction: "um ovo cozido" -> 1 un.
  const half = halfAfterUnit.exec(source);
  if (half) {
    const value = parseNumber(half[1]);
    const unit = recognizedUnit(half[2]);
    if (value !== null && unit !== null) {
      const name = source.slice(half[0].length).trim();
      leading(half[0].length, name);
      return { value: value + 0.5, unit, name, servingText: half[0].trim(), uncertain: false };
    }
  }
  const withUnit = quantified.exec(source);
  if (withUnit) {
    const value = parseNumber(withUnit[1]);
    const unit = recognizedUnit(withUnit[2]);
    if (value !== null && unit !== null) {
      const name = source.slice(withUnit[0].length).trim();
      leading(withUnit[0].length, name);
      return { value, unit, name, servingText: withUnit[0].trim(), uncertain: false };
    }
  }
  const writtenHalfWithUnit = new RegExp("^(" + quantityPattern + ")\\s+e\\s+mei[ao]\\s+(" + unitPattern + ")\\b\\s*(?:de\\s+)?", "iu").exec(source);
  if (writtenHalfWithUnit) {
    const value = parseNumber(writtenHalfWithUnit[1]);
    const unit = recognizedUnit(writtenHalfWithUnit[2]);
    if (value !== null && Number.isInteger(value) && unit !== null) {
      const name = source.slice(writtenHalfWithUnit[0].length).trim();
      leading(writtenHalfWithUnit[0].length, name);
      return { value: value + 0.5, unit, name, servingText: writtenHalfWithUnit[0].trim(), uncertain: false };
    }
  }
  const oneAndHalf = new RegExp("^(" + quantityPattern + ")\\s+e\\s+mei[ao]\\b\\s*(?:de\\s+)?", "iu").exec(source);
  if (oneAndHalf && !requireExplicitUnit) {
    const value = parseNumber(oneAndHalf[1]);
    if (value !== null && Number.isInteger(value)) {
      const name = source.slice(oneAndHalf[0].length).trim();
      leading(oneAndHalf[0].length, name);
      return { value: value + 0.5, unit: "un", name, servingText: oneAndHalf[0].trim(), uncertain: false };
    }
  }
  // A comma-delimited trailing quantity can describe the preceding food:
  // "mortadela, uma fatia e meia". Do not manufacture another food item.
  const trailing = /^(.+?),\s*(.+)$/u.exec(source);
  if (trailing) {
    const nested = sourceSpans ? {} : undefined;
    const suffix = readQuantity(trailing[2], governedUnits, requireExplicitUnit, nested);
    if (suffix.value !== null && suffix.unit !== null && !suffix.name) {
      relay(nested, source.length - trailing[2].length);
      const name = trailing[1].trim();
      if (sourceSpans && name) sourceSpans.name = { start: sourceStart, end: sourceStart + name.length };
      return { ...suffix, name };
    }
  }
  // The governed term occupies the unit slot, not the food-identity slot.
  // Match whole words and longest aliases before the default counted "un" path.
  // A collision cannot silently choose a unit or change the food name.
  const countedPrefix = counted.exec(source);
  if (countedPrefix && governedUnits.length > 0) {
    const number = parseNumber(countedPrefix[1]);
    const remaining = source.slice(countedPrefix[0].length);
    const words = [...remaining.matchAll(/\S+/gu)];
    const matching = governedUnits.filter(alias => {
      const count = alias.term.split(/\s+/u).length;
      return words.length >= count &&
        foldFoodSurface(words.slice(0, count).map(match => match[0]).join(" ")) === alias.term;
    }).sort((a, b) => b.term.length - a.term.length);
    const alias = matching[0];
    if (alias) {
      const lastWord = words[alias.term.split(/\s+/u).length - 1];
      const unitEnd = (lastWord.index ?? 0) + lastWord[0].length;
      const afterUnit = remaining.slice(unitEnd);
      if (number === null || alias.unit === null) {
        if (sourceSpans && number !== null && !afterUnit && alias.candidates.length > 0) {
          sourceSpans.orphanedGovernedUnit = true;
        }
        // Only the same governed prefix can prove this boundary: a genuine
        // collision of usable meanings and an explicit, adjacent connector.
        // Keep the original parse and emit no quantity evidence for this slot.
        if (sourceSpans && number !== null &&
            new Set(alias.candidates.filter(candidate => !candidate.requiresClarification)
              .map(candidate => candidate.unit)).size > 1) {
          const connector = /^[ \t]+de[ \t]+/iu.exec(afterUnit);
          if (connector && connector[0].length < afterUnit.length) {
            sourceSpans.nameAfterConflictingUnit = {
              start: sourceStart + countedPrefix[0].length + unitEnd + connector[0].length,
              end: sourceStart + source.length,
            };
          }
        }
        return { value: null, unit: null, name: source, servingText: countedPrefix[0].trim(),
          uncertain: true, governedAlias: alias };
      }
      const rest = afterUnit.trim().replace(/^de\s+/iu, "");
      leading(countedPrefix[0].length + unitEnd, rest, false);
      return { value: number, unit: alias.unit, name: rest,
        servingText: source.slice(0, countedPrefix[0].length + unitEnd).trim(),
        uncertain: false, governedAlias: alias };
    }
  }
  // A-021: an ungoverned serving term cannot become an exact count of foods.
  // These are generic quantity/measure expressions, not a food identity list;
  // known S1 units and governed S2 unit aliases still retain their own path.
  // Counted containers/portions without an approved unit are *not* counts
  // of individual foods. This is quantity vocabulary, never a food-name list.
  const uncertainServing = new RegExp(
    "^(?:" + bounds + "\\s+(?:de\\s+)?)?(?:pouc[oa]s?|pouquinhos?|pouquinhas?|" +
      "tiquinhos?|bastante|punhados?|punhadinhos?|pedacos?|pedacinhos?|" +
      "pitadas?|goles?|garfadas?|colheradas?|canecas?|tigelas?|" +
      "cumbucas?|copinhos?|prat[aã]o|pratos?|marmitas?|potes?|" +
      "bandejas?|garrafas?|pacotes?|embalage(?:m|ns)|sach[eê]s?|" +
      "latas?|caixas?|frascos?|cartelas?|bisnagas?|" +
      "prato\\s+grande)(?=\\s|$)", "iu",
  );
  if (uncertainServing.test(foldFoodSurface(source)) ||
      /\b(tiquinho|punhado|prat[aã]o|prato grande|bastante)\b/iu.test(source)) {
    return unresolved();
  }
  const halfAfterFood = new RegExp(
    "^(" + quantityPattern + ")\\s+(.+?)\\s+e\\s+mei[ao]\\s*$", "iu",
  ).exec(source);
  if (halfAfterFood && !requireExplicitUnit) {
    const value = parseNumber(halfAfterFood[1]);
    if (value !== null) return {
      value: value + 0.5, unit: "un", name: halfAfterFood[2].trim(),
      servingText: source, uncertain: false,
    };
  }
  const simple = counted.exec(source);
  if (simple && !requireExplicitUnit) {
    const value = parseNumber(simple[1]);
    if (value !== null) {
      const name = source.slice(simple[0].length).trim();
      leading(simple[0].length, name);
      return { value, unit: "un", name, servingText: simple[0].trim(), uncertain: false };
    }
    return { value: null, unit: null, name: source, servingText: simple[0].trim(), uncertain: true };
  }
  return { value: null, unit: null, name: source, servingText: null, uncertain: false };
}

export function trimSpan(text: string, start: number, end: number): Segment | null {
  while (start < end && /\s/u.test(text[start])) start++;
  while (end > start && /\s/u.test(text[end - 1])) end--;
  return end > start ? { text: text.slice(start, end), start, end } : null;
}

/** Find conjunction tokens INSIDE an authorized protected phrase. Match complete
 * Unicode words, not folded-string offsets: folding can change UTF-16 lengths.
 * The returned offsets always refer to the original, untouched segment.
 */
function protectedConjunctions(
  segment: Segment, protectedTerms: readonly string[], connector = "e",
): Set<number> {
  const tokenPattern = /[\p{L}\p{N}][\p{L}\p{M}\p{N}]*/gu;
  const words = [...segment.text.matchAll(tokenPattern)].map(match => ({
    start: match.index, folded: foldFoodSurface(match[0]),
  }));
  const protectedOffsets = new Set<number>();
  for (const term of protectedTerms) {
    const phrase = [...term.matchAll(tokenPattern)].map(match => foldFoodSurface(match[0]));
    if (phrase.length < 3 || !phrase.includes(connector) || phrase.length > words.length) continue;
    for (let start = 0; start <= words.length - phrase.length; start++) {
      if (!phrase.every((word, offset) => words[start + offset].folded === word)) continue;
      for (let offset = 1; offset < phrase.length - 1; offset++) {
        if (phrase[offset] === connector) protectedOffsets.add(words[start + offset].start);
      }
    }
  }
  return protectedOffsets;
}

export type ExplicitIngredientMeasure = {
  owner: Segment;
  ingredient: Segment;
  measureSpan: Span;
  value: number;
  unit: string;
};

export type ExplicitIngredientNegation = {
  owner: Segment;
  ingredient: Segment;
  operator: Segment;
  conflictingGovernedOwner?: Span;
};

export type ExplicitPendingIncrement = {
  operator: Segment;
  measureSpan: Span;
  value: number;
  unit: string;
};

export type MaterialSegmentSyntax = {
  measure: ExplicitIngredientMeasure | null;
  negation: ExplicitIngredientNegation | null;
  materialOperator: boolean;
  continuation: boolean;
  withheldScope?: Span;
  pendingIncrement?: ExplicitPendingIncrement;
};

/** Segmentação por offsets UTF-16 do ORIGINAL, sem split sobre vírgula decimal.
 * Protected phrases come exclusively from the already authorized S2 snapshot.
 */
export function splitFoodSurface(
  text: string, governedUnits: readonly GovernedUnitAlias[] = [],
  protectedTerms: readonly string[] = [],
  material?: MaterialSegmentSyntax[],
  capturePendingIncrements = false,
): Segment[] {
  // A comma before a recognized material attribute belongs to the prior food.
  // Restrict the grammar to qualifiers understood by this LCL; new unknown
  // tokens are not silently consumed as food identity or a modifier.
  const materialQualifier = /^(?:(?:sem|com|zero)\s+(?:a[cç][uú]car|lactose|gl[uú]ten|sal|gordura|cafe[ií]na)\b|(?:frit[ao]s?|cozid[ao]s?|desnatad[ao]s?|integral|diet|light|uht)\b)/iu;
  // In the opt-in material grammar punctuation does not hide an operator.
  // Consult the same applicable S2 protected phrases with raw UTF-16 offsets.
  const rawOperators = material ? [...text.matchAll(
    /(?<![\p{L}\p{M}\p{N}])(?:com|sem|(?<increment>mais))(?![\p{L}\p{M}\p{N}])/giu,
  )] : [];
  const operatorsIn = (part: Segment) => rawOperators.filter(match =>
    match.index >= part.start && match.index + match[0].length <= part.end &&
    !protectedConjunctions(part, protectedTerms, foldFoodSurface(match[0])).has(match.index - part.start));
  // Balanced source groups do not introduce an independent food boundary
  // in material mode. An inner separator cannot leak the tail as a sibling.
  const groupingDepthDelta = new Int32Array(rawOperators.length ? text.length + 1 : 0);
  if (groupingDepthDelta.length) {
    const groups: { at: number; pair: number }[] = [];
    for (const match of text.matchAll(/[()[\]{}]/gu)) {
      const openingPair = "([{".indexOf(match[0]);
      if (openingPair >= 0) groups.push({ at: match.index, pair: openingPair });
      else if (groups.at(-1)?.pair === ")]}".indexOf(match[0])) {
        const opening = groups.pop()!;
        groupingDepthDelta[opening.at + 1]++;
        groupingDepthDelta[match.index]--;
      } else groups.length = 0;
    }
    for (let i = 1; i < groupingDepthDelta.length; i++) groupingDepthDelta[i] += groupingDepthDelta[i - 1];
  }
  let materialScope = false;
  const segments: Segment[] = [];
  const hardStops: number[] = [];
  let start = 0;
  const cut = (end: number, next: number) => {
    const segment = trimSpan(text, start, end);
    if (segment) segments.push(segment);
    start = next;
  };
  for (let i = 0; i < text.length; i++) {
    if (groupingDepthDelta[i] > 0) continue;
    const char = text[i];
    const hard = char === ";" || char === "\n";
    if (hard && material) hardStops.push(i);
    const betweenDigits = (char === "," || char === "/") &&
      /\d/u.test(text[i - 1] ?? "") && /\d/u.test(text[i + 1] ?? "");
    if (material && (char === "," || char === "/" || char === "+") && !betweenDigits) {
      const left = trimSpan(text, start, i);
      materialScope ||= left !== null && operatorsIn(left).length > 0;
    }
    // A slash or plus can continue a material clause, but never cuts a slash
    // fraction or restructures V2. Semicolon/newline end that scope.
    if (hard || !betweenDigits && (char === "," || (char === "/" || char === "+") && materialScope)) {
      cut(i, i + 1);
      if (hard) materialScope = false;
    }
  }
  cut(text.length, text.length);
  const coalesced: Segment[] = [];
  for (const segment of segments) {
    const previous = coalesced.at(-1);
    const amount = readQuantity(segment.text, governedUnits);
    const delimiter = text.slice(previous?.end ?? 0, segment.start);
    const comma = /^\s*,\s*$/u.test(delimiter);
    // Coordinators may follow comma, semicolon, CRLF or newline. Never infer
    // a delimiter from normalized text: all spans remain in the raw source.
    const listBoundary = /^[\s,;\r\n]+$/u.test(delimiter) && /[,;\r\n]/u.test(delimiter) ||
      Boolean(material && /^[ \t,\/+]+$/u.test(delimiter) && /[\/+]/u.test(delimiter));
    // A comma can delimit a meal destination, not necessarily a new food.
    // Preserve it in the original span; foodOnlySpan owns removing framing.
    const meal = "(?:caf[eé] da manh[aã]|almo[cç]o|jantar|lanche)";
    const mealFraming = new RegExp("^(?:no|na)\\s+" + meal + "$", "iu");
    // Comma-delimited command/destination framing must be joined to a real
    // quantity-led food before foodOnlySpan removes the command. Otherwise
    // "Registrar no almoco, 2 ovos" manufactures a phantom food.
    const commandFraming = new RegExp(
      "^(?:(?:adicionar|registrar|anotar|comi|consumi)(?:\\s+(?:(?:ao|no|na)\\s+" + meal + "))?" +
        "|(?:no|na)\\s+" + meal + "\\s+(?:comi|consumi))$", "iu",
    );
    const trailingMeal = new RegExp("^(?:(?:ao|no|na)\\s+|para\\s+(?:o|a)\\s+)" + meal + "$", "iu");
    const followingFood = amount.value !== null && amount.name.trim().length > 0;
    // With an explicit meal action, a counted quantity is not required to
    // know that the comma belongs to framing rather than to another food.
    const followingMealAction = /^(?:comi|consumi)\s+\S/iu.test(segment.text);
    const precedingFood = previous ? readQuantity(previous.text, governedUnits) : null;
    const continuesMaterial = material && previous && operatorsIn(previous).length > 0;
    if (previous && comma && !continuesMaterial && (
      // A-019: ", sem açúcar" / ", cozidos" extend the preceding food.
      // This never crosses a semicolon/newline, another actual food, or a bare
      // meal destination; the original comma stays inside the source span.
      (materialQualifier.test(segment.text) &&
        !mealFraming.test(previous.text) && !trailingMeal.test(previous.text) &&
        Boolean(precedingFood?.name.trim())) ||
      (amount.value !== null && amount.unit !== null && !amount.name &&
        precedingFood?.value === null) ||
      (mealFraming.test(previous.text) && (followingFood || followingMealAction)) ||
      (commandFraming.test(previous.text) && followingFood) ||
      (trailingMeal.test(segment.text) && precedingFood?.value !== null &&
        precedingFood?.value !== undefined && Boolean(precedingFood.name.trim()))
    )) {
      const merged = trimSpan(text, previous.start, segment.end);
      if (merged) coalesced[coalesced.length - 1] = merged;
    } else {
      // A standalone "e" after punctuation may coordinate the next food.
      // Its bytes stay in rawInput, but must not enter the next food's span.
      const coordinator = listBoundary && /^e\s+/iu.exec(segment.text);
      const following = coordinator
        ? trimSpan(text, segment.start + coordinator[0].length, segment.end)
        : null;
      const previousIsFood = previous && !mealFraming.test(previous.text) &&
        !trailingMeal.test(previous.text) && Boolean(precedingFood?.name.trim());
      if (previousIsFood && following) {
        if (materialQualifier.test(following.text)) {
          if (comma && !continuesMaterial) {
            // "iogurte, e sem lactose" is a qualifier continuation only
            // across comma, not a semicolon or line boundary.
            const merged = trimSpan(text, previous.start, segment.end);
            if (merged) coalesced[coalesced.length - 1] = merged;
          } else {
            coalesced.push(segment);
          }
        } else {
          coalesced.push(following);
        }
      } else {
        coalesced.push(segment);
      }
    }
  }
  const joined: Segment[] = [];
  for (const segment of coalesced) {
    // Protected brand/line phrases must be recognized before conjunction splitting.
    // A subsequent conjunction outside that phrase remains a list separator.
    const protectedOffsets = protectedConjunctions(segment, protectedTerms);
    // Do not split "fatia e meia", "um e meio" or phrases without a clear list boundary.
    const localMaterialScope = material && operatorsIn(segment).length > 0;
    const separator = /\s+e\s+(?=\S)/giu;
    // Both endpoints of an interval can be compound written numerals, so
    // connectors inside its quantitative prefix are not food separators.
    const intervalPrefix = new RegExp(
      "^(?:(?:de\\s+)?(?:" + quantityPattern + ")\\s+(?:a|ou|at[eé])\\s+(?:" + quantityPattern + ")" +
      "|entre\\s+(?:" + quantityPattern + ")\\s+e\\s+(?:" + quantityPattern + "))(?=\\s|$|\\p{L})", "iu",
    ).exec(segment.text);
    let offset = 0;
    let match: RegExpExecArray | null;
    while ((match = separator.exec(segment.text)) !== null) {
      if (intervalPrefix && separator.lastIndex <= intervalPrefix[0].length) continue;
      const conjunctionStart = match.index + match[0].search(/\S/u);
      if (groupingDepthDelta[segment.start + conjunctionStart] > 0 || protectedOffsets.has(conjunctionStart)) continue;
      const left = segment.text.slice(offset, match.index);
      const right = segment.text.slice(separator.lastIndex);
      // Do not turn a second material qualifier into a new food.
      // The conjoined expression still belongs to the same observation.
      if (!localMaterialScope && materialQualifier.test(right)) continue;
      // "uma fatia e meia", "dois ovos e meio" and "um e meio copo"
      // are quantities; "2 ovos e meio copo de leite" has two food items.
      // In a chained list the first conjunction may be a terminal fraction:
      // "dois ovos e meio e banana" => ["dois ovos e meio", "banana"].
      // But "dois ovos e meio copo de leite" still contains two foods.
      const chainedHalf = /^(mei[ao])(?=\s+e\s+)/iu.exec(right);
      const isAttachedHalf = chainedHalf !== null &&
        readQuantity(left + " e " + chainedHalf[1], governedUnits).value !== null;
      // A composed written amount has an internal 'e' ("vinte e duas").
      const writtenTens = new RegExp("^(?:" + tensPattern + ")$", "iu");
      const writtenOnes = new RegExp("^(?:" + onesPattern + ")\\b", "iu");
      // Quantity may follow a command, meal framing or pictographic marker.
      // Read the terminal numeral words, not just the segment's first word.
      const composedAmount = new RegExp("(?:^|\\s)(?:" + tensPattern + ")$", "iu")
        .test(left.trim()) && writtenOnes.test(right);
      // Protect both connectors in 'cento e vinte e duas fatias', not just
      // the second one; a complete food-list conjunction remains splittable.
      const lowerNumber = new RegExp("^(?:" + underHundredPattern + ")\\b", "iu");
      const hundredsContinuation = new RegExp("(?:^|\\s)(?:" + hundredsPattern +
        ")(?:\\s+e\\s+(?:" + tensPattern + "))?$", "iu")
        .test(left.trim()) && lowerNumber.test(right);
      // A-022: "entre 2 e 3 ovos" is one uncertain quantity, not two foods.
      // Preserve the original UTF-16 span; do not protect an ordinary list.
      const rangeEnd = new RegExp("^(?:" + quantityPattern + ")(?=\\s|$|\\p{L})", "iu");
      const betweenBounds = new RegExp("(?:^|\\s)entre\\s+(?:" + quantityPattern + ")$", "iu")
        .test(left.trim()) && rangeEnd.test(right);
      // Written and numeric whole counts can take a following "e meio/meia".
      // Do not shield "2 ovos e meio copo": its left side is not a number.
      const leadingAmount = new RegExp("(?:^|\\s)(" + quantityPattern + ")$", "iu")
        .exec(left.trim());
      const leadingHalf = leadingAmount !== null &&
        Number.isInteger(parseNumber(leadingAmount[1])) && /^mei[ao]\b/iu.test(right);
      if (composedAmount || hundredsContinuation || isAttachedHalf || betweenBounds || leadingHalf ||
          /^mei[ao](?:\s+de\b|\s*$)/iu.test(right)) continue;
      const part = trimSpan(text, segment.start + offset, segment.start + match.index);
      if (part) joined.push(part);
      offset = separator.lastIndex;
    }
    const tail = trimSpan(text, segment.start + offset, segment.end);
    if (tail) joined.push(tail);
  }
  // The same splitter owns raw boundaries, constituents and any withheld tail.
  if (!material) return joined;

  // Decide which *existing* hard blocks lack an independent observation
  // before a soft split or quantity alternative can manufacture one.
  const withheldBlocks = new Map<number, Span>();
  const terminalOrphans = new Set<number>();
  const overBudgetParts = new Set<Segment>();
  const hardBlocks = [...hardStops, text.length].map((end, i) =>
    trimSpan(text, i === 0 ? 0 : hardStops[i - 1] + 1, end));
  let blockIndex = 0;
  for (const part of joined) {
    while (part.start > (hardStops[blockIndex] ?? text.length)) blockIndex++;
    const block = hardBlocks[blockIndex];
    if (!block || part.start < block.start || part.end > block.end) continue;
    const slots: FoodQuantitySourceSpans = {};
    const parsed = readQuantity(part.text, governedUnits, false, slots);
    if (parsed.governedAlias?.unit === null &&
        parsed.governedAlias.candidates.length > FOOD_CONTRACT_LIMITS.alternatives) {
      overBudgetParts.add(part); // Let the existing builder report its limit.
      continue;
    }
    if (slots.orphanedGovernedUnit) {
      withheldBlocks.set(blockIndex, { start: block.start, end: block.end });
      if (part.end === block.end) terminalOrphans.add(blockIndex);
    }
  }
  const deContinuationAfter = (i: number) => {
    const from = hardBlocks[i];
    let next = i + 1;
    while (next < hardBlocks.length && !hardBlocks[next]) next++;
    const to = hardBlocks[next];
    // Do not rejoin lines or promote their meaning. Only an explicit 'de'
    // at the start of the next nonempty line block can share the omission;
    // a semicolon in the original gap still establishes independence.
    return from && to && /^de(?:[ \t]+|$)/iu.test(to.text) &&
      /^[ \t\r]*\n[ \t\r\n]*$/u.test(text.slice(from.end, to.start)) ? next : null;
  };
  for (const i of terminalOrphans) {
    const next = deContinuationAfter(i);
    if (next !== null) {
      const to = hardBlocks[next]!;
      withheldBlocks.set(next, { start: to.start, end: to.end });
    }
  }

  const parts: Segment[] = [];
  // A label is not a catch-all for whatever follows a measured ingredient.
  // Accept only words joined by ordinary spacing or intra-word punctuation.
  const nameWord = "[\\p{L}][\\p{L}\\p{M}]*(?:['’\\p{Pd}][\\p{L}][\\p{L}\\p{M}]*)*";
  const simpleName = new RegExp("^" + nameWord + "$", "u");
  const lexicalName = new RegExp("^" + nameWord + "(?:[ \\t]+" + nameWord + ")*$", "u");
  const startsWithNumber = new RegExp("^(?:[0-9¼½¾]|(?:" + writtenPattern + ")(?=\\s|$))", "iu");
  let stopIndex = 0;
  let block = trimSpan(text, 0, hardStops[0] ?? text.length);
  const negationOperator = /^sem$/iu;
  const hasNegationOperator = (scope: Segment | null) =>
    scope !== null && operatorsIn(scope).some(match => negationOperator.test(match[0]));
  let blockHasNegation = hasNegationOperator(block);
  for (const part of joined) {
    while (part.start > (hardStops[stopIndex] ?? text.length)) {
      const start = hardStops[stopIndex++] + 1;
      block = trimSpan(text, start, hardStops[stopIndex] ?? text.length);
      blockHasNegation = hasNegationOperator(block);
    }
    const operators = operatorsIn(part);
    const previous = parts.at(-1);
    const gap = previous ? text.slice(previous.end, part.start) : "";
    const continuation = /^[ \t]+e[ \t]+$/iu.test(gap) ||
      /^[ \t,\/+]*(?:e[ \t]+)?$/iu.test(gap) && /[,\/+]/u.test(gap);
    // A soft split is not independent proof of the scope of a negation.
    // Require a single complete hard-bounded clause on both sides of "sem".
    let negation: ExplicitIngredientNegation | null = null;
    const op = operators.length === 1 ? operators[0] : null;
    if (op && block?.start === part.start && block.end === part.end &&
        negationOperator.test(op[0]) && !groupingDepthDelta[op.index] &&
        /[ \t]/u.test(text[op.index - 1] ?? "") &&
        /[ \t]/u.test(text[op.index + op[0].length] ?? "")) {
      const operator = { text: op[0], start: op.index, end: op.index + op[0].length };
      const owner = trimSpan(text, part.start, operator.start);
      const ingredient = trimSpan(text, operator.end, part.end);
      const ownerSlots: FoodQuantitySourceSpans = {};
      const parsedOwner = owner && readQuantity(owner.text, governedUnits, false, ownerSlots);
      const pendingName = ownerSlots.nameAfterConflictingUnit;
      if (owner && parsedOwner && ingredient && ingredient.text.length <= FOOD_CONTRACT_LIMITS.nameText &&
          // The quantity reader already owns the exact measured prefix. What
          // remains must be one local nominal slot, not a command or a list.
          simpleName.test(pendingName ? owner.text.slice(pendingName.start, pendingName.end) : parsedOwner.name) &&
          !/[()[\]{}]/u.test(owner.text) &&
          !/(?<![\p{L}\p{M}\p{N}])ou(?![\p{L}\p{M}\p{N}])/iu.test(owner.text) &&
          simpleName.test(ingredient.text) && !startsWithNumber.test(ingredient.text.split(/\p{Pd}/u)[0]) &&
          !/^(?:e|ou|zero|nada|nenhum[ao]?|qualquer)$/iu.test(ingredient.text) &&
          recognizedUnit(ingredient.text) === null &&
          !readQuantity(ingredient.text, governedUnits).uncertain &&
          !governedUnits.some(entry => foldFoodSurface(entry.term) === foldFoodSurface(ingredient.text))) {
        negation = { owner, ingredient, operator, ...(pendingName && { conflictingGovernedOwner: {
          start: owner.start + pendingName.start, end: owner.start + pendingName.end,
        } }) };
      }
    }
    let found: { measure: ExplicitIngredientMeasure; remainder: Segment | null } | null = null;
    bindMeasure: {
      const connectors = operators.filter(match => /^com$/iu.test(match[0]) &&
        /\s/u.test(text[match.index - 1] ?? "") &&
        /\s/u.test(text[match.index + match[0].length] ?? ""));
      if (operators.length !== 1 || connectors.length !== 1) break bindMeasure;
      const connector = connectors[0].index;
      const owner = trimSpan(text, part.start, connector);
      const suffix = trimSpan(text, connector + 3, part.end);
      if (!owner || !suffix || /(?<![\p{L}\p{M}\p{N}])ou(?![\p{L}\p{M}\p{N}])/iu.test(owner.text)) break bindMeasure;

      const parsed = readQuantity(suffix.text, governedUnits, true);
      if (parsed.value === null || parsed.unit === null || parsed.uncertain ||
          !parsed.servingText || !parsed.name || !suffix.text.endsWith(parsed.name) ||
          !suffix.text.startsWith(parsed.servingText)) break bindMeasure;
      const ingredientStart = suffix.end - parsed.name.length;
      // Inspect the earliest candidate only. If the quantity grammar cannot
      // prove it exact, a later number must not be used to cut an interval or
      // leave an implicit quantity inside the first ingredient label.
      const nameSearch = parsed.name.slice(0, FOOD_CONTRACT_LIMITS.nameText + 2);
      const second = [...nameSearch.matchAll(/(?:^|\s)(?=\S)/gu)].find(match =>
        startsWithNumber.test(parsed.name.slice(match.index + match[0].length)));
      const remainder = second
        ? trimSpan(text, ingredientStart + second.index + second[0].length, suffix.end) : null;
      if (remainder) {
        const nested = readQuantity(remainder.text, governedUnits, true);
        if (nested.value === null || nested.unit === null || nested.uncertain) break bindMeasure;
      }
      const ingredient = trimSpan(text, ingredientStart, second
        ? ingredientStart + second.index : suffix.end);
      if (!ingredient || ingredient.text.length > FOOD_CONTRACT_LIMITS.nameText ||
          !lexicalName.test(ingredient.text) ||
          // An unpunctuated second amount only leaves an unambiguous boundary
          // after a single intact name token. Do not guess whether preceding
          // words belong to the term or introduce the next quantity.
          (second && !simpleName.test(ingredient.text)) ||
          /(?<![\p{L}\p{M}\p{N}])(?:e|ou|com|sem|mais)(?![\p{L}\p{M}\p{N}])/iu.test(ingredient.text)) break bindMeasure;
      const measureEnd = suffix.start + parsed.servingText.replace(/\s+de$/iu, "").length;
      if (measureEnd >= ingredient.start ||
          !/^\s+(?:de\s+)?$/iu.test(text.slice(measureEnd, ingredient.start))) break bindMeasure;
      found = {
        measure: { owner, ingredient, measureSpan: { start: suffix.start, end: measureEnd },
          value: parsed.value, unit: parsed.unit },
        remainder,
      };
    }
    const withheldScope = overBudgetParts.has(part) ? undefined : withheldBlocks.get(stopIndex);
    let pendingIncrement: ExplicitPendingIncrement | undefined;
    const incrementToken = op?.groups?.increment;
    if (capturePendingIncrements && !withheldScope && !found && !negation && op &&
        // The broad Unicode scanner can recognize case-folding lookalikes;
        // this profile promises the literal Portuguese operator only.
        incrementToken && /^[\x00-\x7f]+$/u.test(incrementToken) &&
        op.index === part.start && !groupingDepthDelta[op.index] &&
        block?.start === part.start && block.end === part.end &&
        deContinuationAfter(stopIndex) === null) {
      const operatorEnd = op.index + op[0].length;
      const suffix = trimSpan(text, operatorEnd, part.end);
      if (suffix && /^[ \t]+$/u.test(text.slice(operatorEnd, suffix.start))) {
        const slots: FoodQuantitySourceSpans = {};
        const amount = readQuantity(suffix.text, governedUnits, true, slots);
        // The same reader must consume the whole explicit quantity: no
        // trailing 'de', name, interpreted owner, or fallback implicit unit.
        // This proof is text/transcription only: no promoted governed
        // unit alias whose canonical meaning would need separate evidence.
        if (amount.value !== null && amount.unit !== null && !amount.name && !amount.uncertain &&
            !amount.governedAlias &&
            slots.quantity?.start === 0 && slots.quantity.end === suffix.text.length) {
          pendingIncrement = {
            operator: { start: op.index, end: operatorEnd, text: op[0] },
            measureSpan: { start: suffix.start, end: suffix.end },
            value: amount.value, unit: amount.unit,
          };
        }
      }
    }
    const remainder = found?.remainder;
    const initial = remainder && found
      ? trimSpan(text, part.start, found.measure.ingredient.end) : part;
    if (!initial) continue;
    parts.push(initial);
    // Until the soft-scope case has typed candidates, don't present another
    // unproved fragment in the same negation block as an independent food.
    material.push({ measure: found?.measure ?? null, negation,
      materialOperator: operators.length > 0 || blockHasNegation, continuation, withheldScope, pendingIncrement });
    if (remainder) {
      parts.push(remainder);
      material.push({ measure: null, negation: null, materialOperator: true, continuation: true, withheldScope });
    }
  }
  return parts;
}
