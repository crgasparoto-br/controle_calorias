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

  it("dois candidatos mais Cancelar produzem três botões", () => {
    const reply = buildWhatsappClosedDecisionReply({
      bodyText: "Escolha",
      pendingOperationId: 10,
      actions: [
        ...actions(2),
        { id: "cancel", label: "Cancelar", effect: "cancel" },
      ],
    });
    const message = reply.messages[0];
    expect(message.type).toBe("buttons");
    if (message.type !== "buttons") throw new Error("expected buttons");
    expect(message.buttons).toHaveLength(3);
  });

  it("três candidatos mais Cancelar produzem lista com quatro linhas", () => {
    const reply = buildWhatsappClosedDecisionReply({
      bodyText: "Escolha",
      pendingOperationId: 11,
      actions: [
        ...actions(3),
        { id: "cancel", label: "Cancelar", effect: "cancel" },
      ],
    });
    const message = reply.messages[0];
    expect(message.type).toBe("list");
    if (message.type !== "list") throw new Error("expected list");
    expect(message.sections.flatMap(section => section.rows)).toHaveLength(4);
  });
});
