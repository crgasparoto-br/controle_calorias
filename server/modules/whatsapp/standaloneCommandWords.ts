import { collapseWhitespace, stripDiacritics } from "./webhookUtils";

/**
 * Respostas que somente fazem sentido com uma interação ativa. A comparação
 * usa a mensagem inteira para não bloquear comandos completos, como
 * "registrar 100 g de arroz" ou "170 g de iogurte".
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

const ISOLATED_INDEX_OR_NUMBER = /^(?:opcao\s*)?\d+(?:[,.]\d+)?$/;
const ISOLATED_QUANTITY = /^\d+(?:[,.]\d+)?\s*(?:g|gr|gramas?|kg|quilos?|mg|ml|mililitros?|l|litros?|unidades?|fatias?|xicaras?|copos?|colheres?|porcoes?)$/;

export function normalizeStandaloneWhatsappCommand(text?: string | null) {
  return text
    ? collapseWhitespace(stripDiacritics(text.trim().toLowerCase()))
    : "";
}

export function isStandaloneWhatsappCommandWord(text?: string | null): boolean {
  const normalized = normalizeStandaloneWhatsappCommand(text);
  return Boolean(normalized) && (
    STANDALONE_COMMAND_WORDS.has(normalized)
    || ISOLATED_INDEX_OR_NUMBER.test(normalized)
    || ISOLATED_QUANTITY.test(normalized)
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
