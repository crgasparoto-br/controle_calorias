import type { WhatsappIntentName } from "./intentSchema";

export type WhatsappAiToolKind = "read" | "simulation" | "validation" | "write" | "correction" | "removal" | "suggestion" | "review";
export type WhatsappAiToolOutcome = "success" | "failure" | "timeout" | "skipped";
export type WhatsappAiToolDecision = "allowed" | "blocked";

export type WhatsappAiToolId =
  | "whatsapp_context_build"
  | "meal_records_list"
  | "meal_item_nutrition_simulate"
  | "meal_record_create"
  | "meal_record_update"
  | "records_link_suggest"
  | "clarification_request";

export type WhatsappAiToolContract = {
  id: WhatsappAiToolId;
  version: "whatsapp-ai-tool/v1";
  kind: WhatsappAiToolKind;
  allowedIntents: WhatsappIntentName[];
  persistentEffect: boolean;
  requiresBackendValidation: boolean;
  requiresIdempotencyKey: boolean;
  parameterPolicy: string[];
  preconditions: string[];
  postconditions: string[];
};

export type WhatsappAiToolTrace = {
  toolId: WhatsappAiToolId;
  version: WhatsappAiToolContract["version"];
  kind: WhatsappAiToolKind;
  outcome: WhatsappAiToolOutcome;
  decision: WhatsappAiToolDecision;
  parameterSummary: Record<string, string | number | boolean | null>;
  failureReason?: string;
};

type ValidateToolUseInput = {
  toolId: WhatsappAiToolId;
  intent: WhatsappIntentName;
  backendValidated?: boolean;
  idempotencyKey?: string | null;
};

type BuildToolTraceInput = ValidateToolUseInput & {
  outcome: WhatsappAiToolOutcome;
  parameterSummary?: Record<string, string | number | boolean | null>;
  failureReason?: string;
};

type RunToolInput = BuildToolTraceInput & {
  timeoutMs?: number;
};

const WRITE_INTENTS: WhatsappIntentName[] = ["add_foods_to_meal"];
const CORRECTION_INTENTS: WhatsappIntentName[] = ["replace_food_in_meal", "edit_food_quantity"];
const READ_INTENTS: WhatsappIntentName[] = ["list_meal_records", "daily_summary", ...WRITE_INTENTS, ...CORRECTION_INTENTS];
const NON_PERSISTENT_INTENTS: WhatsappIntentName[] = ["ambiguous", "unknown", "help", "open_records_link"];

const TOOL_CATALOG: Record<WhatsappAiToolId, WhatsappAiToolContract> = {
  whatsapp_context_build: {
    id: "whatsapp_context_build",
    version: "whatsapp-ai-tool/v1",
    kind: "read",
    allowedIntents: [...READ_INTENTS, "add_water", "add_exercise", ...NON_PERSISTENT_INTENTS],
    persistentEffect: false,
    requiresBackendValidation: false,
    requiresIdempotencyKey: false,
    parameterPolicy: ["userId", "receivedAt"],
    preconditions: ["Usuário autenticado no canal WhatsApp."],
    postconditions: ["Contexto mínimo é retornado sem texto cru desnecessário."],
  },
  meal_records_list: {
    id: "meal_records_list",
    version: "whatsapp-ai-tool/v1",
    kind: "read",
    allowedIntents: READ_INTENTS,
    persistentEffect: false,
    requiresBackendValidation: false,
    requiresIdempotencyKey: false,
    parameterPolicy: ["userId", "dateWindow", "mealLabel opcional"],
    preconditions: ["Intenção compatível com consulta, escrita ou correção contextual."],
    postconditions: ["Registros existentes são apenas consultados."],
  },
  meal_item_nutrition_simulate: {
    id: "meal_item_nutrition_simulate",
    version: "whatsapp-ai-tool/v1",
    kind: "simulation",
    allowedIntents: [...WRITE_INTENTS, ...CORRECTION_INTENTS],
    persistentEffect: false,
    requiresBackendValidation: true,
    requiresIdempotencyKey: false,
    parameterPolicy: ["itemCount", "hasQuantity", "hasUnit"],
    preconditions: ["Itens passaram pelo schema de intenção e validação de confiança."],
    postconditions: ["Estimativas ficam em memória até uma ferramenta persistente ser autorizada."],
  },
  meal_record_create: {
    id: "meal_record_create",
    version: "whatsapp-ai-tool/v1",
    kind: "write",
    allowedIntents: WRITE_INTENTS,
    persistentEffect: true,
    requiresBackendValidation: true,
    requiresIdempotencyKey: true,
    parameterPolicy: ["userId", "mealLabel", "itemCount", "occurredAt", "idempotencyKey"],
    preconditions: ["Intenção de escrita validada pelo backend.", "Chave de idempotência disponível."],
    postconditions: ["Refeição é criada uma única vez para a mensagem autorizada."],
  },
  meal_record_update: {
    id: "meal_record_update",
    version: "whatsapp-ai-tool/v1",
    kind: "correction",
    allowedIntents: ["add_foods_to_meal", ...CORRECTION_INTENTS],
    persistentEffect: true,
    requiresBackendValidation: true,
    requiresIdempotencyKey: true,
    parameterPolicy: ["userId", "mealId", "itemCount", "idempotencyKey"],
    preconditions: ["Alvo existente foi localizado com correspondência segura.", "Chave de idempotência disponível."],
    postconditions: ["Refeição existente é alterada apenas dentro do escopo da intenção."],
  },
  records_link_suggest: {
    id: "records_link_suggest",
    version: "whatsapp-ai-tool/v1",
    kind: "suggestion",
    allowedIntents: ["open_records_link", "help"],
    persistentEffect: false,
    requiresBackendValidation: false,
    requiresIdempotencyKey: false,
    parameterPolicy: ["userId", "destination"],
    preconditions: ["Intenção pede orientação ou link de revisão."],
    postconditions: ["Usuário recebe orientação sem alteração de dados."],
  },
  clarification_request: {
    id: "clarification_request",
    version: "whatsapp-ai-tool/v1",
    kind: "review",
    allowedIntents: ["ambiguous", "unknown", "add_foods_to_meal", "replace_food_in_meal", "edit_food_quantity", "add_water", "add_exercise"],
    persistentEffect: false,
    requiresBackendValidation: false,
    requiresIdempotencyKey: false,
    parameterPolicy: ["intent", "confidence", "possibleIntents"],
    preconditions: ["Confiança baixa, confirmação exigida ou alvo inseguro."],
    postconditions: ["Nenhuma persistência ocorre antes da resposta do usuário."],
  },
};

export function listWhatsappAiToolContracts() {
  return Object.values(TOOL_CATALOG);
}

export function getWhatsappAiToolContract(toolId: WhatsappAiToolId) {
  return TOOL_CATALOG[toolId];
}

export function validateWhatsappAiToolUse(input: ValidateToolUseInput) {
  const contract = getWhatsappAiToolContract(input.toolId);
  if (!contract.allowedIntents.includes(input.intent)) {
    return { allowed: false as const, contract, reason: "intent_not_allowed" };
  }
  if (contract.requiresBackendValidation && !input.backendValidated) {
    return { allowed: false as const, contract, reason: "backend_validation_required" };
  }
  if (contract.requiresIdempotencyKey && !input.idempotencyKey) {
    return { allowed: false as const, contract, reason: "idempotency_key_required" };
  }
  return { allowed: true as const, contract };
}

export function buildWhatsappAiToolTrace(input: BuildToolTraceInput): WhatsappAiToolTrace {
  const validation = validateWhatsappAiToolUse(input);
  return {
    toolId: input.toolId,
    version: validation.contract.version,
    kind: validation.contract.kind,
    outcome: validation.allowed ? input.outcome : "skipped",
    decision: validation.allowed ? "allowed" : "blocked",
    parameterSummary: input.parameterSummary ?? {},
    ...(validation.allowed
      ? input.failureReason ? { failureReason: input.failureReason } : {}
      : { failureReason: validation.reason }),
  };
}

class WhatsappAiToolTimeoutError extends Error {
  constructor(toolId: WhatsappAiToolId, timeoutMs: number) {
    super(`WhatsApp AI tool ${toolId} timed out after ${timeoutMs}ms`);
    this.name = "WhatsappAiToolTimeoutError";
  }
}

async function runWithTimeout<T>(toolId: WhatsappAiToolId, operation: Promise<T>, timeoutMs: number) {
  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new WhatsappAiToolTimeoutError(toolId, timeoutMs)), timeoutMs);
  });
  try {
    return await Promise.race([operation, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function runWhatsappAiTool<T>(input: RunToolInput, operation: () => Promise<T>) {
  const validation = validateWhatsappAiToolUse(input);
  if (!validation.allowed) {
    return {
      trace: buildWhatsappAiToolTrace({ ...input, outcome: "skipped" }),
      result: null,
    };
  }

  try {
    const result = input.timeoutMs
      ? await runWithTimeout(input.toolId, operation(), input.timeoutMs)
      : await operation();
    return {
      trace: buildWhatsappAiToolTrace({ ...input, outcome: "success" }),
      result,
    };
  } catch (error) {
    const timedOut = error instanceof WhatsappAiToolTimeoutError;
    return {
      trace: buildWhatsappAiToolTrace({
        ...input,
        outcome: timedOut ? "timeout" : "failure",
        failureReason: timedOut ? "timeout" : error instanceof Error ? error.name : "tool_failure",
      }),
      result: null,
    };
  }
}
