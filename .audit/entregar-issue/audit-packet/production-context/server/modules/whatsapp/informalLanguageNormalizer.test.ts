import { describe, expect, it } from "vitest";
import { normalizeWhatsappInformalLanguage } from "./informalLanguageNormalizer";
import { normalizeWhatsappInboundMessage } from "./inboundNormalizer";

describe("normalizeWhatsappInformalLanguage", () => {
  it("preserva texto original e normaliza falta de acento, abreviacao e quantidade", () => {
    const normalized = normalizeWhatsappInformalLanguage("2 fatia pao c queijo");

    expect(normalized).toEqual(expect.objectContaining({
      originalText: "2 fatia pao c queijo",
      normalizedText: "2 fatias pão com queijo",
      requiresClarification: false,
    }));
    expect(normalized?.replacements).toEqual(expect.arrayContaining([
      expect.objectContaining({ raw: "fatia", kind: "quantity", source: "built_in" }),
      expect.objectContaining({ raw: "pao", normalized: "pão", kind: "spelling" }),
      expect.objectContaining({ raw: "c", normalized: "com", kind: "spelling" }),
    ]));
  });

  it("normaliza marca incompleta sem perder rastreio", () => {
    const normalized = normalizeWhatsappInformalLanguage("1 cafe lor");

    expect(normalized?.normalizedText).toBe("1 café L'Or");
    expect(normalized?.replacements).toEqual(expect.arrayContaining([
      expect.objectContaining({
        raw: "cafe lor",
        normalized: "café L'Or",
        kind: "brand",
        confidence: 0.88,
      }),
    ]));
  });

  it("normaliza termo informal de bebida zero", () => {
    const normalized = normalizeWhatsappInformalLanguage("refri zero no almoço");

    expect(normalized?.normalizedText).toBe("refrigerante zero no almoço");
    expect(normalized?.replacements).toEqual(expect.arrayContaining([
      expect.objectContaining({ raw: "refri zero", normalized: "refrigerante zero", kind: "food" }),
    ]));
  });

  it("normaliza marca regional conhecida em produto com marca", () => {
    const normalized = normalizeWhatsappInformalLanguage("miojo turma da monica");

    expect(normalized?.normalizedText).toBe("miojo Turma da Monica");
    expect(normalized?.replacements).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "brand", normalized: "miojo Turma da Monica" }),
    ]));
  });

  it("marca porcao informal incerta para esclarecimento", () => {
    const normalized = normalizeWhatsappInformalLanguage("um tiquinho de azeite");

    expect(normalized?.requiresClarification).toBe(true);
    expect(normalized?.uncertainTerms).toContain("tiquinho");
    expect(normalized?.clarificationQuestion).toContain("quantidade");
  });

  it("aplica aliases pessoais revisados e segura candidatos globais para revisao", () => {
    const normalized = normalizeWhatsappInformalLanguage("meu shake e cremosa", {
      aliases: [
        {
          raw: "meu shake",
          normalized: "shake de banana com whey",
          kind: "food",
          scope: "personal",
          confidence: 0.93,
        },
        {
          raw: "cremosa",
          normalized: "crepioca cremosa",
          kind: "food",
          scope: "global_candidate",
          confidence: 0.71,
        },
      ],
    });

    expect(normalized?.normalizedText).toContain("shake de banana com whey");
    expect(normalized?.candidateGlobalAliases).toEqual([
      expect.objectContaining({ raw: "cremosa", scope: "global_candidate" }),
    ]);
    expect(normalized?.requiresClarification).toBe(true);
  });
});

describe("normalizeWhatsappInboundMessage informal language", () => {
  it("entrega routerText com linguagem informal normalizada e original preservado", () => {
    const normalized = normalizeWhatsappInboundMessage({
      messageId: "wamid-informal",
      text: "2 fatia pao c queijo",
    });

    expect(normalized.originalText).toBe("2 fatia pao c queijo");
    expect(normalized.routerText).toBe("2 fatias pão com queijo");
    expect(normalized.informalLanguage).toEqual(expect.objectContaining({
      originalText: "2 fatia pao c queijo",
      normalizedText: "2 fatias pão com queijo",
    }));
  });
});
