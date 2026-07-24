import { describe, expect, it } from "vitest";
import { parseFoodClarificationQuantityReply } from "./foodClarificationContract";

describe("quantidade do complemento calórico", () => {
  it.each([
    ["5 g", { quantity: 5, unit: "g" }],
    ["1 colher de chá", { quantity: 1, unit: "colher de cha" }],
    ["2 colheres de sopa", { quantity: 2, unit: "colher de sopa" }],
    ["1 sachê", { quantity: 1, unit: "sache" }],
  ])("aceita %s sem transformar a resposta em novo comando", (text, expected) => {
    expect(parseFoodClarificationQuantityReply(text)).toEqual(expected);
  });

  it.each(["sim", "um pouco", "1 copo"])("mantém a pendência para resposta incompatível %s", text => {
    expect(parseFoodClarificationQuantityReply(text)).toBeNull();
  });
});
