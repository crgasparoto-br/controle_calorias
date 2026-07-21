/**
 * Inventário transversal e versionado de interações do WhatsApp (issue #858, épica #857).
 *
 * Fonte única das decisões abertas/fechadas alcançáveis em produção. Cada entrada
 * descreve o contrato estruturado produzido pelo handler de domínio (issues #855/#856
 * e anteriores) sem duplicar texto literal, regex de mensagem ou regra de domínio.
 *
 * Regras centrais (épica #857):
 * - decisão fechada com até 3 ações no total (incluindo Cancelar) usa botões;
 * - decisão fechada com 4 ou mais ações usa lista;
 * - pergunta aberta (quantidade, marca, tamanho, nome livre) permanece textual;
 * - resposta inválida reapresenta a mesma interação sem consumir a pendência;
 * - callback interativo nunca alcança parser, LLM ou fallback nutricional.
 *
 * A #860 consome este inventário para a matriz end-to-end. Mudanças em handlers,
 * tipos de pendência ou interações fechadas exigem atualização explícita aqui —
 * `interactionInventory.test.ts` falha quando um tipo registrado no gate central
 * (`messageRouter.ts`) não possui entrada correspondente.
 */
import { buildWhatsAppCallbackId } from "./interactiveCallback";
import { buttonsReply, listReply, type WhatsAppLogicalReply } from "./replyContract";

export const WHATSAPP_INTERACTION_INVENTORY_VERSION = 1;

/** Máximo de botões suportado pelo provedor; acima disso a decisão fechada usa lista. */
export const WHATSAPP_MAX_BUTTON_ACTIONS = 3;

export type WhatsappInteractionClassification = "open" | "closed";
export type WhatsappInteractionComponent = "text" | "buttons" | "list" | "buttons_or_list";

export type WhatsappCanonicalAction = {
  /** Ação canônica persistida no callback (ex.: `confirm`, `cancel`, `select:N`). */
  id: string;
  /** Rótulo funcional apresentado ao usuário; nunca expõe IDs internos. */
  label: string;
  /** Efeito permitido ao resolver a ação. */
  effect: string;
};

export type WhatsappInteractionInventoryEntry = {
  /** Identificador estável da interação, consumido pela matriz da #860. */
  id: string;
  /** Módulo/handler de origem que produz a interação. */
  origin: string;
  /** Entrypoints alcançáveis em produção. */
  entrypoints: string[];
  classification: WhatsappInteractionClassification;
  /** Tipo persistido em `whatsappPendingOperations`; `null` para perguntas abertas sem pendência própria. */
  pendingType: string | null;
  /**
   * Ações canônicas em ordem determinística, incluindo cancelamento quando há
   * pendência ou possibilidade de mutação. Ações dinâmicas (`select:N`) são
   * descritas pelo padrão, com contagem resolvida em runtime.
   */
  actions: WhatsappCanonicalAction[];
  /** Verdadeiro quando parte das ações é dinâmica (candidatos), afetando a escolha do componente em runtime. */
  hasDynamicCandidates: boolean;
  /** Componente esperado segundo a regra central. */
  expectedComponent: WhatsappInteractionComponent;
  /** Regra textual equivalente usada como fallback e como instrução na própria mensagem. */
  textFallbackRule: string;
  /** Estratégia para reconstruir/reapresentar a interação a partir da pendência persistida. */
  reconstruction: "pending_target" | "domain_reload" | "not_applicable";
  /** Comportamento para resposta inválida com pendência ainda válida. */
  invalidResponse: "represent_same_actions" | "text_guidance" | "not_applicable";
  /** Comportamento para pendência expirada/consumida/obsoleta. */
  staleBehavior: "reply_unavailable_request_new_command";
  allowedEffects: string[];
  forbiddenEffects: string[];
};

const NUTRITION_FORBIDDEN = ["nutrition_fallback", "meal_creation", "llm_reinterpretation"];

export const WHATSAPP_INTERACTION_INVENTORY: WhatsappInteractionInventoryEntry[] = [
  {
    id: "delete.confirmation",
    origin: "deleteIntent",
    entrypoints: ["whatsappWebhook", "whatsappIntentWebhook", "simulator", "audioTranscription"],
    classification: "closed",
    pendingType: "delete",
    actions: [
      { id: "confirm", label: "Confirmar", effect: "apply_delete" },
      { id: "cancel", label: "Cancelar", effect: "cancel_delete" },
    ],
    hasDynamicCandidates: false,
    expectedComponent: "buttons",
    textFallbackRule: "SIM confirma; CANCELAR desiste.",
    reconstruction: "pending_target",
    invalidResponse: "represent_same_actions",
    staleBehavior: "reply_unavailable_request_new_command",
    allowedEffects: ["confirm", "cancel", "delete_once"],
    forbiddenEffects: [...NUTRITION_FORBIDDEN, "delete_without_confirmation"],
  },
  {
    id: "delete.candidate_selection",
    origin: "deleteIntent",
    entrypoints: ["whatsappWebhook", "whatsappIntentWebhook", "simulator", "audioTranscription"],
    classification: "closed",
    pendingType: "delete",
    actions: [
      { id: "select:N", label: "Opção N", effect: "select_candidate" },
      { id: "cancel", label: "Cancelar", effect: "cancel_delete" },
    ],
    hasDynamicCandidates: true,
    expectedComponent: "buttons_or_list",
    textFallbackRule: "Número escolhe o candidato; CANCELAR desiste.",
    reconstruction: "pending_target",
    invalidResponse: "represent_same_actions",
    staleBehavior: "reply_unavailable_request_new_command",
    allowedEffects: ["select", "cancel"],
    forbiddenEffects: [...NUTRITION_FORBIDDEN, "delete_before_confirmation"],
  },
  {
    id: "meal_item.candidate_selection",
    origin: "mealItemSelectionCallback",
    entrypoints: ["whatsappWebhook", "whatsappIntentWebhook", "simulator", "audioTranscription"],
    classification: "closed",
    pendingType: "meal_item_selection",
    actions: [
      { id: "select:N", label: "Opção N", effect: "select_candidate" },
      { id: "cancel", label: "Cancelar", effect: "cancel_selection" },
    ],
    hasDynamicCandidates: true,
    expectedComponent: "buttons_or_list",
    textFallbackRule: "Número ou ordinal escolhe o item; CANCELAR desiste.",
    reconstruction: "pending_target",
    invalidResponse: "represent_same_actions",
    staleBehavior: "reply_unavailable_request_new_command",
    allowedEffects: ["select", "cancel", "mutate_after_selection"],
    forbiddenEffects: [...NUTRITION_FORBIDDEN, "mutate_before_selection"],
  },
  {
    id: "generic_confirmation.confirm_cancel",
    origin: "webhookTextCommands",
    entrypoints: ["whatsappWebhook", "whatsappIntentWebhook", "simulator", "audioTranscription"],
    classification: "closed",
    pendingType: "confirmation",
    actions: [
      { id: "confirm", label: "Confirmar", effect: "apply_action" },
      { id: "cancel", label: "Cancelar", effect: "cancel_action" },
    ],
    hasDynamicCandidates: false,
    expectedComponent: "buttons",
    textFallbackRule: "SIM confirma; CANCELAR desiste.",
    reconstruction: "pending_target",
    invalidResponse: "represent_same_actions",
    staleBehavior: "reply_unavailable_request_new_command",
    allowedEffects: ["confirm", "cancel", "reclassify_meals"],
    forbiddenEffects: NUTRITION_FORBIDDEN,
  },
  {
    id: "generic_confirmation.reclassify_scope",
    origin: "webhookTextCommands",
    entrypoints: ["whatsappWebhook", "whatsappIntentWebhook", "simulator", "audioTranscription"],
    classification: "closed",
    pendingType: "confirmation",
    actions: [
      { id: "confirm", label: "Só compatíveis", effect: "reclassify_matching" },
      { id: "confirm_all", label: "Todos recentes", effect: "reclassify_all" },
      { id: "cancel", label: "Cancelar", effect: "cancel_action" },
    ],
    hasDynamicCandidates: false,
    expectedComponent: "buttons",
    textFallbackRule: "APENAS move só compatíveis; TODOS move todos; CANCELAR desiste.",
    reconstruction: "pending_target",
    invalidResponse: "represent_same_actions",
    staleBehavior: "reply_unavailable_request_new_command",
    allowedEffects: ["confirm", "confirm_all", "cancel", "reclassify_meals"],
    forbiddenEffects: NUTRITION_FORBIDDEN,
  },
  {
    id: "period_report.period_selection",
    origin: "periodReportClarification",
    entrypoints: ["whatsappIntentWebhook", "simulator", "audioTranscription"],
    classification: "closed",
    pendingType: "period_report_clarification",
    actions: [
      { id: "period:hoje", label: "Hoje", effect: "run_report" },
      { id: "period:ontem", label: "Ontem", effect: "run_report" },
      { id: "period:semana", label: "Esta semana", effect: "run_report" },
      { id: "period:mes", label: "Este mês", effect: "run_report" },
      { id: "cancel", label: "Cancelar", effect: "cancel_report" },
    ],
    hasDynamicCandidates: false,
    expectedComponent: "list",
    textFallbackRule: "Períodos por texto (hoje, ontem, semana, mês) resolvem a mesma pendência.",
    reconstruction: "pending_target",
    invalidResponse: "represent_same_actions",
    staleBehavior: "reply_unavailable_request_new_command",
    allowedEffects: ["run_report", "cancel"],
    forbiddenEffects: NUTRITION_FORBIDDEN,
  },
  {
    id: "professional_access.authorization",
    origin: "professionals/service",
    entrypoints: ["standaloneOutbound", "whatsappWebhook"],
    classification: "closed",
    pendingType: "professional_access",
    actions: [
      { id: "authorize", label: "Autorizar", effect: "grant_access" },
      { id: "reject", label: "Recusar", effect: "reject_access" },
    ],
    hasDynamicCandidates: false,
    expectedComponent: "buttons",
    textFallbackRule: "AUTORIZAR concede; RECUSAR nega.",
    reconstruction: "domain_reload",
    invalidResponse: "text_guidance",
    staleBehavior: "reply_unavailable_request_new_command",
    allowedEffects: ["grant_access", "reject_access"],
    forbiddenEffects: NUTRITION_FORBIDDEN,
  },
  {
    id: "intent_clarification.generic",
    origin: "intentClarificationInteraction",
    entrypoints: ["whatsappIntentWebhook", "simulator", "audioTranscription"],
    classification: "closed",
    pendingType: "intent_clarification",
    actions: [
      { id: "register_food", label: "Registrar alimento", effect: "resume_original_flow" },
      { id: "correct_meal", label: "Corrigir refeição", effect: "ask_specific_correction" },
      { id: "consult_records", label: "Consultar registros", effect: "run_report" },
      { id: "cancel", label: "Cancelar", effect: "cancel_clarification" },
    ],
    hasDynamicCandidates: false,
    expectedComponent: "list",
    textFallbackRule: "Número escolhe a opção; CANCELAR desiste; mensagem completa nova segue o fluxo normal.",
    reconstruction: "pending_target",
    invalidResponse: "represent_same_actions",
    staleBehavior: "reply_unavailable_request_new_command",
    allowedEffects: ["resume_original_flow", "run_report", "cancel"],
    forbiddenEffects: [...NUTRITION_FORBIDDEN, "persist_command_word_as_food"],
  },
  {
    id: "food_clarification.open_question",
    origin: "llmIntentActions",
    entrypoints: ["whatsappIntentWebhook", "simulator", "audioTranscription"],
    classification: "open",
    pendingType: null,
    actions: [],
    hasDynamicCandidates: false,
    expectedComponent: "text",
    textFallbackRule: "Quantidade, peso, marca, tamanho e nome livre são perguntas abertas; o contexto reconhecido é preservado (issue #855).",
    reconstruction: "not_applicable",
    invalidResponse: "text_guidance",
    staleBehavior: "reply_unavailable_request_new_command",
    allowedEffects: ["collect_missing_datum"],
    forbiddenEffects: ["persist_command_word_as_food"],
  },
];

/** Tipos de pendência fechados registrados no inventário (fonte para o gate central). */
export function listWhatsappInventoryPendingTypes(): string[] {
  return [...new Set(
    WHATSAPP_INTERACTION_INVENTORY
      .map(entry => entry.pendingType)
      .filter((type): type is string => typeof type === "string"),
  )];
}

export function getWhatsappInteractionInventoryEntry(id: string) {
  return WHATSAPP_INTERACTION_INVENTORY.find(entry => entry.id === id) ?? null;
}

/**
 * Regra central de componente (épica #857): a contagem inclui Cancelar.
 * Até 3 ações → botões; 4 ou mais → lista.
 */
export function selectWhatsappClosedDecisionComponent(totalActionCount: number): "buttons" | "list" {
  return totalActionCount <= WHATSAPP_MAX_BUTTON_ACTIONS ? "buttons" : "list";
}

export type WhatsappClosedDecisionAction = {
  /** Ação canônica persistida no callback. */
  action: string;
  /** Rótulo funcional curto (título de botão/linha). */
  label: string;
  /** Descrição auxiliar mostrada apenas em listas. */
  description?: string;
};

const MAX_BUTTON_TITLE_LENGTH = 20;
const MAX_LIST_ROW_TITLE_LENGTH = 24;

function truncateTitle(title: string, maxLength: number) {
  return title.length > maxLength ? `${title.slice(0, maxLength - 1)}…` : title;
}

/**
 * Constrói a resposta interativa de uma decisão fechada aplicando a regra
 * central de componente. As ações devem vir na ordem canônica do produtor,
 * com Cancelar incluído quando há pendência ou possibilidade de mutação.
 */
export function buildWhatsappClosedDecisionReply(input: {
  bodyText: string;
  pendingOperationId: number;
  actions: WhatsappClosedDecisionAction[];
  /** Texto do botão que abre a lista quando há 4+ ações. */
  listButtonText?: string;
}): WhatsAppLogicalReply {
  const component = selectWhatsappClosedDecisionComponent(input.actions.length);
  if (component === "buttons") {
    return buttonsReply(input.bodyText, input.actions.map(action => ({
      id: buildWhatsAppCallbackId(input.pendingOperationId, action.action),
      title: truncateTitle(action.label, MAX_BUTTON_TITLE_LENGTH),
    })));
  }
  return listReply(input.bodyText, input.listButtonText ?? "Ver opções", [{
    rows: input.actions.map(action => ({
      id: buildWhatsAppCallbackId(input.pendingOperationId, action.action),
      title: truncateTitle(action.label, MAX_LIST_ROW_TITLE_LENGTH),
      ...(action.description ? { description: action.description } : {}),
    })),
  }]);
}
