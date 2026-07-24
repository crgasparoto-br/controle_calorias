import { describe, expect, it } from "vitest";
import { buildPendingFoodClarificationTarget } from "./foodClarificationContract";
import {
  findWhatsappRegisteredInteraction,
  WHATSAPP_INTERACTION_REGISTRY_VERSION,
} from "./interactionRegistry";

describe("registro central da clarificação de açúcar", () => {
  it("declara o efeito canônico de concluir registro, adição ou substituição", () => {
    const target = {
      ...buildPendingFoodClarificationTarget({
        request: {
          originalText: "1 xícara de café com açúcar",
          originalCandidate: "Café com açúcar",
          normalizedCandidate: "Café com açúcar",
          normalizationChanged: false,
          count: 1,
        },
        pendingKind: "quantity",
        candidates: [],
        instructionText: "Informe a quantidade de açúcar.",
        messageId: "wamid-registry-sugar",
      }),
      allowedDomainEffect: "complete_pending_food_operation_once" as const,
    };

    const interaction = findWhatsappRegisteredInteraction(
      "food_registration_clarification",
      target,
    );

    expect(WHATSAPP_INTERACTION_REGISTRY_VERSION).toBeGreaterThanOrEqual(7);
    expect(interaction?.id).toBe("food_clarification.quantity");
    expect(interaction?.allowedEffects).toContain(
      "complete_pending_food_operation_once",
    );
  });
});
