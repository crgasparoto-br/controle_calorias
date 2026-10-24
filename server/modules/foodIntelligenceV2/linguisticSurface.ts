/** Canonical locale pt-BR surface grammar for Food Intelligence V2 (#1304).
 * Syntax, units, numerals and source spans only: no catalog, identity or macros.
 * Maintained separately from orchestration to keep one auditable owner per layer.
 */
export type Span = { start: number; end: number };
export type Segment = Span & { text: string };
/** Pre-authorized S2 aliases only; a null unit denotes conflicting meanings. */
export type GovernedUnitAlias = {
  term: string;
  unit: string | null;
  entryId: number | null;
  confidence: number | null;
  candidates: readonly { entryId: number; unit: string; confidence: number | null }[];
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
  meio: 0.5, meia: 0.5,
};
const onesPattern = "um|uma|dois|duas|tr[eê]s|quatro|cinco|seis|sete|oito|nove";
const tensPattern = "vinte|trinta|quarenta|cinquenta|sessenta|setenta|oitenta|noventa";
const writtenPattern = "(?:" + tensPattern + ")(?:\\s+e\\s+(?:" + onesPattern + "))?|" +
  "onze|doze|treze|catorze|quatorze|quinze|dezesseis|dezasseis|dezessete|dezoito|dezenove|dez|" +
  onesPattern + "|meio|meia";
const unitPattern = "g|gr|gramas?|kg|quilos?|ml|mililitros?|l|litros?|un|unidades?|fatias?|colher(?:es)?|x[ií]caras?|copos?|por[cç][oõ](?:es|s)?|por[cç][aã]o";
// Slash fractions and vulgar fractions are quantitative only in the leading
// quantity slot; the original surface/UTF-16 anchors are never rewritten.
const quantityPattern = "\\d+/\\d+|\\d+(?:[,.]\\d+)?|[¼½¾]|" + writtenPattern;
const quantified = new RegExp("^(" + quantityPattern + ")(?:\\s+|(?<=\\d))(" + unitPattern + ")\\b\\s*(?:de\\s+)?", "iu");
const halfAfterUnit = new RegExp("^(" + quantityPattern + ")(?:\\s+|(?<=\\d))(" + unitPattern + ")\\s+e\\s+mei[ao]\\b\\s*(?:de\\s+)?", "iu");
const counted = new RegExp("^(" + quantityPattern + ")\\s+(?:de\\s+)?", "iu");

export function foldFoodSurface(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR").replace(/\s+/gu, " ").trim();
}

function parseNumber(value: string): number | null {
  const folded = foldFoodSurface(value);
  if (Object.prototype.hasOwnProperty.call(writtenNumbers, folded)) return writtenNumbers[folded];
  const words = folded.split(" e ");
  if (words.length === 2 && writtenNumbers[words[0]] >= 20 &&
      writtenNumbers[words[0]] % 10 === 0 &&
      writtenNumbers[words[1]] >= 1 && writtenNumbers[words[1]] <= 9) {
    return writtenNumbers[words[0]] + writtenNumbers[words[1]];
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
  // '1.000' is ambiguous between decimal and thousands: do not guess.
  if (/^\d{1,3}[,.]\d{3}$/.test(folded)) return null;
  if (!/^\d+(?:[,.]\d+)?$/.test(folded)) return null;
  const number = Number(folded.replace(",", "."));
  return Number.isFinite(number) && number > 0 ? number : null;
}

export function recognizedUnit(value: string): string | null {
  return unitMap[foldFoodSurface(value)] ?? null;
}

export function readQuantity(text: string, governedUnits: readonly GovernedUnitAlias[] = []): {
  value: number | null; unit: string | null; name: string;
  servingText: string | null; uncertain: boolean; governedAlias?: GovernedUnitAlias;
} {
  const source = text.trim();
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
      return { value: value + 0.5, unit, name: source.slice(half[0].length).trim(), servingText: half[0].trim(), uncertain: false };
    }
  }
  const withUnit = quantified.exec(source);
  if (withUnit) {
    const value = parseNumber(withUnit[1]);
    const unit = recognizedUnit(withUnit[2]);
    if (value !== null && unit !== null) {
      return { value, unit, name: source.slice(withUnit[0].length).trim(), servingText: withUnit[0].trim(), uncertain: false };
    }
  }
  const writtenHalfWithUnit = new RegExp("^(um|uma|\\d+)\\s+e\\s+mei[ao]\\s+(" + unitPattern + ")\\b\\s*(?:de\\s+)?", "iu").exec(source);
  if (writtenHalfWithUnit) {
    const value = parseNumber(writtenHalfWithUnit[1]);
    const unit = recognizedUnit(writtenHalfWithUnit[2]);
    if (value !== null && unit !== null) return {
      value: value + 0.5, unit, name: source.slice(writtenHalfWithUnit[0].length).trim(),
      servingText: writtenHalfWithUnit[0].trim(), uncertain: false,
    };
  }
  const oneAndHalf = /^(um|uma|\d+)\s+e\s+mei[ao]\b\s*(?:de\s+)?/iu.exec(source);
  if (oneAndHalf) {
    const value = parseNumber(oneAndHalf[1]);
    if (value !== null) return { value: value + 0.5, unit: "un", name: source.slice(oneAndHalf[0].length).trim(), servingText: oneAndHalf[0].trim(), uncertain: false };
  }
  // A comma-delimited trailing quantity can describe the preceding food:
  // "mortadela, uma fatia e meia". Do not manufacture another food item.
  const trailing = /^(.+?),\s*(.+)$/u.exec(source);
  if (trailing) {
    const suffix = readQuantity(trailing[2], governedUnits);
    if (suffix.value !== null && suffix.unit !== null && !suffix.name) {
      return { ...suffix, name: trailing[1].trim() };
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
      if (number === null || alias.unit === null) {
        return { value: null, unit: null, name: source, servingText: countedPrefix[0].trim(),
          uncertain: true, governedAlias: alias };
      }
      const lastWord = words[alias.term.split(/\s+/u).length - 1];
      const rest = remaining.slice((lastWord.index ?? 0) + lastWord[0].length)
        .trim().replace(/^de\s+/iu, "");
      return { value: number, unit: alias.unit, name: rest,
        servingText: source.slice(0, countedPrefix[0].length + (lastWord.index ?? 0) + lastWord[0].length).trim(),
        uncertain: false, governedAlias: alias };
    }
  }
  // A-021: an ungoverned serving term cannot become an exact count of foods.
  // These are generic quantity/measure expressions, not a food identity list;
  // known S1 units and governed S2 unit aliases still retain their own path.
  // Counted containers/portions without an approved unit are *not* counts
  // of individual foods. This is quantity vocabulary, never a food-name list.
  const uncertainServing = new RegExp(
    "^(?:" + bounds + "\\s+)?(?:pouc[oa]s?|pouquinhos?|pouquinhas?|" +
      "tiquinhos?|bastante|punhados?|punhadinhos?|pedacos?|pedacinhos?|" +
      "pitadas?|goles?|garfadas?|colheradas?|canecas?|tigelas?|" +
      "cumbucas?|copinhos?|prat[aã]o|pratos?|marmitas?|potes?|" +
      "bandejas?|garrafas?|pacotes?|embalagens?|sach[eê]s?|" +
      "prato\\s+grande)(?=\\s|$)", "iu",
  );
  if (uncertainServing.test(foldFoodSurface(source)) ||
      /\b(tiquinho|punhado|prat[aã]o|prato grande|bastante)\b/iu.test(source)) {
    return unresolved();
  }
  const halfAfterFood = new RegExp(
    "^(" + quantityPattern + ")\\s+(.+?)\\s+e\\s+mei[ao]\\s*$", "iu",
  ).exec(source);
  if (halfAfterFood) {
    const value = parseNumber(halfAfterFood[1]);
    if (value !== null) return {
      value: value + 0.5, unit: "un", name: halfAfterFood[2].trim(),
      servingText: source, uncertain: false,
    };
  }
  const simple = counted.exec(source);
  if (simple) {
    const value = parseNumber(simple[1]);
    if (value !== null) return { value, unit: "un", name: source.slice(simple[0].length).trim(), servingText: simple[0].trim(), uncertain: false };
    return { value: null, unit: null, name: source, servingText: simple[0].trim(), uncertain: true };
  }
  return { value: null, unit: null, name: source, servingText: null, uncertain: false };
}

export function trimSpan(text: string, start: number, end: number): Segment | null {
  while (start < end && /\s/u.test(text[start])) start++;
  while (end > start && /\s/u.test(text[end - 1])) end--;
  return end > start ? { text: text.slice(start, end), start, end } : null;
}

/** Segmentação por offsets UTF-16 do ORIGINAL, sem split sobre vírgula decimal. */
export function splitFoodSurface(text: string, governedUnits: readonly GovernedUnitAlias[] = []): Segment[] {
  // A comma before a recognized material attribute belongs to the prior food.
  // Restrict the grammar to qualifiers understood by this LCL; new unknown
  // tokens are not silently consumed as food identity or a modifier.
  const materialQualifier = /^(?:(?:sem|com|zero)\s+(?:a[cç][uú]car|lactose|gl[uú]ten|sal|gordura|cafe[ií]na)\b|(?:frit[ao]s?|cozid[ao]s?|desnatad[ao]s?|integral|diet|light|uht)\b)/iu;
  const segments: Segment[] = [];
  let start = 0;
  const cut = (end: number, next: number) => {
    const segment = trimSpan(text, start, end);
    if (segment) segments.push(segment);
    start = next;
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === ";" || char === "\n" || (char === "," && !(/\d/u.test(text[i - 1] ?? "") && /\d/u.test(text[i + 1] ?? "")))) {
      cut(i, i + 1);
    }
  }
  cut(text.length, text.length);
  const coalesced: Segment[] = [];
  for (const segment of segments) {
    const previous = coalesced.at(-1);
    const amount = readQuantity(segment.text, governedUnits);
    const comma = /^\s*,\s*$/u.test(text.slice(previous?.end ?? 0, segment.start));
    // A comma can delimit a meal destination, not necessarily a new food.
    // Preserve it in the original span; foodOnlySpan owns removing framing.
    const meal = "(?:caf[eé] da manh[aã]|almo[cç]o|jantar|lanche)";
    const mealFraming = new RegExp("^(?:no|na)\\s+" + meal + "$", "iu");
    const trailingMeal = new RegExp("^(?:(?:ao|no|na)\\s+|para\\s+(?:o|a)\\s+)" + meal + "$", "iu");
    const followingFood = amount.value !== null && amount.name.trim().length > 0;
    const precedingFood = previous ? readQuantity(previous.text, governedUnits) : null;
    if (previous && comma && (
      // A-019: ", sem açúcar" / ", cozidos" extend the preceding food.
      // This never crosses a semicolon/newline, another actual food, or a bare
      // meal destination; the original comma stays inside the source span.
      (materialQualifier.test(segment.text) &&
        !mealFraming.test(previous.text) && !trailingMeal.test(previous.text) &&
        Boolean(precedingFood?.name.trim())) ||
      (amount.value !== null && amount.unit !== null && !amount.name &&
        precedingFood?.value === null) ||
      (mealFraming.test(previous.text) && followingFood) ||
      (trailingMeal.test(segment.text) && precedingFood?.value !== null &&
        precedingFood?.value !== undefined && Boolean(precedingFood.name.trim()))
    )) {
      const merged = trimSpan(text, previous.start, segment.end);
      if (merged) coalesced[coalesced.length - 1] = merged;
    } else {
      coalesced.push(segment);
    }
  }
  const joined: Segment[] = [];
  for (const segment of coalesced) {
    // Do not split "fatia e meia", "um e meio" or phrases without a clear list boundary.
    const separator = /\s+e\s+(?=\S)/giu;
    let offset = 0;
    let match: RegExpExecArray | null;
    while ((match = separator.exec(segment.text)) !== null) {
      const left = segment.text.slice(offset, match.index);
      const right = segment.text.slice(separator.lastIndex);
      // Do not turn a second material qualifier into a new food.
      // The conjoined expression still belongs to the same observation.
      if (/^(?:sem|com|zero)\s+[\p{L}]/iu.test(right) ||
          /^(?:frit[ao]s?|cozid[ao]s?)\s*$/iu.test(right)) continue;
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
      const composedAmount = writtenTens.test(left.trim()) && writtenOnes.test(right);
      // A-022: "entre 2 e 3 ovos" is one uncertain quantity, not two foods.
      // Preserve the original UTF-16 span; do not protect an ordinary list.
      const rangeStart = new RegExp("^entre\\s+(?:" + quantityPattern + ")$", "iu");
      const rangeEnd = new RegExp("^(?:" + quantityPattern + ")(?=\\s|$|\\p{L})", "iu");
      const betweenBounds = rangeStart.test(left.trim()) && rangeEnd.test(right);
      if (composedAmount || isAttachedHalf || betweenBounds ||
          /^mei[ao](?:\s+de\b|\s*$)/iu.test(right) ||
          (/^(?:um|uma|\d+)\s*$/iu.test(left) && /^mei[ao]\b/iu.test(right))) continue;
      const part = trimSpan(text, segment.start + offset, segment.start + match.index);
      if (part) joined.push(part);
      offset = separator.lastIndex;
    }
    const tail = trimSpan(text, segment.start + offset, segment.end);
    if (tail) joined.push(tail);
  }
  return joined;
}
