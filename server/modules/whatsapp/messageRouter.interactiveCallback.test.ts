import { beforeEach, describe, expect, it, vi } from "vitest";

const listMealsMock = vi.hoisted(() => vi.fn());
const removeMealMock = vi.hoisted(() => vi.fn());
const updateMealMock = vi.hoisted(() => vi.fn());

vi.mock("../meals/service", () => ({
  listMeals: listMealsMock,
  removeMeal: removeMealMock,
  updateMeal: updateMealMock,
}));

const { resolveWhatsAppPrecedenceGate } = await import("./messageRouter");
const { executeWhatsappDeleteIntent } = await import("./deleteIntent");
const { buildWhatsAppCallbackId } = await import("./interactiveCallback");
const { upsertUserWhatsappConnection } = await import("../../db");
const professionalsService = await import("../professionals/service");

type ButtonsMessage = { type: "buttons"; buttons: Array<{ id: string; title: string }> };
type ListMessage = { type: "list"; sections: Array<{ rows: Array<{ id: string; title: string }> }> };

function extractButtonId(interactiveReply: unknown, title: string) {
  const message = (interactiveReply as { messages: ButtonsMessage[] }).messages[0];
  const button = message.buttons.find(candidate => candidate.title === title);
  if (!button) throw new Error(`botão "${title}" não encontrado na resposta interativa`);
  return button.id;
}

function extractListRowId(interactiveReply: unknown, titleContains: string) {
  // Regra central de componente (issue #858): até 3 ações usam botões; 4+ usam lista.
  const message = (interactiveReply as { messages: Array<ButtonsMessage | ListMessage> }).messages[0];
  const options = message.type === "buttons"
    ? message.buttons
    : message.sections.flatMap(section => section.rows);
  const option = options.find(candidate => candidate.title.includes(titleContains));
  if (!option) throw new Error(`opção contendo "${titleContains}" não encontrada na resposta interativa`);
  return option.id;
}

function baseMeal() {
  return {
    id: 501,
    userId: 43,
    mealLabel: "Jantar",
    occurredAt: "2026-06-23T22:00:00.000Z",
    source: "whatsapp",
    items: [
      { foodName: "Chocolate ao leite", portionText: "1 unidade" },
      { foodName: "Chocolate amargo", portionText: "1 unidade" },
    ],
  };
}

describe("messageRouter — resolução central de callbacks interativos (issue #782)", () => {
  beforeEach(() => {
    listMealsMock.mockReset();
    removeMealMock.mockReset();
    updateMealMock.mockReset();
  });

  it("exclusão de refeição: confirma por botão, executa uma única vez e reentrega/clique duplo retorna indisponível", async () => {
    const userId = 61_001;
    listMealsMock.mockResolvedValue([{ ...baseMeal(), userId }]);
    removeMealMock.mockResolvedValue(undefined);

    const detection = await executeWhatsappDeleteIntent(userId, { text: "excluir refeição" });
    expect(detection?.interactiveReply).toBeTruthy();
    const confirmId = extractButtonId(detection!.interactiveReply, "Confirmar");

    const first = await resolveWhatsAppPrecedenceGate({ userId, interactiveReplyId: confirmId });
    expect(first.step).toBe("interactive_callback");
    if (first.step !== "interactive_callback") throw new Error("unreachable");
    expect(first.result.eventType).toBe("whatsapp.intent.meal_deleted");
    expect(removeMealMock).toHaveBeenCalledTimes(1);

    const second = await resolveWhatsAppPrecedenceGate({ userId, interactiveReplyId: confirmId });
    expect(second.step).toBe("interactive_callback");
    if (second.step !== "interactive_callback") throw new Error("unreachable");
    expect(second.result.eventType).toBe("whatsapp.interactive_callback.unavailable");
    expect(removeMealMock).toHaveBeenCalledTimes(1);
  });

  it("exclusão de refeição: cancelar por botão não altera o domínio", async () => {
    const userId = 61_002;
    listMealsMock.mockResolvedValue([{ ...baseMeal(), userId }]);

    const detection = await executeWhatsappDeleteIntent(userId, { text: "excluir refeição" });
    const cancelId = extractButtonId(detection!.interactiveReply, "Cancelar");

    const result = await resolveWhatsAppPrecedenceGate({ userId, interactiveReplyId: cancelId });
    expect(result.step).toBe("interactive_callback");
    if (result.step !== "interactive_callback") throw new Error("unreachable");
    expect(result.result.eventType).toBe("whatsapp.intent.delete_cancelled");
    expect(removeMealMock).not.toHaveBeenCalled();
    expect(updateMealMock).not.toHaveBeenCalled();
  });

  it("isolamento entre usuários: callback de exclusão de um usuário não pode ser resolvido por outro", async () => {
    const owner = 61_003;
    const attacker = 61_004;
    listMealsMock.mockResolvedValue([{ ...baseMeal(), userId: owner }]);

    const detection = await executeWhatsappDeleteIntent(owner, { text: "excluir refeição" });
    const confirmId = extractButtonId(detection!.interactiveReply, "Confirmar");

    const attackerAttempt = await resolveWhatsAppPrecedenceGate({ userId: attacker, interactiveReplyId: confirmId });
    if (attackerAttempt.step !== "interactive_callback") throw new Error("unreachable");
    expect(attackerAttempt.result.eventType).toBe("whatsapp.interactive_callback.unavailable");
    expect(removeMealMock).not.toHaveBeenCalled();

    const ownerAttempt = await resolveWhatsAppPrecedenceGate({ userId: owner, interactiveReplyId: confirmId });
    if (ownerAttempt.step !== "interactive_callback") throw new Error("unreachable");
    expect(ownerAttempt.result.eventType).toBe("whatsapp.intent.meal_deleted");
    expect(removeMealMock).toHaveBeenCalledTimes(1);
  });

  it("seleção ambígua por lista: escolher uma opção avança para confirmação por botões, não executa a exclusão direto", async () => {
    const userId = 61_005;
    const meal = { ...baseMeal(), userId };
    listMealsMock.mockResolvedValue([meal]);
    updateMealMock.mockResolvedValue({ ...meal, items: [meal.items[0]] });

    const detection = await executeWhatsappDeleteIntent(userId, { text: "excluir chocolate" });
    expect(detection?.action).toBe("clarification_needed");
    const selectSecondId = extractListRowId(detection!.interactiveReply, "Chocolate amargo");

    const selectionResult = await resolveWhatsAppPrecedenceGate({ userId, interactiveReplyId: selectSecondId });
    if (selectionResult.step !== "interactive_callback") throw new Error("unreachable");
    expect(selectionResult.result.eventType).toBe("whatsapp.intent.delete_food_confirmation_requested");
    expect(removeMealMock).not.toHaveBeenCalled();
    expect(updateMealMock).not.toHaveBeenCalled();

    const confirmId = extractButtonId(selectionResult.result.interactiveReply, "Confirmar");
    const confirmResult = await resolveWhatsAppPrecedenceGate({ userId, interactiveReplyId: confirmId });
    if (confirmResult.step !== "interactive_callback") throw new Error("unreachable");
    expect(confirmResult.result.eventType).toBe("whatsapp.intent.meal_item_deleted");
    expect(updateMealMock).toHaveBeenCalledTimes(1);
    expect(updateMealMock.mock.calls[0][1].items.map((item: { foodName: string }) => item.foodName)).toEqual(["Chocolate ao leite"]);
  });

  it("ação incompatível com o alvo persistido (confirm sobre uma pendência de seleção) retorna registro não encontrado", async () => {
    const userId = 61_006;
    listMealsMock.mockResolvedValue([{ ...baseMeal(), userId }]);

    const detection = await executeWhatsappDeleteIntent(userId, { text: "excluir chocolate" });
    const selectionButtonId = extractListRowId(detection!.interactiveReply, "Chocolate amargo");

    // Reaproveita o mesmo pendingOperationId da seleção, mas com a ação "confirm" (que só é válida para uma pendência de exclusão direta, não de seleção).
    const parsed = (await import("./interactiveCallback")).parseWhatsAppCallbackId(selectionButtonId);
    const forgedConfirmId = buildWhatsAppCallbackId(parsed!.pendingOperationId, "confirm");

    const result = await resolveWhatsAppPrecedenceGate({ userId, interactiveReplyId: forgedConfirmId });
    if (result.step !== "interactive_callback") throw new Error("unreachable");
    expect(result.result.eventType).toBe("whatsapp.intent.delete_callback_resource_not_found");
    expect(removeMealMock).not.toHaveBeenCalled();
    expect(updateMealMock).not.toHaveBeenCalled();
  });

  it("pendência de tipo sem callback central migrado retorna indisponível de forma sanitizada", async () => {
    const result = await resolveWhatsAppPrecedenceGate({ userId: 61_007, interactiveReplyId: buildWhatsAppCallbackId(999_999_998, "confirm") });
    if (result.step !== "interactive_callback") throw new Error("unreachable");
    expect(result.result.eventType).toBe("whatsapp.interactive_callback.unavailable");
    expect(result.result.reply).not.toContain("999999998");
  });

  describe("seleção ambígua de item por lista (issue #783)", () => {
    function ambiguousMeal(userId: number) {
      return {
        id: 701,
        userId,
        mealLabel: "Lanche",
        occurredAt: "2026-06-23T18:00:00.000Z",
        notes: null,
        items: [
          { foodName: "Queijo Minas Padrao Fatiado", canonicalName: "Queijo Minas Padrao Fatiado", portionText: "80 g", estimatedGrams: 80, servings: 1, calories: 200, protein: 14, carbs: 1, fat: 16, confidence: 0.9, source: "catalog" },
          { foodName: "Queijo mussarela", canonicalName: "Queijo mussarela", portionText: "70 g", estimatedGrams: 70, servings: 1, calories: 210, protein: 15, carbs: 1, fat: 17, confidence: 0.9, source: "catalog" },
        ],
      };
    }

    it("ajuste de gramas ambíguo: escolher uma opção por lista aplica a mutação sem pedir confirmação extra", async () => {
      const userId = 61_201;
      const meal = ambiguousMeal(userId);
      listMealsMock.mockResolvedValue([meal]);
      updateMealMock.mockResolvedValue({ ...meal, items: [{ ...meal.items[0], estimatedGrams: 60, portionText: "60 g" }, meal.items[1]] });

      const { executeWhatsappGramsAdjustmentIntent } = await import("./gramsAdjustmentIntent");
      const detection = await executeWhatsappGramsAdjustmentIntent(userId, { text: "Diminuir 20g do queijo", receivedAt: new Date("2026-06-23T18:30:00.000Z") });
      expect(detection?.action).toBe("clarification_needed");
      const selectFirstId = extractListRowId(detection!.interactiveReply, "Queijo Minas");

      const result = await resolveWhatsAppPrecedenceGate({ userId, interactiveReplyId: selectFirstId });
      if (result.step !== "interactive_callback") throw new Error("unreachable");
      expect(result.result.eventType).toBe("whatsapp.intent.meal_item_grams_adjusted");
      expect(updateMealMock).toHaveBeenCalledTimes(1);
      expect(updateMealMock.mock.calls[0][1].items[0]).toEqual(expect.objectContaining({ foodName: "Queijo Minas Padrao Fatiado", estimatedGrams: 60 }));
    });

    it("substituição ambígua: cancelar por lista não altera a refeição", async () => {
      const userId = 61_202;
      const jantar = { id: 702, userId, mealLabel: "Jantar", occurredAt: "2026-06-23T18:10:00.000Z", notes: null, items: [{ foodName: "Queijo prato", canonicalName: "Queijo prato", portionText: "50 g", estimatedGrams: 50, servings: 1, calories: 150, protein: 10, carbs: 1, fat: 12, confidence: 0.9, source: "catalog" as const }] };
      const lanche = { id: 703, userId, mealLabel: "Lanche", occurredAt: "2026-06-23T18:00:00.000Z", notes: null, items: [{ foodName: "Queijo mussarela", canonicalName: "Queijo mussarela", portionText: "70 g", estimatedGrams: 70, servings: 1, calories: 210, protein: 15, carbs: 1, fat: 17, confidence: 0.9, source: "catalog" as const }] };
      listMealsMock.mockResolvedValue([jantar, lanche]);

      const { executeWhatsappContextualFoodReplacementIntent } = await import("./contextualFoodReplacementIntent");
      const detection = await executeWhatsappContextualFoodReplacementIntent(userId, { text: "não é queijo, é ricota", receivedAt: new Date("2026-06-23T18:30:00.000Z") });
      expect(detection?.action).toBe("clarification_needed");
      const cancelId = extractListRowId(detection!.interactiveReply, "Cancelar");

      const result = await resolveWhatsAppPrecedenceGate({ userId, interactiveReplyId: cancelId });
      if (result.step !== "interactive_callback") throw new Error("unreachable");
      expect(result.result.eventType).toBe("whatsapp.intent.meal_item_selection_cancelled");
      expect(updateMealMock).not.toHaveBeenCalled();
    });

    it("reentrega/clique duplo na mesma seleção só aplica a mutação uma vez", async () => {
      const userId = 61_203;
      const meal = ambiguousMeal(userId);
      listMealsMock.mockResolvedValue([meal]);
      updateMealMock.mockResolvedValue({ ...meal, items: [{ ...meal.items[0], estimatedGrams: 60, portionText: "60 g" }, meal.items[1]] });

      const { executeWhatsappGramsAdjustmentIntent } = await import("./gramsAdjustmentIntent");
      const detection = await executeWhatsappGramsAdjustmentIntent(userId, { text: "Diminuir 20g do queijo", receivedAt: new Date("2026-06-23T18:30:00.000Z") });
      const selectFirstId = extractListRowId(detection!.interactiveReply, "Queijo Minas");

      const first = await resolveWhatsAppPrecedenceGate({ userId, interactiveReplyId: selectFirstId });
      if (first.step !== "interactive_callback") throw new Error("unreachable");
      expect(first.result.eventType).toBe("whatsapp.intent.meal_item_grams_adjusted");

      const second = await resolveWhatsAppPrecedenceGate({ userId, interactiveReplyId: selectFirstId });
      if (second.step !== "interactive_callback") throw new Error("unreachable");
      expect(second.result.eventType).toBe("whatsapp.interactive_callback.unavailable");
      expect(updateMealMock).toHaveBeenCalledTimes(1);
    });

    it("isolamento entre usuários: seleção de um usuário não pode ser resolvida por outro", async () => {
      const owner = 61_204;
      const attacker = 61_205;
      const meal = ambiguousMeal(owner);
      listMealsMock.mockResolvedValue([meal]);
      updateMealMock.mockResolvedValue({ ...meal, items: [{ ...meal.items[0], estimatedGrams: 60, portionText: "60 g" }, meal.items[1]] });

      const { executeWhatsappGramsAdjustmentIntent } = await import("./gramsAdjustmentIntent");
      const detection = await executeWhatsappGramsAdjustmentIntent(owner, { text: "Diminuir 20g do queijo", receivedAt: new Date("2026-06-23T18:30:00.000Z") });
      const selectFirstId = extractListRowId(detection!.interactiveReply, "Queijo Minas");

      const attackerAttempt = await resolveWhatsAppPrecedenceGate({ userId: attacker, interactiveReplyId: selectFirstId });
      if (attackerAttempt.step !== "interactive_callback") throw new Error("unreachable");
      expect(attackerAttempt.result.eventType).toBe("whatsapp.interactive_callback.unavailable");
      expect(updateMealMock).not.toHaveBeenCalled();
    });
  });

  describe("autorização profissional por botões", () => {
    beforeEach(() => {
      global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({}) } as Response)) as typeof fetch;
      process.env.WHATSAPP_ACCESS_TOKEN = "access-token-test";
      process.env.WHATSAPP_PHONE_NUMBER = "5511000000000";
      process.env.WHATSAPP_PHONE_NUMBER_ID = "phone-number-test";
    });

    it("autorizar por botão aplica a decisão uma única vez; repetir o clique não muda a decisão consumida", async () => {
      const professionalUserId = 61_101;
      const patientUserId = 61_102;
      await professionalsService.upsertProfessionalProfile(professionalUserId, { displayName: "Dra. Teste", active: true });
      await upsertUserWhatsappConnection({ userId: patientUserId, phoneNumber: "5511610000102", displayName: "Paciente Teste" });

      const sentPayloads: any[] = [];
      global.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        sentPayloads.push(init?.body ? JSON.parse(String(init.body)) : {});
        return { ok: true, json: async () => ({}) } as Response;
      }) as typeof fetch;

      const access = await professionalsService.requestPatientAccess(professionalUserId, {
        patientContact: `user-${patientUserId}@example.com`,
        reason: "Acompanhamento de teste",
      });
      expect(access.authorizationMessage?.status).toBe("sent");

      const buttonPayload = sentPayloads.find(payload => payload.type === "interactive");
      const authorizeId = buttonPayload.interactive.action.buttons.find((button: { reply: { title: string } }) => button.reply.title === "Autorizar").reply.id;

      const first = await resolveWhatsAppPrecedenceGate({ userId: patientUserId, interactiveReplyId: authorizeId });
      if (first.step !== "interactive_callback") throw new Error("unreachable");
      expect(first.result.eventType).toBe("professional.access.whatsapp_approved");

      const listedAfterFirst = await professionalsService.listProfessionalAccesses(professionalUserId);
      expect(listedAfterFirst.find(item => item.id === access.id)?.status).toBe("approved");

      const second = await resolveWhatsAppPrecedenceGate({ userId: patientUserId, interactiveReplyId: authorizeId });
      if (second.step !== "interactive_callback") throw new Error("unreachable");
      expect(second.result.eventType).toBe("whatsapp.interactive_callback.unavailable");

      const listedAfterSecond = await professionalsService.listProfessionalAccesses(professionalUserId);
      expect(listedAfterSecond.find(item => item.id === access.id)?.status).toBe("approved");
    });

    it("recusar por botão marca a solicitação como recusada e não vincula o profissional", async () => {
      const professionalUserId = 61_103;
      const patientUserId = 61_104;
      await professionalsService.upsertProfessionalProfile(professionalUserId, { displayName: "Dr. Recusa", active: true });
      await upsertUserWhatsappConnection({ userId: patientUserId, phoneNumber: "5511610000104", displayName: "Paciente Recusa" });

      const sentPayloads: any[] = [];
      global.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        sentPayloads.push(init?.body ? JSON.parse(String(init.body)) : {});
        return { ok: true, json: async () => ({}) } as Response;
      }) as typeof fetch;

      const access = await professionalsService.requestPatientAccess(professionalUserId, {
        patientContact: `user-${patientUserId}@example.com`,
        reason: "Acompanhamento de teste",
      });
      const buttonPayload = sentPayloads.find(payload => payload.type === "interactive");
      const rejectId = buttonPayload.interactive.action.buttons.find((button: { reply: { title: string } }) => button.reply.title === "Recusar").reply.id;

      const result = await resolveWhatsAppPrecedenceGate({ userId: patientUserId, interactiveReplyId: rejectId });
      if (result.step !== "interactive_callback") throw new Error("unreachable");
      expect(result.result.eventType).toBe("professional.access.whatsapp_rejected");

      const listed = await professionalsService.listProfessionalAccesses(professionalUserId);
      expect(listed.find(item => item.id === access.id)?.status).toBe("rejected");
    });
  });
});
