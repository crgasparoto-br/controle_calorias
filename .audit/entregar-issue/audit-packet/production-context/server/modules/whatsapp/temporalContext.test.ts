import { describe, expect, it } from "vitest";
import { resolveWhatsappTemporalContext } from "./temporalContext";

describe("resolveWhatsappTemporalContext", () => {
  it("resolve ontem usando o fuso configurado do usuario durante madrugada em UTC", () => {
    const result = resolveWhatsappTemporalContext({
      text: "jantar de ontem",
      receivedAt: new Date("2026-06-15T02:30:00.000Z"),
      userTimezone: "America/Sao_Paulo",
    });

    expect(result.clarification).toBeNull();
    expect(result.context).toEqual(expect.objectContaining({
      temporalExpression: "ontem",
      resolvedDate: "2026-06-13",
      localReferenceDate: "2026-06-14",
      mealSlot: "jantar",
      userTimezone: "America/Sao_Paulo",
      timezoneSource: "configured",
    }));
  });

  it("resolve a mesma mensagem de madrugada de forma diferente para usuario em UTC", () => {
    const result = resolveWhatsappTemporalContext({
      text: "jantar de ontem",
      receivedAt: new Date("2026-06-15T02:30:00.000Z"),
      userTimezone: "UTC",
    });

    expect(result.context).toEqual(expect.objectContaining({
      resolvedDate: "2026-06-14",
      localReferenceDate: "2026-06-15",
      userTimezone: "UTC",
      timezoneSource: "configured",
    }));
  });

  it("resolve amanha como registro futuro rastreavel", () => {
    const result = resolveWhatsappTemporalContext({
      text: "lança isso para amanhã no almoço",
      receivedAt: new Date("2026-06-15T12:00:00.000Z"),
      userTimezone: "America/Sao_Paulo",
    });

    expect(result.context).toEqual(expect.objectContaining({
      temporalExpression: "amanha",
      resolvedDate: "2026-06-16",
      mealSlot: "almoco",
      dateKind: "tomorrow",
    }));
  });

  it("resolve sabado passado a partir da data local do usuario", () => {
    const result = resolveWhatsappTemporalContext({
      text: "corrige o almoço de sábado passado",
      receivedAt: new Date("2026-06-15T12:00:00.000Z"),
      userTimezone: "America/Sao_Paulo",
    });

    expect(result.context).toEqual(expect.objectContaining({
      temporalExpression: "sabado passado",
      resolvedDate: "2026-06-13",
      mealSlot: "almoco",
      dateKind: "weekday",
    }));
  });

  it("pede esclarecimento para dia da semana sem direcao temporal", () => {
    const result = resolveWhatsappTemporalContext({
      text: "almoço de sábado",
      receivedAt: new Date("2026-06-15T12:00:00.000Z"),
      userTimezone: "America/Sao_Paulo",
    });

    expect(result.context).toBeNull();
    expect(result.clarification).toEqual(expect.objectContaining({
      action: "temporal_context_clarification_needed",
      data: expect.objectContaining({
        temporalExpression: "sabado",
        ambiguityReason: "dia da semana sem passado ou proximo",
      }),
    }));
  });

  it("marca fallback quando o usuario nao tem fuso configurado", () => {
    const result = resolveWhatsappTemporalContext({
      text: "café da manhã hoje cedo",
      receivedAt: new Date("2026-06-15T12:00:00.000Z"),
    });

    expect(result.context).toEqual(expect.objectContaining({
      temporalExpression: "hoje",
      resolvedDate: "2026-06-15",
      mealSlot: "cafe_da_manha",
      timezoneSource: "fallback",
    }));
  });
});
