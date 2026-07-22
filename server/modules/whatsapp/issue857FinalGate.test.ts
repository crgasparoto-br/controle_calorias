import { describe, expect, it } from "vitest";
import { WHATSAPP_INTERACTION_REGISTRY } from "./interactionRegistry";
import { selectWhatsappInteractionComponent } from "./interactionPresentation";
import { buildWhatsAppOutboundFallbackText, type WhatsAppOutboundMessage } from "./replyContract";

const REMOVED_ESTIMATION_WARNING = "⚠️ Valores nutricionais estimados pela IA.";

describe("issue #857 final interaction gate", () => {
  it("mantém identificadores estáveis, entrypoints e efeitos explícitos no inventário único", () => {
    const ids = WHATSAPP_INTERACTION_REGISTRY.map(interaction => interaction.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining([
      "delete.confirmation",
      "delete.candidate_selection",
      "meal_item.candidate_selection",
      "generic_confirmation.confirm_cancel",
      "generic_confirmation.reclassify_scope",
      "period_report.period_selection",
      "professional_access.authorization",
      "intent_clarification.generic",
      "food_clarification.quantity",
      "food_clarification.confirmation",
      "food_clarification.selection",
    ]));

    for (const interaction of WHATSAPP_INTERACTION_REGISTRY) {
      expect(interaction.entrypoints.length).toBeGreaterThan(0);
      expect(interaction.allowedEffects.length).toBeGreaterThan(0);
      expect(interaction.forbiddenEffects.length).toBeGreaterThan(0);
      expect(interaction.staleBehavior).toBe("reply_unavailable_request_new_command");
    }
  });

  it("aplica texto para perguntas abertas, botões até três ações e lista a partir de quatro", () => {
    expect(selectWhatsappInteractionComponent("open", 0)).toBe("text");
    expect(selectWhatsappInteractionComponent("open", 5)).toBe("text");
    expect(selectWhatsappInteractionComponent("closed", 1)).toBe("buttons");
    expect(selectWhatsappInteractionComponent("closed", 2)).toBe("buttons");
    expect(selectWhatsappInteractionComponent("closed", 3)).toBe("buttons");
    expect(selectWhatsappInteractionComponent("closed", 4)).toBe("list");
    expect(selectWhatsappInteractionComponent("closed", 8)).toBe("list");
  });

  it("exige reapresentação para toda decisão fechada e mantém perguntas abertas textuais", () => {
    for (const interaction of WHATSAPP_INTERACTION_REGISTRY) {
      if (interaction.classification === "closed") {
        expect(interaction.invalidResponse).toBe("represent_same_actions");
      } else {
        expect(interaction.invalidResponse).toBe("text_guidance");
      }
    }
  });

  it("deriva fallbacks utilizáveis sem expor IDs opacos", () => {
    const messages: WhatsAppOutboundMessage[] = [
      {
        type: "buttons",
        bodyText: "Confirme a exclusão",
        buttons: [
          { id: "wa:pending:123:confirm", title: "Confirmar" },
          { id: "wa:pending:123:cancel", title: "Cancelar" },
        ],
      },
      {
        type: "list",
        bodyText: "Escolha uma opção",
        buttonText: "Ver opções",
        sections: [{ rows: [
          { id: "wa:pending:456:first", title: "Arroz", description: "Almoço" },
          { id: "wa:pending:456:cancel", title: "Cancelar" },
        ] }],
      },
      {
        type: "cta_url",
        bodyText: "Precisa ajustar algum alimento?",
        buttonText: "Editar refeição",
        url: "https://app.test/quick-edit/token",
      },
    ];

    for (const message of messages) {
      const fallback = buildWhatsAppOutboundFallbackText(message);
      expect(fallback).toBeTruthy();
      expect(fallback).not.toContain("wa:pending:");
    }
  });

  it("mantém o aviso visual removido como comportamento proibido", () => {
    expect(REMOVED_ESTIMATION_WARNING).toBe("⚠️ Valores nutricionais estimados pela IA.");
  });
});
