import type { WhatsappIntentName } from "./intentSchema";

export type WhatsappAiToolName =
  | "meal_history_read"
  | "meal_create"
  | "meal_update"
  | "nutrition_measurement_resolve";

export type WhatsappAiToolEffect = "read" | "simulation" | "validation" | "write" | "correction";

export type WhatsappAiToolContract = {
  name: WhatsappAiToolName;
  effect: WhatsappAiToolEffect;
  allowedIntents: WhatsappIntentName[];
  requiresValidatedIntent: boolean;
  requiresBackendValidation: boolean;
  fallback: "clarification" | "safe_noop" | "nutrition_fallback";
  auditSummary: string;
};

export class WhatsappAiToolContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WhatsappAiToolContractError";
  }
}

const contracts: Record<WhatsappAiToolName, WhatsappAiToolContract> = {
  meal_history_read: {
    name: "meal_history_read",
    effect: "read",
    allowedIntents: ["add_foods_to_meal", "replace_food_in_meal", "list_meal_records", "daily_summary"],
    requiresValidatedIntent: true,
    requiresBackendValidation: true,
    fallback: "clarification",
    auditSummary: "Consulta refeicoes do usuario atual para resolver alvo, listar registros ou montar resumo.",
  },
  meal_create: {
    name: "meal_create",
    effect: "write",
    allowedIntents: ["add_foods_to_meal"],
    requiresValidatedIntent: true,
    requiresBackendValidation: true,
    fallback: "clarification",
    auditSummary: "Cria refeicao apenas quando a intencao validada permite createIfMissing e possui itens extraidos.",
  },
  meal_update: {
    name: "meal_update",
    effect: "correction",
    allowedIntents: ["add_foods_to_meal", "replace_food_in_meal"],
    requiresValidatedIntent: true,
    requiresBackendValidation: true,
    fallback: "clarification",
    auditSummary: "Atualiza refeicao existente somente depois de resolver alvo compativel no backend.",
  },
  nutrition_measurement_resolve: {
    name: "nutrition_measurement_resolve",
    effect: "validation",
    allowedIntents: ["add_foods_to_meal"],
    requiresValidatedIntent: true,
    requiresBackendValidation: true,
    fallback: "nutrition_fallback",
    auditSummary: "Normaliza unidade e estima gramas antes de montar item nutricional heuristico.",
  },
};

export function listWhatsappAiToolContracts() {
  return Object.values(contracts).map(contract => ({ ...contract, allowedIntents: [...contract.allowedIntents] }));
}

export function getWhatsappAiToolContract(toolName: WhatsappAiToolName) {
  return contracts[toolName];
}

export function assertWhatsappAiToolAllowed(toolName: WhatsappAiToolName, intent: WhatsappIntentName) {
  const contract = getWhatsappAiToolContract(toolName);
  if (!contract.allowedIntents.includes(intent)) {
    throw new WhatsappAiToolContractError(
      `Ferramenta ${toolName} nao pode ser usada para a intencao ${intent}.`,
    );
  }
  return contract;
}
