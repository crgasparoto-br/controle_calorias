/**
 * Reapresentação transversal de interações fechadas (issue #858, épica #857).
 *
 * Quando existe pendência válida e a resposta textual é inválida (índice fora
 * da faixa, palavra de comando isolada, confirmação incompatível), o gate
 * central reapresenta as mesmas ações semânticas, na mesma ordem, com callbacks
 * válidos — sem consumir a pendência, sem executar mutação e sem encaminhar a
 * mensagem ao parser, LLM ou fallback nutricional.
 *
 * A reconstrução deriva exclusivamente do target persistido em
 * `whatsappPendingOperations` (estratégia `pending_target` do inventário);
 * nenhum domínio é reexecutado.
 */
import { DEFAULT_APP_TIME_ZONE } from "../../../shared/timeZone";
import type { WhatsAppPendingOperationRecord } from "../../repositories/whatsappPendingOperationRepository";
import {
  buildPendingResult,
  buildSelectionListReply,
  isPendingDeleteSelection,
  PENDING_DELETE_TYPE,
  type PendingDeleteOperation,
  type PendingDeleteSelection,
} from "./deleteIntentContract";
import { buildWhatsappClosedDecisionReply } from "./interactionInventory";
import {
  buildWhatsappIntentClarificationReply,
  parseIntentClarificationTextAction,
  PENDING_INTENT_CLARIFICATION_TYPE,
  type PendingIntentClarification,
} from "./intentClarificationInteraction";
import { PENDING_MEAL_ITEM_SELECTION_TYPE } from "./mealItemSelectionCallback";

/**
 * Tipo espelhado de `PENDING_PROFESSIONAL_ACCESS_TYPE` (definido em
 * `professionals/service.ts` e `messageRouter.ts`) para evitar import estático
 * de `professionals/service.ts` aqui — esse módulo importa deste (via
 * `interactiveCallback`/`replyContract`), então um import estático criaria
 * ciclo. A reconstrução em si usa `import()` dinâmico (issue #858).
 */
const PENDING_PROFESSIONAL_ACCESS_TYPE = "professional_access";
import {
  buildWhatsappPeriodReportClarificationListReply,
  PENDING_PERIOD_REPORT_TYPE,
} from "./periodReportClarification";
import { isStandaloneWhatsappCommandWord } from "./standaloneCommandWords";
import type { WhatsAppLogicalReply } from "./replyContract";
import { PENDING_CONFIRMATION_TYPE, type PendingWhatsAppConfirmation } from "./webhookTextCommands";
import { normalizeWhatsAppShortCommandText } from "./webhookUtils";

export type WhatsappPendingTextResponseClassification =
  /** O texto resolve a pendência; a cadeia existente continua responsável. */
  | "resolves"
  /** Resposta inválida a uma pendência válida: reapresentar sem consumir. */
  | "invalid_response"
  /** Mensagem sem relação (comando completo novo); segue o fluxo normal sem consumir a pendência. */
  | "unrelated";

function normalize(text: string) {
  return normalizeWhatsAppShortCommandText(text);
}

const CONFIRM_WORDS = new Set(["sim", "confirmar", "confirma", "confirmo", "pode confirmar", "ok", "pode seguir"]);
const CANCEL_WORDS = new Set(["nao", "cancelar", "cancela", "cancele", "parar", "desfazer", "nenhuma", "nenhum", "0"]);
const SCOPE_MATCHING_WORDS = new Set(["apenas", "somente", "so", "so compativeis", "apenas compativeis", "somente compativeis", "1"]);
const SCOPE_ALL_WORDS = new Set(["todos", "todas", "todos recentes", "todos os registros", "2"]);

function parseBareIndex(normalized: string) {
  const ordinalWords: Record<string, number> = { primeiro: 0, primeira: 0, segundo: 1, segunda: 1, terceiro: 2, terceira: 2, quarto: 3, quarta: 3, quinto: 4, quinta: 4 };
  for (const [word, index] of Object.entries(ordinalWords)) {
    if (normalized === word || normalized === `o ${word}` || normalized === `a ${word}`) return index;
  }
  const numeric = normalized.match(/^(?:opcao\s*)?(\d{1,2})$/);
  return numeric ? Number(numeric[1]) - 1 : null;
}

export function isReclassifyScopeConfirmation(target: unknown): target is PendingWhatsAppConfirmation & { decision: "reclassify_scope" } {
  return Boolean(target && typeof target === "object" && (target as { decision?: string }).decision === "reclassify_scope");
}

function classifyCandidateSelection(normalized: string, candidateCount: number): WhatsappPendingTextResponseClassification {
  if (CANCEL_WORDS.has(normalized)) return "resolves";
  const index = parseBareIndex(normalized);
  if (index !== null) return index >= 0 && index < candidateCount ? "resolves" : "invalid_response";
  if (isStandaloneWhatsappCommandWord(normalized)) return "invalid_response";
  return "unrelated";
}

function classifyConfirmCancel(normalized: string): WhatsappPendingTextResponseClassification {
  if (CONFIRM_WORDS.has(normalized) || CANCEL_WORDS.has(normalized)) return "resolves";
  if (isStandaloneWhatsappCommandWord(normalized)) return "invalid_response";
  return "unrelated";
}

/**
 * Classifica a resposta textual do usuário frente à pendência ativa. Comandos
 * completos novos e incompatíveis são `unrelated` e nunca consomem a pendência.
 */
export function classifyWhatsappPendingTextResponse(
  pending: Pick<WhatsAppPendingOperationRecord, "type" | "target">,
  text?: string | null,
): WhatsappPendingTextResponseClassification {
  if (!text) return "unrelated";
  const normalized = normalize(text);
  if (!normalized) return "unrelated";

  switch (pending.type) {
    case PENDING_DELETE_TYPE: {
      const target = pending.target as PendingDeleteOperation;
      if (isPendingDeleteSelection(target)) {
        return classifyCandidateSelection(normalized, target.candidates.length);
      }
      return classifyConfirmCancel(normalized);
    }
    case PENDING_MEAL_ITEM_SELECTION_TYPE: {
      const target = pending.target as { candidates?: unknown[] };
      return classifyCandidateSelection(normalized, target.candidates?.length ?? 0);
    }
    case PENDING_CONFIRMATION_TYPE: {
      if (isReclassifyScopeConfirmation(pending.target)) {
        if (SCOPE_MATCHING_WORDS.has(normalized) || SCOPE_ALL_WORDS.has(normalized) || CANCEL_WORDS.has(normalized)) return "resolves";
        // "sim" é ambíguo entre os dois escopos: reapresentar em vez de escolher por ele.
        if (isStandaloneWhatsappCommandWord(normalized)) return "invalid_response";
        return "unrelated";
      }
      return classifyConfirmCancel(normalized);
    }
    case PENDING_PERIOD_REPORT_TYPE: {
      if (/(hoje|ontem|semana|mes)/.test(normalized)) return "resolves";
      if (CANCEL_WORDS.has(normalized)) return "resolves";
      if (isStandaloneWhatsappCommandWord(normalized)) return "invalid_response";
      return "unrelated";
    }
    case PENDING_INTENT_CLARIFICATION_TYPE: {
      if (parseIntentClarificationTextAction(normalized)) return "resolves";
      if (isStandaloneWhatsappCommandWord(normalized)) return "invalid_response";
      return "unrelated";
    }
    case PENDING_PROFESSIONAL_ACCESS_TYPE: {
      // Resolução textual própria (AUTORIZAR/NEGAR + código) é tratada pelo
      // fluxo de mensagens de texto dos profissionais, fora do gate central;
      // aqui só classificamos o caso de palavra de comando isolada incompatível,
      // para reapresentar em vez de deixar alcançar o pipeline nutricional.
      if (isStandaloneWhatsappCommandWord(normalized)) return "invalid_response";
      return "unrelated";
    }
    default:
      return "unrelated";
  }
}

export type WhatsappPendingInteractionReplay = {
  reply: string;
  interactiveReply?: WhatsAppLogicalReply;
};

function buildDeleteSelectionReplayBody(target: PendingDeleteSelection) {
  const options = target.candidates
    .map((candidate, index) => `${index + 1}. ${candidate.itemName ?? "Alimento"} em ${candidate.mealLabel}`)
    .join("\n");
  return `Ainda preciso da sua escolha sobre "${target.targetFoodName}". Qual deseja remover?\n${options}\n\nResponda com o número ou toque em uma opção. Envie CANCELAR para desistir.`;
}

function buildMealItemSelectionReplayBody(target: { targetFood?: string | null; candidates: Array<{ itemName: string; mealLabel: string }> }) {
  const options = target.candidates
    .map((candidate, index) => `${index + 1}. ${candidate.itemName} em ${candidate.mealLabel}`)
    .join("\n");
  return `Ainda preciso da sua escolha sobre "${target.targetFood ?? "esse alimento"}". Qual item devo usar?\n${options}\n\nResponda com o número ou ordinal, ou toque em uma opção. Envie CANCELAR para desistir.`;
}

/**
 * Reconstrói a mesma interação (mesmas ações semânticas, mesma ordem, mesmos
 * rótulos) a partir do target persistido, com callbacks válidos apontando para
 * a MESMA pendência. Retorna `null` para tipos sem reconstrução por target.
 *
 * Assíncrona porque `professional_access` usa a estratégia `domain_reload`
 * (issue #858): a pendência só guarda `{ accessId }`, então a reapresentação
 * recarrega o estado atual da solicitação em vez de confiar em texto salvo.
 */
export async function rebuildWhatsappPendingInteractionReply(
  pending: Pick<WhatsAppPendingOperationRecord, "id" | "type" | "target" | "userId">,
  options?: { timeZone?: string | null },
): Promise<WhatsappPendingInteractionReplay | null> {
  const timeZone = options?.timeZone ?? DEFAULT_APP_TIME_ZONE;

  switch (pending.type) {
    case PENDING_DELETE_TYPE: {
      const target = pending.target as PendingDeleteOperation;
      if (isPendingDeleteSelection(target)) {
        const reply = buildDeleteSelectionReplayBody(target);
        return { reply, interactiveReply: buildSelectionListReply(reply, pending.id, target.candidates) };
      }
      const rebuilt = buildPendingResult(target, pending.id, timeZone);
      return { reply: rebuilt.reply, interactiveReply: rebuilt.interactiveReply };
    }
    case PENDING_MEAL_ITEM_SELECTION_TYPE: {
      const target = pending.target as { targetFood?: string | null; candidates: Array<{ itemName: string; mealLabel: string }> };
      if (!Array.isArray(target.candidates) || target.candidates.length === 0) return null;
      const reply = buildMealItemSelectionReplayBody(target);
      return {
        reply,
        interactiveReply: buildWhatsappClosedDecisionReply({
          bodyText: reply,
          pendingOperationId: pending.id,
          actions: [
            ...target.candidates.map((candidate, index) => ({
              action: `select:${index}`,
              label: `${index + 1}. ${candidate.itemName}`,
              description: candidate.mealLabel,
            })),
            { action: "cancel", label: "Cancelar" },
          ],
        }),
      };
    }
    case PENDING_CONFIRMATION_TYPE: {
      const target = pending.target as PendingWhatsAppConfirmation;
      if (!target?.summary) return null;
      if (isReclassifyScopeConfirmation(target)) {
        const reply = [
          `Ainda preciso da sua decisão sobre ${target.summary}.`,
          "Você quer mover só os registros compatíveis ou todos os registros recentes?",
          "Responda APENAS, TODOS ou CANCELAR.",
        ].join("\n\n");
        return {
          reply,
          interactiveReply: buildWhatsappClosedDecisionReply({
            bodyText: reply,
            pendingOperationId: pending.id,
            actions: [
              { action: "confirm", label: "Só compatíveis" },
              { action: "confirm_all", label: "Todos recentes" },
              { action: "cancel", label: "Cancelar" },
            ],
          }),
        };
      }
      const reply = [
        `Ainda preciso da sua confirmação para ${target.summary}.`,
        "Responda SIM para confirmar ou CANCELAR para desistir.",
      ].join("\n\n");
      return {
        reply,
        interactiveReply: buildWhatsappClosedDecisionReply({
          bodyText: reply,
          pendingOperationId: pending.id,
          actions: [
            { action: "confirm", label: "Confirmar" },
            { action: "cancel", label: "Cancelar" },
          ],
        }),
      };
    }
    case PENDING_PERIOD_REPORT_TYPE: {
      const reply = "Ainda preciso saber o período do resumo. Escolha uma opção ou responda hoje, ontem, semana ou mês.";
      return { reply, interactiveReply: buildWhatsappPeriodReportClarificationListReply(pending.id, reply) };
    }
    case PENDING_INTENT_CLARIFICATION_TYPE: {
      const target = pending.target as PendingIntentClarification;
      const reply = [
        "Essa resposta não corresponde às opções.",
        "Você quer registrar um alimento, corrigir uma refeição ou consultar seus registros?",
        ...(target?.originalText ? [`Sua mensagem original ("${target.originalText}") continua guardada.`] : []),
      ].join("\n\n");
      return { reply, interactiveReply: buildWhatsappIntentClarificationReply(pending.id, reply) };
    }
    case PENDING_PROFESSIONAL_ACCESS_TYPE: {
      const target = pending.target as { accessId?: string };
      if (typeof target?.accessId !== "string") return null;
      // Import dinâmico (issue #858): `professionals/service.ts` importa deste
      // módulo (via `interactiveCallback`/`replyContract`), então um import
      // estático aqui criaria ciclo — mesmo padrão já usado em `messageRouter.ts`.
      const { rebuildWhatsappProfessionalAccessAuthorizationReply } = await import("../professionals/service");
      const interactiveReply = await rebuildWhatsappProfessionalAccessAuthorizationReply(
        pending.userId,
        pending.id,
        target.accessId,
      );
      if (!interactiveReply) return null;
      const primaryText = interactiveReply.messages[0]?.type === "buttons" ? interactiveReply.messages[0].bodyText : "";
      return { reply: primaryText, interactiveReply };
    }
    default:
      return null;
  }
}
