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

// Evidencia negativa forte para complementos que descrevem material, componente,
// produto de limpeza/cuidado pessoal, ferragem ou outro artefato. Esta lista nao
// e usada como allowlist positiva. A evidencia positiva estrutural e o proprio
// conector de conteudo ("de/com") em um recipiente que tambem representa porcao;
// termos desta taxonomia apenas vetam essa leitura quando o complemento traz um
// nucleo inequivocamente nao alimentar.
const NON_FOOD_CONTENT_HEAD_TERMS = new Set([
  "acessorio",
  "acrilico",
  "alca",
  "aluminio",
  "arame",
  "bateria",
  "borracha",
  "brinquedo",
  "cabo",
  "celular",
  "ceramica",
  "cimento",
  "cola",
  "componente",
  "cosmetico",
  "detergente",
  "dispositivo",
  "eletronico",
  "embalagem",
  "equipamento",
  "espuma",
  "ferramenta",
  "fio",
  "higiene",
  "isopor",
  "lixo",
  "madeira",
  "maquiagem",
  "material",
  "medicamento",
  "metal",
  "papel",
  "papelao",
  "parafuso",
  "peca",
  "plastico",
  "porcelana",
  "pressao",
  "produto",
  "resina",
  "sabao",
  "shampoo",
  "silicone",
  "tampa",
  "tecido",
  "telefone",
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

  // Sem um conector de conteudo, um modificador arbitrario de recipiente nao e
  // suficiente para afirmar que existe alimento (ex.: "copo azul"). Esse ramo
  // permanece aberto para qualquer modificador, sem enumerar adjetivos.
  const connectorIndex = tokens.findIndex((token, index) =>
    index > headIndex && FOOD_CONTENT_CONNECTORS.has(token),
  );
  if (connectorIndex < 0) return true;

  const contentTokens = tokens.slice(connectorIndex + 1)
    .filter(token => !NON_FOOD_CONNECTORS.has(token));
  if (!contentTokens.length) return true;

  const content = contentTokens.join(" ");
  if (hasKnownFoodSignal(content)) return false;

  // Depois de "recipiente + de/com", a frase expressa conteudo/porcao. Para nao
  // transformar uma classe positiva aberta em uma allowlist finita, preparacoes
  // desconhecidas continuam revisaveis. So descartamos quando existe evidencia
  // afirmativa de que o complemento e material/componente/artefato nao alimentar.
  return hasExplicitNonFoodContentHead(contentTokens);
}
