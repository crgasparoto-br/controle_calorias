import { describe, expect, it } from "vitest";
import {
  buildWhatsappClosedDecisionReply,
  listWhatsappInventoryPendingTypes,
  selectWhatsappClosedDecisionComponent,
  WHATSAPP_INTERACTION_INVENTORY,
  WHATSAPP_INTERACTION_INVENTORY_VERSION,
  WHATSAPP_MAX_BUTTON_ACTIONS,
} from "./interactionInventory";
import {
  isExpectedWhatsAppCallbackAction,
  WHATSAPP_REGISTERED_PENDING_TYPES,
} from "./messageRouter";

describe("inventário transversal de interações (issue #858)", () => {
  it("possui versão explícita", () => {
    expect(WHATSAPP_INTERACTION_INVENTORY_VERSION).toBeGreaterThanOrEqual(1);
  });

  it("todo tipo de pendência registrado no gate central possui entrada no inventário", () => {
    const inventoryTypes = listWhatsappInventoryPendingTypes();
    for (const type of WHATSAPP_REGISTERED_PENDING_TYPES) {
      expect(inventoryTypes, `tipo de pendência "${type}" registrado no gate sem entrada no inventário`).toContain(type);
    }
  });

  it("todo tipo do inventário fechado está registrado no gate central (sem envio interativo paralelo)", () => {
    for (const type of listWhatsappInventoryPendingTypes()) {
      expect(WHATSAPP_REGISTERED_PENDING_TYPES as readonly string[], `tipo "${type}" inventariado mas não resolvível pelo gate`).toContain(type);
    }
  });

  it("entradas possuem identificador estável único e campos obrigatórios", () => {
    const ids = WHATSAPP_INTERACTION_INVENTORY.map(entry => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of WHATSAPP_INTERACTION_INVENTORY) {
      expect(entry.origin).toBeTruthy();
      expect(entry.entrypoints.length).toBeGreaterThan(0);
      expect(["open", "closed"]).toContain(entry.classification);
      expect(entry.textFallbackRule).toBeTruthy();
      expect(entry.reconstruction).toBeTruthy();
      expect(entry.invalidResponse).toBeTruthy();
      expect(entry.staleBehavior).toBe("reply_unavailable_request_new_command");
    }
  });

  it("toda decisão fechada tem pendência, ações e proíbe fallback nutricional", () => {
    for (const entry of WHATSAPP_INTERACTION_INVENTORY.filter(candidate => candidate.classification === "closed")) {
      expect(entry.pendingType, `decisão fechada ${entry.id} sem tipo de pendência`).toBeTruthy();
      expect(entry.actions.length, `decisão fechada ${entry.id} sem ações canônicas`).toBeGreaterThan(0);
      expect(entry.expectedComponent).not.toBe("text");
      expect(entry.forbiddenEffects).toContain("nutrition_fallback");
    }
  });

  it("perguntas abertas permanecem textuais e sem componente interativo", () => {
    for (const entry of WHATSAPP_INTERACTION_INVENTORY.filter(candidate => candidate.classification === "open")) {
      expect(entry.expectedComponent).toBe("text");
      expect(entry.pendingType).toBeNull();
    }
  });

  it("componente estático é consistente com a contagem de ações (inclui Cancelar)", () => {
    for (const entry of WHATSAPP_INTERACTION_INVENTORY.filter(candidate => candidate.classification === "closed" && !candidate.hasDynamicCandidates)) {
      const expected = selectWhatsappClosedDecisionComponent(entry.actions.length);
      expect(entry.expectedComponent, `entrada ${entry.id} com ${entry.actions.length} ações deveria usar ${expected}`).toBe(expected);
    }
  });

  it("toda ação canônica do inventário é aceita pelo gate central de callbacks", () => {
    for (const entry of WHATSAPP_INTERACTION_INVENTORY.filter(candidate => candidate.pendingType)) {
      for (const action of entry.actions) {
        const concrete = action.id.replace(":N", ":0");
        expect(
          isExpectedWhatsAppCallbackAction(entry.pendingType as string, concrete),
          `ação ${action.id} da entrada ${entry.id} rejeitada pelo gate para o tipo ${entry.pendingType}`,
        ).toBe(true);
      }
    }
  });
});

describe("regra central de componente (épica #857)", () => {
  it("até três ações (incluindo Cancelar) usam botões; quatro ou mais usam lista", () => {
    expect(selectWhatsappClosedDecisionComponent(1)).toBe("buttons");
    expect(selectWhatsappClosedDecisionComponent(2)).toBe("buttons");
    expect(selectWhatsappClosedDecisionComponent(WHATSAPP_MAX_BUTTON_ACTIONS)).toBe("buttons");
    expect(selectWhatsappClosedDecisionComponent(4)).toBe("list");
    expect(selectWhatsappClosedDecisionComponent(7)).toBe("list");
  });

  it("confirmar + cancelar produz dois botões", () => {
    const reply = buildWhatsappClosedDecisionReply({
      bodyText: "Confirma?",
      pendingOperationId: 10,
      actions: [
        { action: "confirm", label: "Confirmar" },
        { action: "cancel", label: "Cancelar" },
      ],
    });
    expect(reply.messages[0]).toMatchObject({ type: "buttons" });
    expect((reply.messages[0] as { buttons: unknown[] }).buttons).toHaveLength(2);
  });

  it("dois candidatos + Cancelar produzem três botões", () => {
    const reply = buildWhatsappClosedDecisionReply({
      bodyText: "Qual?",
      pendingOperationId: 11,
      actions: [
        { action: "select:0", label: "1. Arroz" },
        { action: "select:1", label: "2. Feijão" },
        { action: "cancel", label: "Cancelar" },
      ],
    });
    expect(reply.messages[0]).toMatchObject({ type: "buttons" });
    expect((reply.messages[0] as { buttons: unknown[] }).buttons).toHaveLength(3);
  });

  it("três candidatos + Cancelar produzem lista com quatro linhas", () => {
    const reply = buildWhatsappClosedDecisionReply({
      bodyText: "Qual?",
      pendingOperationId: 12,
      actions: [
        { action: "select:0", label: "1. Arroz" },
        { action: "select:1", label: "2. Feijão" },
        { action: "select:2", label: "3. Ovo" },
        { action: "cancel", label: "Cancelar" },
      ],
    });
    const message = reply.messages[0] as { type: string; sections: Array<{ rows: unknown[] }> };
    expect(message.type).toBe("list");
    expect(message.sections.reduce((total, section) => total + section.rows.length, 0)).toBe(4);
  });

  it("títulos longos são truncados para respeitar limites do provedor", () => {
    const reply = buildWhatsappClosedDecisionReply({
      bodyText: "Confirma?",
      pendingOperationId: 13,
      actions: [
        { action: "confirm", label: "Confirmar uma exclusão muito longa" },
        { action: "cancel", label: "Cancelar" },
      ],
    });
    const buttons = (reply.messages[0] as { buttons: Array<{ title: string }> }).buttons;
    expect(buttons[0].title.length).toBeLessThanOrEqual(20);
  });
});
