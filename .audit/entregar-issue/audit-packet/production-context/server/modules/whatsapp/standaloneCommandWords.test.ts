import { describe, expect, it } from "vitest";
import {
  isStandaloneWhatsappCancellationWord,
  isStandaloneWhatsappCommandWord,
  isStandaloneWhatsappConfirmationWord,
} from "./standaloneCommandWords";

describe("standaloneCommandWords", () => {
  it.each([
    "registrar",
    "CONFIRMAR",
    "cancelar",
    "editar",
    "consultar",
    "sim",
    "não",
    "ok",
    "2",
    "opção 3",
    "170 g",
    "200 ml",
  ])("bloqueia a mensagem inteira %s", value => {
    expect(isStandaloneWhatsappCommandWord(value)).toBe(true);
  });

  it.each([
    "registrar 100 g de arroz",
    "adicionar 1 banana",
    "consultar registros de ontem",
    "170 g de iogurte natural",
  ])("não bloqueia comando completo %s", value => {
    expect(isStandaloneWhatsappCommandWord(value)).toBe(false);
  });

  it("separa confirmações e cancelamentos compatíveis", () => {
    expect(isStandaloneWhatsappConfirmationWord("registrar")).toBe(true);
    expect(isStandaloneWhatsappConfirmationWord("sim")).toBe(true);
    expect(isStandaloneWhatsappCancellationWord("não")).toBe(true);
    expect(isStandaloneWhatsappCancellationWord("cancelar")).toBe(true);
  });
});
