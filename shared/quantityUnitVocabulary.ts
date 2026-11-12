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
  // Generic portion forms, not food identities. Their unknown gram conversion
  // must not erase a concurrent amount of the measured ingredient.
  "un", "und", "unidade", "unidades", "cubo", "cubos", "cubinho", "cubinhos",
  "torrao", "torroes", "pedaco", "pedacos", "medida", "medidas",
]);
const UNCERTAIN_QUANTITY_WORDS = new Set([
  "meio", "meia", "metade", "algum", "alguns", "alguma", "algumas",
  "uns", "umas", "varios", "varias", "muitos", "muitas", "poucos", "poucas",
]);

// A genitive identifies the owner of a quantity, independently of the ingredient.
function isGenitivePreposition(value: string): boolean {
  return /^(?:de|do|da|dos|das)$/u.test(value);
}

/** Structural spoon names are not the ingredient following a genitive. */
function isSpoonDenomination(word: string): boolean {
  return word === "cafe" || word === "sobremesa" || word === "cha" || word === "sopa";
}

function isSpoonAmountModifier(word: string): boolean {
  return word === "bem" || word === "rasa" || word === "rasas" ||
    word === "raso" || word === "rasos" || word === "cheia" ||
    word === "cheias" || word === "cheio" || word === "cheios" ||
    word === "nivelada" || word === "niveladas";
}

/** A spoon's size ("de café"/"de sobremesa") is not its food ingredient. */
function readSpoonIngredientAfterUnit(surface: string): string | null {
  const words = surface.trim().split(/\s+/u);
  if (!isGenitivePreposition(words[0] ?? "")) return null;
  const first = words[1];
  if (!first) return null;
  // Reuse the existing genitive grammar instead of inferring food identities.
  if (!isSpoonDenomination(first)) return first;
  let index = 2;
  while (isSpoonAmountModifier(words[index] ?? "")) index += 1;
  return isGenitivePreposition(words[index] ?? "") ? (words[index + 1] ?? null) : null;
}

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
    // Unknown gram conversions are still measured amounts when the head is a
    // generic utensil. Do not broaden this to all unbound colloquial measures:
    // "leite com duas gotinhas" has its own backwards ingredient binding.
    const hasUnit = compactUnit || UNBOUND_QUANTITY_UNITS.has(unit) ||
      PORTION_CONTAINER_HEAD.test(unit) || UNVERIFIED_MEASURE_HEAD.test(unit);
    const subjectOffset = compactUnit && isGenitivePreposition(words[index + 1] ?? "") ? 2 :
      hasUnit && words[index + 2] === "a" && words[index + 3] === "mais" &&
        isGenitivePreposition(words[index + 4] ?? "") ? 5 :
      hasUnit && isGenitivePreposition(words[index + 2] ?? "") ? 3 :
      isGenitivePreposition(words[index + 3] ?? "") && hasUnit ? 4 : 0;
    // A missing unit is still a quantity when its ingredient is explicit:
    // "duas de <ingredient>" or "meia a mais de <ingredient>". Keep the
    // ingredient binding rather than silently dropping the second amount.
    const elidedSubject = !hasUnit && isGenitivePreposition(unit) ? words[index + 2] :
      !hasUnit && unit === "a" && words[index + 2] === "mais" &&
        isGenitivePreposition(words[index + 3] ?? "") ? words[index + 4] :
      !hasUnit && (isMeasureHead(unit) || /^(?:extras?|adiciona(?:l|is))$/u.test(unit)) &&
        isGenitivePreposition(words[index + 3] ?? "") ? words[index + 4] :
      // "um bolo com gotas de acucar" counts a food, not the sugar.
      !hasUnit && isMeasureHead(unit) && words[index + 2] !== "com" && words[index + 3] !== "com" &&
        isGenitivePreposition(words[index + 4] ?? "") ? words[index + 5] : null;
    if (subjectOffset && words[index + subjectOffset]) {
      bindings.push(words[index + subjectOffset]);
    } else if (elidedSubject) {
      bindings.push(elidedSubject);
    } else if (
      hasUnit || isGenitivePreposition(unit) || !unit ||
      // A preceding alternative/coordination can lose its final operand
      // when the spoon matcher consumes only the last count ("1 ou 2").
      // It is unresolved quantity syntax, not an independent serving.
      // Coordination may be compact or compound ("e/ou", "ou/e", "e-ou").
      // Treat the preceding operand as unresolved rather than reading only
      // the final count attached to the spoon.
      /^(?:e|ou|a|ate)(?:[\/&-](?:e|ou|a|ate))*$/u.test(unit) ||
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

/** Only syntax-level measure heads, never a catalog of food identities. */
const UNCOUNTED_HOUSEHOLD_MEASURE = new RegExp(
  `^(?:${UNIT_WORDS.colheresGeneric}|${UNIT_WORDS.porcoesPlain}|${UNIT_WORDS.fatias}|${UNIT_WORDS.copos}|${UNIT_WORDS.xicarasPlain}|${UNIT_WORDS.doses})$`,
  "u",
);
const UNCOUNTED_INFORMAL_MEASURE =
  /^(?:colheradas?|colherzinhas?|porcaozinhas?|gotinhas?|pitadinhas?|pouquinhas?|pouquinhos?|poucos?|poucas?|tiquinhos?|tiquinhas?|cadinhos?|cadinhas?|bocados?|restos?|restinhos?|restinhas?|pontinhas?|pontinhos?|toques?|quantidades?|montes?|camadas?|sacos?|potes?|embalagens?|pacotinhos?|punhadinhos?|saquinhos?|saquetas?|tabletes?|pedrinhas?|tampinhas?|canecas?|potinhos?|bisnagas?|envelopes?|embalagemzinhas?|embalage(?:m|ns)|caixas?|caixinhas?|cubos?|cubinhos?|garrafinhas?|frasquinhos?)$/u;
// Heads that describe a physical portion but have no safe gram conversion.
// Only linguistic measure forms belong here, never food identities.
const UNVERIFIED_MEASURE_HEAD = /^(?:pas?|pazinh[oa]s?|conchas?|conchinhas?|tampas?|scoops?)$/u;
const PORTION_CONTAINER_HEAD =
  /^(?:saquinhos?|saquetas?|tabletes?|pedrinhas?|tampinhas?|canecas?|potinhos?|bisnagas?|envelopes?|embalagemzinhas?|sacos?|potes?|embalage(?:m|ns)|pacotinhos?|caixas?|caixinhas?|cubos?|cubinhos?|garrafinhas?|frasquinhos?)$/u;
function isMeasureHead(head: string): boolean {
  return UNBOUND_QUANTITY_UNITS.has(head) ||
    UNCOUNTED_HOUSEHOLD_MEASURE.test(head) ||
    UNCOUNTED_INFORMAL_MEASURE.test(head) || UNVERIFIED_MEASURE_HEAD.test(head);
}

/** A genitive is not always another food: an uncounted measure of the same
 * ingredient is ambiguous, while "cake with drops of sugar" is a separate food. */
function hasUncountedMeasureGenitive(
  before: string, isBoundToOther: (start: number) => boolean,
): boolean {
  const phrase = /(?:^|[\s,;.!?:])([a-z]+)(?:\s+([a-z]+))?\s+(?:de|do|da|dos|das)\s*$/u.exec(before);
  if (!phrase) return false;
  const last = phrase[2] ?? phrase[1];
  const headStart = (phrase.index ?? 0) + phrase[0].lastIndexOf(last);
  const prefixWords = before.slice(0, headStart).trim().split(/\s+/u).filter(Boolean);
  // Reuse the original grammar in hasUnboundSpoonQuantityContinuation.
  // A punctuation-delimited discourse clause is not a named food owner.
  const ownerToken = prefixWords.at(-2) ?? "";
  const discourseBoundary = prefixWords.at(-1) === "com" &&
    (ownerToken.endsWith(",") || ownerToken.endsWith(";"));
  if (!discourseBoundary && isBoundToOther(prefixWords.length)) return false;
  if (/^(?:extras?|adiciona(?:l|is))$/u.test(last)) {
    // "additional of sugar" is unbound; "extra topping of sugar" is not.
    return phrase[2] === undefined || isMeasureHead(phrase[1]) ||
      /^(?:e|ou|mas|mais|menos|tambem|ainda|so|apenas)$/u.test(phrase[1]);
  }
  return isMeasureHead(last);
}

/** Repeated genitive measures are quantities only if not bound to another food. */
function hasUncountedIngredientMeasure(
  surface: string, spoonSubject: string, isBoundToOther: (start: number) => boolean,
): boolean {
  if (!spoonSubject) return false;
  // spoonSubject comes from the captured spoon component, not untrusted text.
  return [...surface.matchAll(new RegExp(`\\b${spoonSubject}\\b`, "gu"))].some(match => {
    const before = surface.slice(0, match.index);
    const lastWord = before.trimEnd().split(/\s+/u).at(-1);
    return Boolean(lastWord && isGenitivePreposition(lastWord)) &&
      hasUncountedMeasureGenitive(before, isBoundToOther);
  });
}

/** A trailing quantity ellipsis must not silently turn a range/addition into one spoon. */
function hasUnboundSpoonQuantityContinuation(tail: string, spoonSubject: string): boolean {
  const words = tail.split(/\s+/u)
    .map(word => word.replace(/^[,;:!?()]+|[,;.!?()]+$/gu, ""))
    .filter(Boolean);
  const vagueWords = ["pouco", "pouquinho", "tanto", "tantinho", "bocado",
    "algo", "coisa", "coisas", "quantidade", "quantidades", "resto", "restinho"];
  // Keep portion units in the canonical shared grammar, not a food-name list.
  const householdMeasureTerm = new RegExp(
    `^(?:${UNIT_WORDS.colheresGeneric}|${UNIT_WORDS.porcoesPlain}|${UNIT_WORDS.doses}|${UNIT_WORDS.fatias}|${UNIT_WORDS.copos}|${UNIT_WORDS.xicarasPlain}|medidas?|pitadas?)$`,
    "u",
  );
  // Only measurement diminutives are quantities: "duas gotinhas" is
  // ambiguous, but "duas coxinhas" is an ordinary second food item.
  // Do not use a food-identity dictionary or infer any gram conversion.
  const measureDiminutive = /^(?:colherz?|got|pitad|tiqu|cad|bocad|punhad|cop|pingu|medid|pedac|porcaoz?|fatiaz?|xicaraz?|sachez?)inh[oa]s?$/u;
  const ellipticMeasureTerm = (word: string | undefined): boolean => Boolean(word && (
    vagueWords.includes(word) || householdMeasureTerm.test(word) ||
    measureDiminutive.test(word) || isMeasureHead(word)
  ));
  const isEllipticQuantityToken = (word: string | undefined): boolean => {
    if (!word) return false;
    const unsigned = word.replace(/^[+\-\u2212\u2013\u2014]/u, "");
    return parseCountableQuantity(unsigned) !== null ||
      isFractionalQuantityToken(unsigned) || UNCERTAIN_QUANTITY_WORDS.has(unsigned);
  };
  // Bind only grammatical prepositions; no food-identity or attribute dictionary.
  const readBoundSubjectAt = (index: number): string | null => {
    const remaining = words.slice(index).join(" ");
    // A diminutive spoon still needs a food ingredient after its denomination.
    if (/^colherzinh[oa]s?$/u.test(words[index - 1] ?? "")) {
      return readSpoonIngredientAfterUnit(remaining);
    }
    const matched = /^(?:(?:de|do|da|dos|das) |para (?:o|a|os|as) )(\S+)/u.exec(remaining);
    return matched?.[1] ?? null;
  };
  const isBoundSuffix = (start: number): boolean =>
    words[start - 1] === "a" && words[start - 2] !== spoonSubject &&
    ["de", "do", "da", "dos", "das"].includes(words[start - 3]);
  const isBoundBackwards = (start: number): boolean => {
    // Bind the *whole* elliptical amount, not an isolated "um" or "mais".
    // "leite com mais um pouco" and "leite com so um pouco mais" retain
    // the subject of "com", unlike "leite e mais um pouco" (unbound).
    const preceding = words.slice(Math.max(0, start - 6), start).join(" ");
    // Non-nominal discourse/temporal adjuncts never name an ingredient.
    // This is a closed grammatical class, not a food identity lexicon.
    // Multiword adjuncts ("por fim", "de novo", "em seguida") are rejected
    // by checking the last word immediately before "com".
    const bound = /(?:^|\s)(?!(?:(?:e|ou)(?:[\/&-](?:e|ou))*|mas|nem|porem|contudo|entretanto|porque|que|se|com|sem|de|do|da|dos|das|a|o|as|os|ao|aos|para|por|no|na|nos|nas|um|uma|uns|umas|mais|menos|so|apenas|ainda|tambem|depois|entao|talvez|agora|aqui|ali|la|dai|ai|logo|novamente|antes|ontem|hoje|amanha|cedo|tarde|ja|ainda|fim|novo|seguida|imediato|repente|assim|enfim|simplesmente|rapidamente|lentamente|isso|disso|disto|aquilo|nada|tudo|[a-z]+mente)\s+com\b)(\S+)\s+com(?:\s+(?:so|apenas|ainda|tambem))?(?:\s+(?:mais|menos))?(?:\s+(?:um|uma|algum|alguma))?(?:\s+(?:pouco|pouquinho|tanto|tantinho|bocado))?$/u.exec(preceding);
    return Boolean(bound && bound[1] !== spoonSubject);
  };


  // A measure without an explicit count is also a competing quantity.
  // The already-audited backwards binding grammar distinguishes another food.
  if (hasUncountedIngredientMeasure(tail, spoonSubject, isBoundBackwards)) return true;

  // Scan each clause, including punctuation or absent conjunctions, without
  // treating modifiers already bound to another ingredient as sugar.
  return words.some((word, start) => {
    let index = start;
    if (/^(?:e|ou)(?:[\/&-](?:e|ou))*$/u.test(word)) index += 1;
    while (["tambem", "ainda", "so", "apenas"].includes(words[index])) index += 1;
    const marker = words[index];
    if (!marker) return false;

    const alternative = /^outr[oa]s?$/u.test(marker);
    const increment = marker === "mais" || marker === "menos";
    const vagueAmount = isEllipticQuantityToken(marker) && ellipticMeasureTerm(words[index + 1]);
    if (!alternative && !increment && !vagueAmount) return false;
    if (increment && isBoundSuffix(index)) return false;
    if (increment || alternative) index += 1;
    if (isEllipticQuantityToken(words[index]) && ellipticMeasureTerm(words[index + 1])) index += 1;
    while (/^outr[oa]s?$/u.test(words[index])) index += 1;
    const hasElidedAmount = vagueAmount || ellipticMeasureTerm(words[index]);
    if (ellipticMeasureTerm(words[index])) index += 1;
    if (words[index] === "de" && ["cha", "sopa"].includes(words[index + 1])) index += 2;
    if (words[index] === "a" && ["mais", "menos"].includes(words[index + 1])) index += 2;
    if (hasElidedAmount && ["mais", "menos"].includes(words[index])) index += 1;
    // Qualifiers agree with the measure; plural forms must not hide its genitive subject.
    while (["ainda", "tambem", "so", "apenas", "extra", "extras", "adicional", "adicionais"].includes(words[index])) index += 1;

    const boundIngredient = readBoundSubjectAt(index);
    if (boundIngredient) return boundIngredient === spoonSubject;
    if (words[index] === spoonSubject) return !isBoundBackwards(start);
    // A following clause cannot retroactively unbind an amount already
    // attached through "<ingredient> com ..."; scan that clause separately.
    if (isBoundBackwards(start)) return false;
    if (!words[index]) return true;
    if (hasElidedAmount) return true;
    return ["mais", "menos", "ou"].includes(words[index]);
  });
}

/** A coordinated food with sugar is not another dose of the coffee's sugar.
 * Require a new noun phrase before "com"; a bare adjunct or household measure
 * cannot claim a separate food binding. This is syntax, not a food-name list. */
function isSeparateFoodAccompaniment(surface: string, sugarIndex: number): boolean {
  const preceding = surface.slice(0, sugarIndex).trimEnd();
  // Split grammatical boundaries without creating another food-name lexicon.
  // A trailing "com [modifier] acucar" is not enough to identify its owner.
  const withSugarParts = preceding.split(
    /\bcom(?:\s+(?:mais|menos|algum|alguma|alguns|algumas|muito|muita|pouco|pouca|um|uma|uns|umas))*\s*$/u,
  );
  if (withSugarParts.length < 2) return false;
  const segments = withSugarParts[0].trimEnd().split(/(?:[,;.!?]|\b(?:e|ou|mas)\b)\s*/gu);
  // An uncoordinated mention of sugar remains unresolved, not a separate food.
  if (segments.length < 2) return false;
  const phrase = segments.at(-1)?.trim() ?? "";
  const withoutModifiers = phrase.split(/^(?:(?:mais|so|apenas|outr[oa]s?)\s+)*/u);
  const words = (withoutModifiers.at(-1) ?? "").split(/\s+/u).filter(Boolean);
  if (words.length > 1 && (parseCountableQuantity(words[0]) !== null ||
      isFractionalQuantityToken(words[0]))) words.shift();
  let head = words[0];
  // "uma fatia de bolo" owns its topping; "uma colher com acucar" does not.
  if (head && isMeasureHead(head)) {
    if (!isGenitivePreposition(words[1] ?? "")) return false;
    head = words[2];
  }
  // Function words and circumstantial adverbs are not ingredient owners.
  // Only quantity syntax is inspected; no food is identified or catalogued.
  const functional = (head ?? "").split(
    /^(?:com|sem|de|do|da|dos|das|para|por|no|na|depois|entao|agora|ainda|tambem|logo|enfim|assim|fim|seguida|novo|novamente|mais|menos|acucar|que|isso|aquilo|tudo|nada)$/u,
  ).length > 1;
  const adverb = (head ?? "").split(/mente$/u).length > 1;
  return Boolean(head && !isMeasureHead(head) && !functional && !adverb);
}

/** Do not split an unresolved competing quantity away from its spoon component. */
function hasCompetingOrUnboundSugarMeasure(folded: string, spoon: RegExpMatchArray): boolean {
  const start = spoon.index ?? 0;
  const remaining = `${folded.slice(0, start)} ${folded.slice(start + spoon[0].length)}`;
  const spoonSubject = spoon[0].trim().split(" ").at(-1);
  // An unquantified second mention of the same ingredient is also ambiguous:
  // "1 spoon of sugar and more sugar" must not resolve as one spoon only.
  // The binding uses the ingredient from the matched spoon, never a food list.
  const escapedSubject = spoonSubject?.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // An indefinite second amount with no measure ("algum acucar") must
  // not disappear when no unit scanner can attach it to the ingredient.
  const unmeasuredAddition = escapedSubject && [...remaining.matchAll(new RegExp(
    `\\b(?:mais\\s+(?:de\\s+)?${escapedSubject}|${escapedSubject}\\s+(?:extras?|adiciona(?:l|is))|(?:algum(?:a|as|s)?|u(?:m|ma|ns|mas)|vari(?:os|as)|muit(?:os|as)|pouc(?:os|as))\\s+(?:de\\s+)?${escapedSubject})\\b`,
    "gu",
  ))].some(match => {
    const offset = match[0].lastIndexOf(spoonSubject ?? "");
    return !isSeparateFoodAccompaniment(remaining, (match.index ?? 0) + offset);
  });
  // The matched spoon already consumed its subject. A second bare subject
  // anywhere else, even after a temporal or discourse modifier, is unresolved.
  // A genitive exempts another food only when its head is not a measure.
  const bareSecondMention = escapedSubject
    ? [...remaining.matchAll(new RegExp(`\\b${escapedSubject}\\b`, "gu"))].some(match => {
        const previousWord = remaining.slice(0, match.index).trimEnd().match(/[a-z]+$/u)?.[0];
        return (!previousWord || !isGenitivePreposition(previousWord)) &&
          !isSeparateFoodAccompaniment(remaining, match.index ?? 0);
      })
    : false;
  // A second spoon belongs to a different ingredient only when its own
  // binding is explicit. Counting all spoon tokens globally rejects milk.
  const otherSpoons = [...remaining.matchAll(/\bcolher(?:es)?(?: de (?:cha|sopa))?\b/gu)];
  const unsafeOtherSpoon = otherSpoons.some(match => {
    // "brigadeiro de colher" is a food-name modifier, not a second spoon.
    // A real spoon unit starts a measure phrase; it is not the object of a
    // preceding genitive inside a different noun phrase.
    const before = remaining.slice(0, match.index ?? 0).trimEnd();
    if (/\b(?:de|do|da|dos|das)$/u.test(before)) return false;
    const after = remaining.slice((match.index ?? 0) + match[0].length).trimStart();
    // A denomination is not an ingredient: "colher de cafe" remains
    // unresolved, while "colher de cafe de leite" is explicitly bound.
    const ingredient = readSpoonIngredientAfterUnit(after);
    return !ingredient || ingredient === spoonSubject;
  });
  return Boolean(unmeasuredAddition) || Boolean(bareSecondMention) || unsafeOtherSpoon
    || hasUnboundSpoonQuantityContinuation(folded.slice(start + spoon[0].length), spoonSubject ?? "")
    // Before the matched spoon, do not silently disregard an uncounted component.
    || hasUncountedIngredientMeasure(folded.slice(0, start), spoonSubject ?? "", () => false)
    || scanMeasuredQuantityBindings(remaining).some(
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
  if (matches.length !== 1) return null;
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
