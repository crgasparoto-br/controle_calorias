import { describe, expect, it } from "vitest";
import {
  buildWhatsappAiToolTrace,
  listWhatsappAiToolContracts,
  runWhatsappAiTool,
  validateWhatsappAiToolUse,
} from "./aiToolContract";

describe("aiToolContract", () => {
  it("lista catalogo versionado com ferramentas de leitura, simulacao, escrita e revisao", () => {
    const contracts = listWhatsappAiToolContracts();

    expect(contracts.map(contract => contract.id)).toEqual(expect.arrayContaining([
      "meal_records_list",
      "meal_item_nutrition_simulate",
      "meal_record_create",
      "clarification_request",
    ]));
    expect(contracts.every(contract => contract.version === "whatsapp-ai-tool/v1")).toBe(true);
    expect(contracts.some(contract => contract.kind === "read")).toBe(true);
    expect(contracts.some(contract => contract.kind === "simulation")).toBe(true);
    expect(contracts.some(contract => contract.kind === "write")).toBe(true);
    expect(contracts.some(contract => contract.kind === "review")).toBe(true);
  });

  it("permite ferramenta de leitura compatível com intenção de consulta", () => {
    const validation = validateWhatsappAiToolUse({
      toolId: "meal_records_list",
      intent: "list_meal_records",
    });

    expect(validation.allowed).toBe(true);
    expect(validation.contract.kind).toBe("read");
  });

  it("bloqueia ferramenta fora do escopo da intenção classificada", () => {
    const trace = buildWhatsappAiToolTrace({
      toolId: "meal_record_create",
      intent: "list_meal_records",
      backendValidated: true,
      idempotencyKey: "message-1",
      outcome: "success",
      parameterSummary: { itemCount: 1 },
    });

    expect(trace).toEqual(expect.objectContaining({
      toolId: "meal_record_create",
      decision: "blocked",
      outcome: "skipped",
      failureReason: "intent_not_allowed",
    }));
  });

  it("exige validação de backend para simulação nutricional", () => {
    expect(validateWhatsappAiToolUse({
      toolId: "meal_item_nutrition_simulate",
      intent: "add_foods_to_meal",
    })).toEqual(expect.objectContaining({
      allowed: false,
      reason: "backend_validation_required",
    }));

    expect(validateWhatsappAiToolUse({
      toolId: "meal_item_nutrition_simulate",
      intent: "add_foods_to_meal",
      backendValidated: true,
    })).toEqual(expect.objectContaining({ allowed: true }));
  });

  it("exige idempotência para ferramenta persistente", () => {
    expect(validateWhatsappAiToolUse({
      toolId: "meal_record_create",
      intent: "add_foods_to_meal",
      backendValidated: true,
    })).toEqual(expect.objectContaining({
      allowed: false,
      reason: "idempotency_key_required",
    }));

    expect(validateWhatsappAiToolUse({
      toolId: "meal_record_create",
      intent: "add_foods_to_meal",
      backendValidated: true,
      idempotencyKey: "message-1",
    })).toEqual(expect.objectContaining({ allowed: true }));
  });

  it("rastreia falha sem lançar erro para o pipeline", async () => {
    const result = await runWhatsappAiTool({
      toolId: "meal_records_list",
      intent: "list_meal_records",
      outcome: "success",
      parameterSummary: { dateWindow: "today" },
    }, async () => {
      throw new Error("ServiceUnavailable");
    });

    expect(result.result).toBeNull();
    expect(result.trace).toEqual(expect.objectContaining({
      toolId: "meal_records_list",
      decision: "allowed",
      outcome: "failure",
      failureReason: "Error",
    }));
  });

  it("rastreia timeout como fallback operacional", async () => {
    const result = await runWhatsappAiTool({
      toolId: "meal_records_list",
      intent: "list_meal_records",
      outcome: "success",
      timeoutMs: 1,
      parameterSummary: { dateWindow: "today" },
    }, () => new Promise(resolve => setTimeout(() => resolve([1]), 10)));

    expect(result.result).toBeNull();
    expect(result.trace).toEqual(expect.objectContaining({
      toolId: "meal_records_list",
      decision: "allowed",
      outcome: "timeout",
      failureReason: "timeout",
    }));
  });
});
