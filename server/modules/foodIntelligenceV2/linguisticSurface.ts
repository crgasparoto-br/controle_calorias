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
  meio: 0.5, meia: 0.5,
};
const unitPattern = "g|gr|gramas?|kg|quilos?|ml|mililitros?|l|litros?|un|unidades?|fatias?|colheres?|x[ií]caras?|copos?|por[cç][oõ](?:es|s)?|por[cç][aã]o";
const quantityPattern = "\\d+(?:[,.]\\d+)?|um|uma|dois|duas|tr[eê]s|quatro|cinco|seis|sete|oito|nove|dez|meio|meia";
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
  if (/\b(tiquinho|punhado|prat[aã]o|prato grande|bastante)\b/iu.test(source)) {
    return { value: null, unit: null, name: source, servingText: source, uncertain: true };
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
    if (previous && amount.value !== null && amount.unit !== null && !amount.name &&
        readQuantity(previous.text, governedUnits).value === null &&
        /^\s*,\s*$/u.test(text.slice(previous.end, segment.start))) {
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
      // "uma fatia e meia" and "um e meio" are grammatical quantity phrases.
      if (/^mei[ao]\b/iu.test(right) ||
          (/\b(?:fatia|fatias|unidade|unidades)\s*$/iu.test(left) &&
            /^(?:meia|meio)\b/iu.test(right))) continue;
      const part = trimSpan(text, segment.start + offset, segment.start + match.index);
      if (part) joined.push(part);
      offset = separator.lastIndex;
    }
    const tail = trimSpan(text, segment.start + offset, segment.end);
    if (tail) joined.push(tail);
  }
  return joined;
}

