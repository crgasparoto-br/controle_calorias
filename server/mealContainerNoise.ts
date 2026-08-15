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

// Preparacoes culinarias que podem ser validas mesmo sem entrada propria na TACO.
// Esta lista funciona somente como evidencia positiva. A ausencia de um termo aqui
// nunca transforma um complemento desconhecido em alimento: descricoes iniciadas
// por recipiente continuam conservadoramente sendo ruido sem outro sinal positivo.
const UNCATALOGUED_FOOD_SIGNALS = new Set([
  "bebida",
  "bibimbap",
  "bubble tea",
  "caldo",
  "ceviche",
  "curry",
  "doce",
  "ensopado",
  "falafel",
  "guacamole",
  "hummus",
  "kebab",
  "kombucha",
  "lasanha",
  "massa",
  "milkshake",
  "mingau",
  "moqueca",
  "mousse",
  "onigiri",
  "paella",
  "poke",
  "quiche",
  "ramen",
  "risoto",
  "salada",
  "sanduiche",
  "shake",
  "shawarma",
  "smoothie",
  "sobremesa",
  "sopa",
  "sorvete",
  "sushi",
  "taco",
  "temaki",
  "vitamina",
  "wrap",
  "yakisoba",
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

function hasUncataloguedFoodSignal(value: string) {
  const normalized = normalizeForMatching(value).trim().replace(/\s+/g, " ");
  if (!normalized) return false;

  return Array.from(UNCATALOGUED_FOOD_SIGNALS).some(signal =>
    (` ${normalized} `).includes(` ${signal} `),
  );
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

  // Objetos que nao representam recipientes/porcoes alimentares continuam sendo
  // ruido mesmo quando recebem modificadores arbitrarios (ex.: "mesa redonda").
  if (!FOOD_SERVING_CONTAINER_TERMS.has(head)) return true;

  // Um alimento conhecido e evidencia positiva mesmo quando o usuario omite
  // "de/com" (ex.: "copo acai", "marmita frango arroz").
  const trailingContent = tokens.slice(headIndex + 1)
    .filter(token => !NON_FOOD_CONNECTORS.has(token));
  if (trailingContent.length && hasKnownFoodSignal(trailingContent.join(" "))) {
    return false;
  }

  // Para recipientes que tambem podem descrever uma porcao, um modificador
  // arbitrario sem conector continua nao sendo evidencia de alimento.
  const connectorIndex = tokens.findIndex((token, index) =>
    index > headIndex && FOOD_CONTENT_CONNECTORS.has(token),
  );
  if (connectorIndex < 0) return true;

  const contentTokens = tokens.slice(connectorIndex + 1)
    .filter(token => !NON_FOOD_CONNECTORS.has(token));
  if (!contentTokens.length) return true;

  const content = contentTokens.join(" ");
  if (hasKnownFoodSignal(content) || hasUncataloguedFoodSignal(content)) {
    return false;
  }

  // Ausencia em uma lista negativa, quantidade de tokens ou profundidade nao e
  // evidencia de alimento. Para descricoes iniciadas por recipiente, complemento
  // desconhecido sem sinal alimentar positivo permanece conservadoramente ruido.
  return true;
}
