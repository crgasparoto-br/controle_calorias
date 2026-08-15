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

// Estes termos representam nucleos semanticos de material, componente ou
// artefato, e nao frases completas. Uma vez reconhecido o nucleo, qualquer
// quantidade de modificadores continua descrevendo o objeto (por exemplo,
// "tinta acrilica fosca" ou "plastico transparente reciclavel"). Isso evita
// que a fronteira volte a depender do numero de tokens sem transformar o
// catalogo de alimentos em uma allowlist obrigatoria.
const NON_FOOD_CONTENT_HEAD_TERMS = new Set([
  "acrilico",
  "alca",
  "aluminio",
  "arame",
  "borracha",
  "brinquedo",
  "cabo",
  "ceramica",
  "cimento",
  "cola",
  "componente",
  "espuma",
  "ferramenta",
  "fio",
  "isopor",
  "madeira",
  "metal",
  "papel",
  "papelao",
  "parafuso",
  "peca",
  "plastico",
  "porcelana",
  "resina",
  "silicone",
  "tampa",
  "tecido",
  "tinta",
  "verniz",
  "vidro",
]);

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

function hasExplicitNonFoodContentHead(contentTokens: string[]) {
  return contentTokens.some(token => NON_FOOD_CONTENT_HEAD_TERMS.has(token));
}

export function isContainerObjectOnlyDescription(value: string) {
  const normalized = normalizeForMatching(value).trim().replace(/\s+/g, " ");
  if (!normalized) return false;
  if (EXPLICIT_NON_FOOD_PHRASES.has(normalized)) return true;

  const tokens = normalized.split(/\s+/).filter(Boolean);
  const headIndex = tokens.findIndex(token => !NON_FOOD_CONNECTORS.has(token));
  if (headIndex < 0) return false;

  const head = tokens[headIndex];
  if (!NON_FOOD_OBJECT_TERMS.has(head)) return false;

  // Objetos que não representam recipientes/porções alimentares continuam sendo
  // ruído mesmo quando recebem modificadores arbitrários (ex.: "mesa redonda").
  if (!FOOD_SERVING_CONTAINER_TERMS.has(head)) return true;

  // Um alimento conhecido é evidência positiva mesmo quando o usuário omite
  // "de/com" (ex.: "copo açaí", "marmita frango arroz"). A decisão não deve
  // depender de uma lista fechada de formas sintáticas.
  const trailingContent = tokens.slice(headIndex + 1)
    .filter(token => !NON_FOOD_CONNECTORS.has(token));
  if (trailingContent.length && hasKnownFoodSignal(trailingContent.join(" "))) {
    return false;
  }

  // Para recipientes que também podem descrever uma porção, um modificador
  // arbitrário sem conector continua não sendo evidência de alimento.
  const connectorIndex = tokens.findIndex((token, index) =>
    index > headIndex && FOOD_CONTENT_CONNECTORS.has(token),
  );
  if (connectorIndex < 0) return true;

  const contentTokens = tokens.slice(connectorIndex + 1)
    .filter(token => !NON_FOOD_CONNECTORS.has(token));
  if (!contentTokens.length) return true;

  const content = contentTokens.join(" ");
  if (hasKnownFoodSignal(content)) return false;

  // O complemento unitario desconhecido continua conservadoramente sendo
  // tratado como objeto/material. Para complementos maiores, um nucleo
  // inequivocamente nao alimentar torna toda a descricao nao alimentar,
  // independentemente da quantidade de adjetivos/modificadores posteriores.
  if (contentTokens.length === 1 || hasExplicitNonFoodContentHead(contentTokens)) {
    return true;
  }

  // Sem sinal positivo conhecido nem sinal negativo inequívoco, preserva uma
  // preparação revisável fora do catálogo. Esse fallback é deliberadamente
  // independente da TACO para não reintroduzir uma allowlist finita de comidas.
  return false;
}
