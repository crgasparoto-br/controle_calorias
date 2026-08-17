import { describe, expect, it } from "vitest";
import {
  buildWhatsappClosedDecisionReply,
  selectWhatsappInteractionComponent,
} from "./interactionPresentation";

function actions(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `action:${index}`,
    label: `Opção ${index + 1}`,
    effect: `effect:${index}`,
  }));
}

function buildCandidateReply(candidateCount: number, pendingOperationId: number) {
  return buildWhatsappClosedDecisionReply({
    bodyText: "Escolha",
    pendingOperationId,
    actions: [
      ...actions(candidateCount),
      { id: "cancel", label: "Cancelar", effect: "cancel" },
    ],
  });
}

describe("regra central de apresentação de decisões fechadas", () => {
  it("mantém perguntas abertas em texto", () => {
    expect(selectWhatsappInteractionComponent("open", 0)).toBe("text");
    expect(selectWhatsappInteractionComponent("open", 4)).toBe("text");
  });

  it("usa botões até três ações e lista a partir de quatro", () => {
    expect(selectWhatsappInteractionComponent("closed", 1)).toBe("buttons");
    expect(selectWhatsappInteractionComponent("closed", 2)).toBe("buttons");
    expect(selectWhatsappInteractionComponent("closed", 3)).toBe("buttons");
    expect(selectWhatsappInteractionComponent("closed", 4)).toBe("list");
    expect(selectWhatsappInteractionComponent("closed", 8)).toBe("list");
  });

  it("um candidato mais Cancelar produz dois botões", () => {
    const message = buildCandidateReply(1, 9).messages[0];
    expect(message.type).toBe("buttons");
    if (message.type !== "buttons") throw new Error("expected buttons");
    expect(message.buttons).toHaveLength(2);
  });

  it("dois candidatos mais Cancelar produzem três botões", () => {
    const message = buildCandidateReply(2, 10).messages[0];
    expect(message.type).toBe("buttons");
    if (message.type !== "buttons") throw new Error("expected buttons");
    expect(message.buttons).toHaveLength(3);
  });

  it("três candidatos mais Cancelar produzem lista com quatro linhas", () => {
    const message = buildCandidateReply(3, 11).messages[0];
    expect(message.type).toBe("list");
    if (message.type !== "list") throw new Error("expected list");
    expect(message.sections.flatMap(section => section.rows)).toHaveLength(4);
  });

  it("quatro candidatos mais Cancelar produzem lista com cinco linhas", () => {
    const message = buildCandidateReply(4, 12).messages[0];
    expect(message.type).toBe("list");
    if (message.type !== "list") throw new Error("expected list");
    expect(message.sections.flatMap(section => section.rows)).toHaveLength(5);
  });

  it("mais de quatro candidatos permanece em lista", () => {
    const message = buildCandidateReply(7, 13).messages[0];
    expect(message.type).toBe("list");
    if (message.type !== "list") throw new Error("expected list");
    expect(message.sections.flatMap(section => section.rows)).toHaveLength(8);
  });
});
