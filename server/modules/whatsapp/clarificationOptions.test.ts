import { describe, expect, it } from "vitest";
import { buildWhatsappClarificationPrompt, parseWhatsappClarificationSelection } from "./clarificationOptions";

const options = [
  { id: "rice-lunch", label: "Arroz no almoço" },
  { id: "rice-dinner", label: "Arroz no jantar" },
];

describe("clarificationOptions", () => {
  it("monta pergunta com opcoes numeradas e instrucao de resposta", () => {
    const prompt = buildWhatsappClarificationPrompt({
      question: "Qual item devo usar?",
      options,
    });

    expect(prompt).toContain("Qual item devo usar?");
    expect(prompt).toContain("1. Arroz no almoço");
    expect(prompt).toContain("2. Arroz no jantar");
    expect(prompt).toContain("Responda com o número");
  });

  it("interpreta numero, opcao textual e ordinal", () => {
    expect(parseWhatsappClarificationSelection("2", options)).toEqual(expect.objectContaining({
      kind: "selected",
      selectedNumber: 2,
      option: expect.objectContaining({ id: "rice-dinner" }),
    }));
    expect(parseWhatsappClarificationSelection("opção 1", options)).toEqual(expect.objectContaining({
      kind: "selected",
      selectedNumber: 1,
    }));
    expect(parseWhatsappClarificationSelection("a segunda", options)).toEqual(expect.objectContaining({
      kind: "selected",
      selectedNumber: 2,
    }));
  });

  it("interpreta texto da opcao, cancelamento e faixa invalida", () => {
    expect(parseWhatsappClarificationSelection("arroz no jantar", options)).toEqual(expect.objectContaining({
      kind: "selected",
      selectedNumber: 2,
    }));
    expect(parseWhatsappClarificationSelection("nenhuma", options)).toEqual({ kind: "cancelled" });
    expect(parseWhatsappClarificationSelection("9", options)).toEqual({
      kind: "out_of_range",
      selectedNumber: 9,
      optionCount: 2,
    });
  });
});
