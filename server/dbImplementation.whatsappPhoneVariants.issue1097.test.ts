import { describe, expect, it } from "vitest";
import { getWhatsAppPhoneNumberVariants } from "./dbImplementation";

describe("issue #1097 — variantes de telefone WhatsApp", () => {
  it("aceita o remetente Meta com prefixo 55 quando a conexão legada não o possui", () => {
    expect(getWhatsAppPhoneNumberVariants("5511999999999")).toEqual([
      "5511999999999",
      "11999999999",
    ]);
  });

  it("aceita a conexão com prefixo 55 quando o remetente não o possui", () => {
    expect(getWhatsAppPhoneNumberVariants("11999999999")).toEqual([
      "11999999999",
      "5511999999999",
    ]);
  });

  it("não cria variantes para entrada vazia ou curta", () => {
    expect(getWhatsAppPhoneNumberVariants("")).toEqual([]);
    expect(getWhatsAppPhoneNumberVariants("123456789")).toEqual(["123456789"]);
  });
});
