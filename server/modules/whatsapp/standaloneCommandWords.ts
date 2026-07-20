import { collapseWhitespace, stripDiacritics } from "./webhookUtils";

/**
 * Palavras que só fazem sentido como resposta a uma pendência ativa
 * (confirmação, seleção ou operação em andamento). Isoladas e sem
 * pendência compatível, nunca devem ser tratadas como nome de alimento
 * nem alcançar o pipeline nutricional (issue #855).
 */
const STANDALONE_COMMAND_WORDS = new Set([
  "registrar",
  "registre",
  "registra",
  "confirmar",
  "confirme",
  "confirma",
  "confirmo",
  "cancelar",
  "cancele",
  "cancela",
  "editar",
  "edite",
  "edita",
  "consultar",
  "consulte",
  "consulta",
  "sim",
  "nao",
  "ok",
  "certo",
]);

function normalizeStandaloneCandidate(text: string) {
  return collapseWhitespace(stripDiacritics(text.trim().toLowerCase()));
}

/**
 * Verdadeiro somente quando a mensagem inteira é uma dessas palavras
 * (sem alimento, quantidade ou qualquer outro conteúdo junto). Frases
 * completas como "registrar 100 g de arroz" não são afetadas.
 */
export function isStandaloneWhatsappCommandWord(text?: string | null): boolean {
  if (!text) return false;
  const normalized = normalizeStandaloneCandidate(text);
  if (!normalized) return false;
  return STANDALONE_COMMAND_WORDS.has(normalized) || /^\d+$/.test(normalized);
}
