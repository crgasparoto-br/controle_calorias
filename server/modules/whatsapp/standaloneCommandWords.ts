import { collapseWhitespace, stripDiacritics } from "./webhookUtils";

/**
 * Palavras que somente fazem sentido como resposta a uma interação ativa.
 * A comparação usa a mensagem inteira para não bloquear comandos completos,
 * como "registrar 100 g de arroz".
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

export function normalizeStandaloneWhatsappCommand(text?: string | null) {
  return text
    ? collapseWhitespace(stripDiacritics(text.trim().toLowerCase()))
    : "";
}

export function isStandaloneWhatsappCommandWord(text?: string | null): boolean {
  const normalized = normalizeStandaloneWhatsappCommand(text);
  return Boolean(normalized) && (
    STANDALONE_COMMAND_WORDS.has(normalized)
    || /^(?:opcao\s*)?\d+(?:[,.]\d+)?$/.test(normalized)
  );
}

export function isStandaloneWhatsappConfirmationWord(text?: string | null): boolean {
  const normalized = normalizeStandaloneWhatsappCommand(text);
  return ["sim", "ok", "certo", "confirmar", "confirme", "confirma", "confirmo", "registrar", "registre", "registra"].includes(normalized);
}

export function isStandaloneWhatsappCancellationWord(text?: string | null): boolean {
  const normalized = normalizeStandaloneWhatsappCommand(text);
  return ["nao", "cancelar", "cancele", "cancela"].includes(normalized);
}
