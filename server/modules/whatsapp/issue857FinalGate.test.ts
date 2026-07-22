import { describe, expect, it } from "vitest";
import { WHATSAPP_INTERACTION_REGISTRY } from "./interactionRegistry";
import { selectWhatsappInteractionComponent } from "./interactionPresentation";
import { buildWhatsAppOutboundFallbackText, type WhatsAppOutboundMessage } from "./replyContract";
import { buildWhatsAppFoodLines } from "./replyTemplates";

const REMOVED_ESTIMATION_WARNING = "⚠️ Valores nutricionais estimados pela IA.";

describe("issue #857 final interaction gate", () => {
  it("valida diretamente todos os registros do inventário canônico", () => {
    const ids = WHATSAPP_INTERACTION_REGISTRY.map(interaction => interaction.id);

    expect(WHATSAPP_INTERACTION_REGISTRY.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);

    for (const interaction of WHATSAPP_INTERACTION_REGISTRY) {
      expect(interaction.id.trim()).not.toBe("");
      expect(interaction.pendingType.trim()).not.toBe("");
      expect(interaction.origin.trim()).not.toBe("");
      expect(interaction.entrypoints.length).toBeGreaterThan(0);
      expect(interaction.allowedEffects.length).toBeGreaterThan(0);
      expect(interaction.forbiddenEffects.length).toBeGreaterThan(0);
      expect(interaction.staleBehavior).toBe("reply_unavailable_request_new_command");
      expect(typeof interaction.matches).toBe("function");
      expect(typeof interaction.actions).toBe("function");
      expect(typeof interaction.resolveText).toBe("function");
      expect(typeof interaction.rebuild).toBe("function");
      expect(typeof interaction.completeCallback).toBe("function");
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

  it("bloqueia regressão do aviso visual sem remover os dados nutricionais estimados", () => {
    const lines = buildWhatsAppFoodLines({
      foodName: "Alimento estimado",
      canonicalName: "alimento estimado",
      portionText: "1 porção",
      estimatedGrams: 100,
      calories: 120,
      protein: 4,
      carbs: 20,
      fat: 3,
      source: "heuristic",
    });

    expect(lines.join("\n")).toContain("Alimento estimado");
    expect(lines.join("\n")).toContain("120 kcal");
    expect(lines.join("\n")).not.toContain(REMOVED_ESTIMATION_WARNING);
  });
});
