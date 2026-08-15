import { normalizeForMatching } from "./mealTextParsing";
import { findTacoFood } from "./tacoLookup";

const NON_FOOD_OBJECT_TERMS = new Set([
  "prato",
  "talher",
  "garfo",
  "faca",
  "colher",
  "guardanapo",
  "mesa",
  "bandeja",
  "embalagem",
  "rotulo",
  "copo",
  "tigela",
  "pote",
  "panela",
  "travessa",
  "marmita",
]);

const OBJECT_TERM_ALIASES = new Map<string, string>([
  ["pratos", "prato"],
  ["talheres", "talher"],
  ["garfos", "garfo"],
  ["facas", "faca"],
  ["colheres", "colher"],
  ["guardanapos", "guardanapo"],
  ["mesas", "mesa"],
  ["bandejas", "bandeja"],
  ["embalagens", "embalagem"],
  ["rotulos", "rotulo"],
  ["copos", "copo"],
  ["tigelas", "tigela"],
  ["potes", "pote"],
  ["panelas", "panela"],
  ["travessas", "travessa"],
  ["marmitas", "marmita"],
]);

const FOOD_SERVING_CONTAINER_TERMS = new Set([
  "copo",
  "tigela",
  "pote",
  "prato",
  "marmita",
  "bandeja",
  "travessa",
  "panela",
]);

const FOOD_CONTENT_CONNECTORS = new Set(["de", "da", "das", "do", "dos", "com"]);
const NON_FOOD_CONNECTORS = new Set(["a", "as", "o", "os", ...FOOD_CONTENT_CONNECTORS, "sem"]);
const EXPLICIT_NON_FOOD_PHRASES = new Set(["marmita vazia", "mesa posta", "decoracao"]);
const LEADING_DETERMINERS = new Set([
  "o",
  "a",
  "os",
  "as",
  "um",
  "uma",
  "uns",
  "umas",
  "meu",
  "minha",
  "meus",
  "minhas",
  "meio",
  "meia",
]);
const LEADING_NUMBER_WORDS = new Set([
  "um",
  "uma",
  "dois",
  "duas",
  "tres",
  "quatro",
  "cinco",
  "seis",
  "sete",
  "oito",
  "nove",
  "dez",
]);

// Alguns nomes também são alimentos em certos contextos (por exemplo, óleo,
// água, pasta, creme e gel). Para esses núcleos, evidência forte de domínio
// não alimentar deve prevalecer sobre um match alimentar genérico do catálogo.
const AMBIGUOUS_FOOD_CONTENT_HEADS = new Set([
  "agua",
  "creme",
  "fluido",
  "gel",
  "liquido",
  "oleo",
  "pasta",
  "po",
]);

// A detecção negativa é organizada por famílias semânticas/stems, e não por
// frases de auditoria. Isso permite reconhecer variações flexionadas e novos
// compostos da mesma família sem transformar ausência em uma lista finita em
// evidência positiva de alimento. O fallback para conteúdo desconhecido continua
// sendo revisável para preservar a classe positiva aberta.
const NON_FOOD_CONTENT_STEM_PATTERNS = [
  // Materiais, construção e componentes físicos.
  /^(?:acessor|acril|alca|alumin|arame|argamass|arruel|borrach|brita|cabo|ceramic|cimento|concret|espuma|ferrament|fio|gesso|isopor|madeir|material|metal|papel|papelao|parafus|peca|plast|porca|porcelan|pressao|resin|silicon|tampa|tecid|verniz|vidro)/,
  // Limpeza, higiene, cosméticos e substâncias técnicas.
  /^(?:anticongel|condicionador|cosmetic|desinfet|detergent|diesel|esmalte|fertiliz|gasolin|grax|herbicid|higien|inseticid|querosen|lubrific|maquiag|perfume|pesticid|sabao|shampoo|solvent|tinta|toxic|venen)/,
  // Eletrônicos, ferramentas, energia e artefatos.
  /^(?:bateri|brinqued|carregador|celular|dispositiv|eletronic|embalagem|equipament|pilha|telefone|toner)/,
  // Saúde, armas e outros itens incompatíveis com registro nutricional humano.
  /^(?:cartuch|medic|munic|polvor|remedi|vacina)/,
];

const AMBIGUOUS_HEAD_NON_FOOD_CONTEXT = new Map<string, RegExp[]>([
  ["agua", [/^(?:oxigenad|sanitari)/]],
  ["creme", [/^(?:capilar|cosmetic|dent|hidratant|pele)/]],
  ["fluido", [/^(?:arrefec|automotiv|freio|hidraul|motor|radiador|transmissao)/]],
  ["gel", [/^(?:alcool|cabelo|capilar|cosmetic|sanitiz|ultrassom)/]],
  ["liquido", [/^(?:arrefec|automotiv|freio|hidraul|limpeza|motor|radiador|transmissao)/]],
  ["oleo", [/^(?:freio|hidraul|lubrific|mecanic|mineral|motor|transmissao)/]],
  ["pasta", [/^(?:dent|poliment|solda)/]],
  ["po", [/^(?:extintor)/]],
]);

const CLEARLY_NON_FOOD_NOUN_STEM_PATTERNS = [
  /^(?:areia|diamant|joia|lixo|moeda|racao|rotulo)/,
];

function canonicalObjectTerm(token: string) {
  return OBJECT_TERM_ALIASES.get(token) ?? token;
}

function isLeadingStructuralToken(token: string) {
  return LEADING_DETERMINERS.has(token)
    || LEADING_NUMBER_WORDS.has(token)
    || NON_FOOD_CONNECTORS.has(token)
    || /^\d+(?:[,.]\d+)?$/.test(token);
}

function findObjectHead(tokens: string[]) {
  let headIndex = 0;
  while (headIndex < tokens.length && isLeadingStructuralToken(tokens[headIndex])) {
    headIndex += 1;
  }
  if (headIndex >= tokens.length) return null;

  const head = canonicalObjectTerm(tokens[headIndex]);
  if (!NON_FOOD_OBJECT_TERMS.has(head)) return null;
  return { head, headIndex };
}

function tokenMatchesAnyPattern(token: string, patterns: RegExp[]) {
  return patterns.some(pattern => pattern.test(token));
}

function hasStrongNonFoodEvidence(contentTokens: string[]) {
  return contentTokens.some(token =>
    tokenMatchesAnyPattern(token, NON_FOOD_CONTENT_STEM_PATTERNS)
    || tokenMatchesAnyPattern(token, CLEARLY_NON_FOOD_NOUN_STEM_PATTERNS),
  );
}

function hasAmbiguousHeadWithNonFoodContext(contentTokens: string[]) {
  const contentHead = contentTokens[0];
  if (!AMBIGUOUS_FOOD_CONTENT_HEADS.has(contentHead)) return false;

  const contextPatterns = AMBIGUOUS_HEAD_NON_FOOD_CONTEXT.get(contentHead) ?? [];
  return contentTokens.slice(1).some(token => tokenMatchesAnyPattern(token, contextPatterns));
}

function candidateContainsExactFoodSignal(value: string) {
  const normalized = normalizeForMatching(value).trim().replace(/\s+/g, " ");
  if (!normalized) return false;

  const candidate = findTacoFood(value);
  if (!candidate) return false;

  return [candidate.name, ...candidate.aliases].some(term => {
    const normalizedTerm = normalizeForMatching(term).trim().replace(/\s+/g, " ");
    return normalizedTerm.length >= 3
      && (` ${normalized} `).includes(` ${normalizedTerm} `);
  });
}

function hasKnownFoodSignal(value: string) {
  const normalized = normalizeForMatching(value).trim().replace(/\s+/g, " ");
  if (!normalized) return false;

  if (candidateContainsExactFoodSignal(normalized)) return true;

  const tokens = normalized.split(/\s+/).filter(token => token.length >= 3);
  for (let width = Math.min(tokens.length, 3); width >= 1; width -= 1) {
    for (let start = 0; start + width <= tokens.length; start += 1) {
      if (candidateContainsExactFoodSignal(tokens.slice(start, start + width).join(" "))) {
        return true;
      }
    }
  }

  return false;
}

function shouldNonFoodEvidenceOverrideFoodSignal(contentTokens: string[]) {
  const contentHead = contentTokens[0];
  return AMBIGUOUS_FOOD_CONTENT_HEADS.has(contentHead)
    && (hasStrongNonFoodEvidence(contentTokens.slice(1))
      || hasAmbiguousHeadWithNonFoodContext(contentTokens));
}

export function isContainerObjectOnlyDescription(value: string) {
  const normalized = normalizeForMatching(value).trim().replace(/\s+/g, " ");
  if (!normalized) return false;
  if (EXPLICIT_NON_FOOD_PHRASES.has(normalized)) return true;

  const tokens = normalized.split(/\s+/).filter(Boolean);
  const objectHead = findObjectHead(tokens);
  if (!objectHead) return false;

  const { head, headIndex } = objectHead;

  // Objetos que não representam recipientes/porções alimentares continuam sendo
  // ruído mesmo quando recebem modificadores arbitrários (ex.: "mesa redonda").
  if (!FOOD_SERVING_CONTAINER_TERMS.has(head)) return true;

  // Um alimento conhecido é evidência positiva mesmo quando o usuário omite
  // "de/com" (ex.: "copo açaí", "marmita frango arroz").
  const trailingContent = tokens.slice(headIndex + 1)
    .filter(token => !NON_FOOD_CONNECTORS.has(token));
  if (trailingContent.length && hasKnownFoodSignal(trailingContent.join(" "))
    && !shouldNonFoodEvidenceOverrideFoodSignal(trailingContent)) {
    return false;
  }

  // Sem conector de conteúdo, um modificador arbitrário do recipiente não é
  // evidência de alimento. Esse ramo permanece aberto para qualquer modificador.
  const connectorIndex = tokens.findIndex((token, index) =>
    index > headIndex && FOOD_CONTENT_CONNECTORS.has(token),
  );
  if (connectorIndex < 0) return true;

  const contentTokens = tokens.slice(connectorIndex + 1)
    .filter(token => !NON_FOOD_CONNECTORS.has(token));
  if (!contentTokens.length) return true;

  const content = contentTokens.join(" ");
  const knownFood = hasKnownFoodSignal(content);
  const strongNonFood = hasStrongNonFoodEvidence(contentTokens)
    || hasAmbiguousHeadWithNonFoodContext(contentTokens);

  if (knownFood && !shouldNonFoodEvidenceOverrideFoodSignal(contentTokens)) {
    return false;
  }
  if (strongNonFood) {
    return true;
  }

  // A forma "recipiente + de/com + conteúdo" é semanticamente ambígua no mundo
  // aberto. Sem evidência afirmativa de objeto/material, preservamos o conteúdo
  // como rascunho revisável para não transformar uma allowlist alimentar finita
  // em requisito. A segurança vem dos ramos negativos afirmativos acima, não da
  // ausência do termo em listas positivas ou negativas.
  return false;
}
