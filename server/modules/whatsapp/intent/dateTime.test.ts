import { describe, expect, it } from "vitest";
import { parseReportPeriod } from "./dateTime";

type ConcretePeriod = Exclude<ReturnType<typeof parseReportPeriod>, null | { kind: "clarification" }>;

function expectConcretePeriod(period: ReturnType<typeof parseReportPeriod>): asserts period is ConcretePeriod {
  expect(period).toBeTruthy();
  expect(period).not.toEqual(expect.objectContaining({ kind: "clarification" }));
}

describe("parseReportPeriod", () => {
  const receivedAt = new Date("2026-07-07T15:00:00.000Z");

  it.each([
    "Relatório semana passada",
    "Resumo semana passada",
    "Relatório semana anterior",
  ])("resolve %s para a semana calendário anterior completa", text => {
    const period = parseReportPeriod(text, receivedAt, "America/Sao_Paulo");

    expectConcretePeriod(period);
    expect(period.start.toISOString()).toBe("2026-06-29T03:00:00.000Z");
    expect(period.end.toISOString()).toBe("2026-07-06T02:59:59.000Z");
    expect(period.label).toBe("29/06/2026 a 05/07/2026");
  });

  it("resolve esta semana para a semana calendário atual", () => {
    const period = parseReportPeriod("Relatório esta semana", receivedAt, "America/Sao_Paulo");

    expectConcretePeriod(period);
    expect(period.start.toISOString()).toBe("2026-07-06T03:00:00.000Z");
    expect(period.end.toISOString()).toBe("2026-07-13T02:59:59.000Z");
    expect(period.label).toBe("06/07/2026 a 12/07/2026");
  });

  it("mantém últimos 7 dias como janela móvel diferente de semana passada", () => {
    const period = parseReportPeriod("Relatório últimos 7 dias", receivedAt, "America/Sao_Paulo");

    expectConcretePeriod(period);
    expect(period.start.toISOString()).toBe("2026-07-01T03:00:00.000Z");
    expect(period.end.toISOString()).toBe("2026-07-08T02:59:59.000Z");
    expect(period.label).toBe("01/07/2026 a 07/07/2026");
  });

  it("resolve mês passado como mês calendário anterior completo", () => {
    const period = parseReportPeriod("Relatório mês passado", receivedAt, "America/Sao_Paulo");

    expectConcretePeriod(period);
    expect(period.start.toISOString()).toBe("2026-06-01T03:00:00.000Z");
    expect(period.end.toISOString()).toBe("2026-07-01T02:59:59.000Z");
    expect(period.label).toBe("01/06/2026 a 30/06/2026");
  });

  it("pede esclarecimento quando o relatório não informa período", () => {
    expect(parseReportPeriod("Relatório", receivedAt, "America/Sao_Paulo")).toEqual({ kind: "clarification" });
    expect(parseReportPeriod("Resumo", receivedAt, "America/Sao_Paulo")).toEqual({ kind: "clarification" });
  });

  it("não trata saudação ou texto alimentar como pedido de relatório", () => {
    expect(parseReportPeriod("olá", receivedAt, "America/Sao_Paulo")).toBeNull();
    expect(parseReportPeriod("100g maçã fuji", receivedAt, "America/Sao_Paulo")).toBeNull();
  });
});
