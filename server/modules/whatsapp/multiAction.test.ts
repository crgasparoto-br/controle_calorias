import { describe, expect, it } from "vitest";
import { detectWhatsappMultiActionSegments } from "./multiAction";

describe("detectWhatsappMultiActionSegments", () => {
  it("divide multiplas trocas explicitas preservando ordem", () => {
    expect(detectWhatsappMultiActionSegments("Não é peixe é frango, não é mandioquinha é batata doce")).toEqual([
      { index: 1, text: "Não é peixe é frango", reason: "explicit_separator" },
      { index: 2, text: "não é mandioquinha é batata doce", reason: "explicit_separator" },
    ]);
  });

  it("divide mistura de adicionar, trocar e remover", () => {
    expect(detectWhatsappMultiActionSegments("adiciona arroz, troca o frango por peixe e remove a cerveja")).toEqual([
      { index: 1, text: "adiciona arroz", reason: "explicit_separator" },
      { index: 2, text: "troca o frango por peixe", reason: "explicit_separator" },
      { index: 3, text: "remove a cerveja", reason: "explicit_separator" },
    ]);
  });

  it("preserva lista alimentar simples como uma unica acao", () => {
    expect(detectWhatsappMultiActionSegments("café, pão e leite")).toBeNull();
  });

  it("divide declaracao de refeicao seguida de ajuste", () => {
    expect(detectWhatsappMultiActionSegments("no almoço foi arroz, feijão, frango; tira o feijão")).toEqual([
      { index: 1, text: "no almoço foi arroz, feijão, frango", reason: "explicit_separator" },
      { index: 2, text: "tira o feijão", reason: "explicit_separator" },
    ]);
  });
});
