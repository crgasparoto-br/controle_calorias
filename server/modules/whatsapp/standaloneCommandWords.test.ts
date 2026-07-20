import { describe, expect, it } from "vitest";
import { isStandaloneWhatsappCommandWord } from "./standaloneCommandWords";

describe("isStandaloneWhatsappCommandWord", () => {
  it("reconhece comandos isolados de continuidade", () => {
    for (const word of ["registrar", "Registrar", "confirmar", "confirma", "cancelar", "editar", "consultar", "sim", "não", "ok", "7"]) {
      expect(isStandaloneWhatsappCommandWord(word)).toBe(true);
    }
  });

  it("nao reconhece frases completas com alimento", () => {
    for (const text of ["registrar 100 g de arroz", "1 iogurte natural desnatado", "confirmar pedido de acesso", "editar a refeição de ontem"]) {
      expect(isStandaloneWhatsappCommandWord(text)).toBe(false);
    }
  });

  it("retorna falso para texto vazio ou nulo", () => {
    expect(isStandaloneWhatsappCommandWord("")).toBe(false);
    expect(isStandaloneWhatsappCommandWord(null)).toBe(false);
    expect(isStandaloneWhatsappCommandWord(undefined)).toBe(false);
  });
});
