import { describe, expect, it } from "vitest";
import { getQuestionContextSections, resolveQuestionContextScope } from "./questionContextPlan";

describe("resolveQuestionContextScope", () => {
  it.each([
    ["o que é déficit calórico?", "none"],
    ["qual é a recomendação atual de fibras?", "none"],
    ["quantas calorias tem uma banana?", "none"],
    ["como funciona o índice glicêmico?", "none"],
  ] as const)("não carrega dados pessoais para pergunta genérica: %s", (question, expected) => {
    expect(resolveQuestionContextScope(question)).toBe(expected);
  });

  it.each([
    ["como está meu consumo hoje?", "today"],
    ["quanto eu consumi hoje?", "today"],
    ["como foi meu consumo esta semana?", "week"],
    ["como está minha evolução nos últimos 30 dias?", "period"],
  ] as const)("seleciona a menor janela explícita: %s", (question, expected) => {
    expect(resolveQuestionContextScope(question)).toBe(expected);
  });

  it.each([
    "e proteína?",
    "e sobre isso?",
    "o que você sugeriu antes?",
    "como está minha alimentação?",
    "me sugira um jantar",
    "quanto de proteína devo consumir?",
    "qual a melhor fonte de proteína para mim?",
    "quais macros eu deveria priorizar?",
  ])("mantém contexto completo quando a intenção depende de continuidade ou é ambígua: %s", question => {
    expect(resolveQuestionContextScope(question)).toBe("full");
  });

  it("mapeia escopos para uma única fonte de seleção de seções", () => {
    expect(getQuestionContextSections("none")).toEqual({ today: false, currentWeek: false, last30Days: false });
    expect(getQuestionContextSections("today")).toEqual({ today: true, currentWeek: false, last30Days: false });
    expect(getQuestionContextSections("week")).toEqual({ today: false, currentWeek: true, last30Days: false });
    expect(getQuestionContextSections("period")).toEqual({ today: false, currentWeek: false, last30Days: true });
    expect(getQuestionContextSections("full")).toEqual({ today: true, currentWeek: true, last30Days: true });
  });
});
