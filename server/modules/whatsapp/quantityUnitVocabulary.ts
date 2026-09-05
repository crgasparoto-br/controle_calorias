export const UNIT_WORDS = {
  gramas: "g|gr|gramas?",
  quilos: "kg|quilos?",
  quilosOnly: "kg",
  miligramas: "mg",
  mililitros: "ml|mililitros?",
  mililitrosCompact: "ml|m\\s*l|mililitros?",
  mililitrosOnly: "ml",
  litros: "l|litros?",
  litrosOnly: "l",
  unidades: "un|unidades?",
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

export const COUNT_WORD_PATTERN = "um|uma|dois|duas|tr[eê]s|quatro|cinco|seis|sete|oito|nove|dez";
export const COUNTABLE_QUANTITY_PATTERN = `(?:\\d+(?:[,.]\\d+)?|${COUNT_WORD_PATTERN})`;

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
  return keys.map((key) => UNIT_WORDS[key]).join("|");
}
