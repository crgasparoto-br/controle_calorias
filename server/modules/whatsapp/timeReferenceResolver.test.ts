import { describe, expect, it } from "vitest";
import { buildWhatsappTimeReferenceClarification, resolveWhatsappTimeReferencesForText } from "./timeReferenceResolver";

describe("resolveWhatsappTimeReferencesForText", () => {
  const mondayNoonUtc = new Date("2026-06-15T15:00:00.000Z");

  it("resolve ontem usando o fuso do usuario e remove o marcador temporal do texto", () => {
    const resolved = resolveWhatsappTimeReferencesForText({
      text: "jantar de ontem arroz e frango",
      receivedAt: mondayNoonUtc,
      timezone: "America/Sao_Paulo",
    });

    expect(resolved).toEqual(expect.objectContaining({
      changed: true,
      ambiguous: false,
      text: "jantar arroz e frango",
      mealReference: expect.objectContaining({ mealLabel: "Jantar" }),
      timeReference: expect.objectContaining({
        expression: "ontem",
        dateKey: "2026-06-14",
        timezone: "America/Sao_Paulo",
        timezoneFallbackUsed: false,
        kind: "yesterday",
      }),
    }));
  });

  it("resolve anteontem e amanha com o dateKey correto", () => {
    const anteontem = resolveWhatsappTimeReferencesForText({
      text: "almoço de anteontem arroz",
      receivedAt: mondayNoonUtc,
      timezone: "America/Sao_Paulo",
    });
    const amanha = resolveWhatsappTimeReferencesForText({
      text: "planejar almoço de amanhã",
      receivedAt: mondayNoonUtc,
      timezone: "America/Sao_Paulo",
    });

    expect(anteontem.timeReference).toEqual(expect.objectContaining({
      expression: "anteontem",
      dateKey: "2026-06-13",
      kind: "day_before_yesterday",
    }));
    expect(amanha.timeReference).toEqual(expect.objectContaining({
      expression: "amanhã",
      dateKey: "2026-06-16",
      kind: "tomorrow",
    }));
  });

  it("resolve dia da semana passado e proximo dia da semana", () => {
    const sabadoPassado = resolveWhatsappTimeReferencesForText({
      text: "almoço de sábado passado feijão",
      receivedAt: mondayNoonUtc,
      timezone: "America/Sao_Paulo",
    });
    const proximoSabado = resolveWhatsappTimeReferencesForText({
      text: "jantar próximo sábado pizza",
      receivedAt: mondayNoonUtc,
      timezone: "America/Sao_Paulo",
    });

    expect(sabadoPassado.timeReference).toEqual(expect.objectContaining({
      expression: expect.stringContaining("sabado"),
      dateKey: "2026-06-13",
      kind: "weekday",
    }));
    expect(proximoSabado.timeReference).toEqual(expect.objectContaining({
      expression: expect.stringContaining("sabado"),
      dateKey: "2026-06-20",
      kind: "weekday",
    }));
  });

  it("pede esclarecimento quando dia da semana esta ambiguo", () => {
    const resolved = resolveWhatsappTimeReferencesForText({
      text: "corrigir almoço de sábado",
      receivedAt: mondayNoonUtc,
      timezone: "America/Sao_Paulo",
    });
    const response = buildWhatsappTimeReferenceClarification(resolved);

    expect(resolved.ambiguous).toBe(true);
    expect(resolved.timeReference).toBeUndefined();
    expect(resolved.clarificationQuestion).toContain("sábado passado");
    expect(response).toEqual(expect.objectContaining({
      action: "time_reference_clarification_needed",
      eventType: "whatsapp.time_reference.clarification_needed",
      data: expect.objectContaining({
        timeReferenceAmbiguous: true,
        mealLabel: "Almoço",
      }),
    }));
  });

  it("usa fallback de timezone quando o perfil nao possui fuso valido", () => {
    const resolved = resolveWhatsappTimeReferencesForText({
      text: "café da manhã de ontem pão",
      receivedAt: mondayNoonUtc,
      timezone: null,
    });

    expect(resolved.timeReference).toEqual(expect.objectContaining({
      dateKey: "2026-06-14",
      timezoneFallbackUsed: true,
    }));
    expect(resolved.mealReference).toEqual(expect.objectContaining({ mealLabel: "Café da manhã" }));
  });

  it("respeita madrugada no fuso do usuario ao calcular o dia logico", () => {
    const resolved = resolveWhatsappTimeReferencesForText({
      text: "jantar de ontem arroz",
      receivedAt: new Date("2026-06-15T02:30:00.000Z"),
      timezone: "America/Sao_Paulo",
    });

    expect(resolved.timeReference).toEqual(expect.objectContaining({
      dateKey: "2026-06-13",
      timezone: "America/Sao_Paulo",
    }));
  });

  it("nao altera texto sem referencia temporal ou refeicao relativa", () => {
    const resolved = resolveWhatsappTimeReferencesForText({
      text: "100g arroz e 80g feijão",
      receivedAt: mondayNoonUtc,
      timezone: "America/Sao_Paulo",
    });

    expect(resolved.changed).toBe(false);
    expect(resolved.ambiguous).toBe(false);
    expect(resolved.text).toBe("100g arroz e 80g feijão");
    expect(resolved.timeReference).toBeUndefined();
    expect(resolved.mealReference).toBeUndefined();
  });
});
