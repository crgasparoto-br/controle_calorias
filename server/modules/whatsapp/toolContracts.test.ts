import { describe, expect, it } from "vitest";
import {
  assertWhatsappAiToolAllowed,
  listWhatsappAiToolContracts,
  WhatsappAiToolContractError,
} from "./toolContracts";

describe("whatsapp AI tool contracts", () => {
  it("lista contratos com escopo, efeito, validacao e fallback", () => {
    const contracts = listWhatsappAiToolContracts();

    expect(contracts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "meal_history_read",
        effect: "read",
        requiresValidatedIntent: true,
        requiresBackendValidation: true,
        fallback: "clarification",
      }),
      expect.objectContaining({
        name: "meal_create",
        effect: "write",
        allowedIntents: ["add_foods_to_meal"],
      }),
      expect.objectContaining({
        name: "meal_update",
        effect: "correction",
        allowedIntents: ["add_foods_to_meal", "replace_food_in_meal"],
      }),
    ]));
  });

  it("permite ferramenta somente para intencao compativel", () => {
    expect(assertWhatsappAiToolAllowed("meal_create", "add_foods_to_meal")).toEqual(expect.objectContaining({
      name: "meal_create",
    }));

    expect(() => assertWhatsappAiToolAllowed("meal_create", "daily_summary")).toThrow(WhatsappAiToolContractError);
  });

  it("bloqueia correcao de refeicao para intencao de consulta", () => {
    expect(() => assertWhatsappAiToolAllowed("meal_update", "list_meal_records")).toThrow(
      "Ferramenta meal_update nao pode ser usada para a intencao list_meal_records.",
    );
  });
});
