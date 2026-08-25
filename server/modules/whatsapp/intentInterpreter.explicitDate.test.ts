import { describe, expect, it } from "vitest";
import { classifyWhatsappMessageDeterministically } from "./intentInterpreter";

describe("intentInterpreter explicit meal date", () => {
  it("não habilita criação automática quando há data relativa explícita", () => {
    const intent = classifyWhatsappMessageDeterministically(
      "adicionar no café da manhã de hoje: 1 pão",
    );

    expect(intent.intent).toBe("add_foods_to_meal");
    expect(intent.meal).toEqual({
      label: "café da manhã de hoje",
      createIfMissing: false,
    });
  });

  it("preserva criação contextual quando não há data explícita", () => {
    const intent = classifyWhatsappMessageDeterministically(
      "adicionar no café da manhã: 1 pão",
    );

    expect(intent.intent).toBe("add_foods_to_meal");
    expect(intent.meal).toEqual({
      label: "café da manhã",
      createIfMissing: true,
    });
  });
});
