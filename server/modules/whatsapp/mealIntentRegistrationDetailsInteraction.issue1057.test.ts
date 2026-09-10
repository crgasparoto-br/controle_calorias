import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MealProcessingResult } from "../../nutritionEngine";
import type { CountableRegistrationContinuation } from "./countableFoodRegistrationGate";

const boundary = vi.hoisted(() => ({
  register: vi.fn(),
}));

vi.mock("../../db", () => ({
  getDb: async () => null,
  logPersistenceWarning: vi.fn(),
}));
vi.mock("./confirmedMealRegistration", () => ({
  executeConfirmedWhatsAppMealRegistration: (...args: unknown[]) =>
    boundary.register(...args),
}));

import { resolvePendingWhatsappFoodClarification } from "./foodClarificationGate";
import {
  createWhatsappMealIntentRegistrationDetailsInteraction,
  classifyMealIntentRegistrationDetailsText,
} from "./mealIntentRegistrationDetailsInteraction";
import { isCompleteWhatsappCommand } from "./foodClarificationContract";
import { createDrizzleWhatsAppPendingOperationRepository } from "../../repositories/whatsappPendingOperationRepository";

const repository = createDrizzleWhatsAppPendingOperationRepository({
  getDb: async () => null,
  onWarning: vi.fn(),
});
const now = new Date("2026-09-09T22:00:00Z");
let userId = 105700;

const originalText =
  "50ml leite integral, 2 fatias de pão de forma panco, 35g de requeijão catupiry, 1 fatia de presunto, 1 fatia de mussarela";

const siblingSnapshot: CountableRegistrationContinuation["resolvedSegments"] = [
  {
    segmentIndex: 0,
    processed: {
      detectedMealLabel: "Lanche",
      sourceText: "50ml leite integral",
      items: [],
    } as unknown as MealProcessingResult,
  },
];

const clarification = {
  originalText: "pão de forma panco",
  foodName: "Pão de forma Panco",
  brand: "Panco",
  clarificationReason: "brand_variant_unresolved",
  alternatives: [
    {
      name: "Pão de forma Panco Premium",
      brand: "Panco",
      productVariant: "premium",
      servingLabel: "2 fatias (50 g)",
      gramsPerServing: 50,
    },
  ],
} as unknown as CountableRegistrationContinuation["clarification"];

beforeEach(() => {
  vi.clearAllMocks();
  userId += 1;
  boundary.register.mockResolvedValue({
    status: "registered",
    result: {
      handled: true,
      action: "meal_registered",
      reply: "Refeição registrada.",
      eventType: "whatsapp.meal_registered",
      detail: "Persistência concluída uma vez.",
      data: {},
    },
  });
});

async function createPending(input?: {
  count?: number;
  receivedAt?: Date;
  brand?: string;
}) {
  const count = input?.count ?? 2;
  const brand = input?.brand ?? "Panco";
  const registrationSegments = [
    "50 ml de leite integral",
    `${count} fatias de pão de forma ${brand}`,
    "35 g de requeijão catupiry",
    "1 fatia de presunto",
    "1 fatia de mussarela",
  ];
  await createWhatsappMealIntentRegistrationDetailsInteraction({
    userId,
    originalText,
    registrationText: registrationSegments.join("\n"),
    inboundMessageId: `wamid-1057-${userId}`,
    prompt: `Qual variante de pão de forma ${brand} você quis registrar?`,
    receivedAt: input?.receivedAt ?? now,
    countableContext: {
      registrationSegments,
      itemIndex: 1,
      resolvedSegments: siblingSnapshot,
      occurredAt: now.toISOString(),
      userTimezone: "America/Sao_Paulo",
      clarification: {
        ...clarification,
        brand,
        foodName: `Pão de forma ${brand}`,
      },
    },
  });
  const pending = await repository.getActivePendingOperation(
    userId,
    input?.receivedAt ?? now,
  );
  if (!pending) throw new Error("Pending registration details was not created");
  return pending;
}

function latestRegistrationInput() {
  const [input] = boundary.register.mock.calls.at(-1) ?? [];
  return input as {
    registrationText: string;
    resolvedSegments: CountableRegistrationContinuation["resolvedSegments"];
    inboundMessageId: string | null;
  };
}

describe("#1057 — retomada de identidade preserva quantidade e unidade", () => {
  it("prioriza a pendência no gate real para a resposta completa do caso de produção", async () => {
    const pending = await createPending();
    expect(isCompleteWhatsappCommand("Pão de forma Panco Premium")).toBe(true);
    expect(
      classifyMealIntentRegistrationDetailsText(
        pending.target,
        "Pão de forma Panco Premium",
      ),
    ).toBe("resolve");

    const result = await resolvePendingWhatsappFoodClarification({
      userId,
      text: "Pão de forma Panco Premium",
      receivedAt: new Date(now.getTime() + 1_000),
      userTimezone: "America/Sao_Paulo",
      messageId: "reply-1057-full",
    });

    expect(result?.action).toBe("meal_registered");
    expect(boundary.register).toHaveBeenCalledOnce();
    expect(latestRegistrationInput()).toMatchObject({
      registrationText: [
        "50 ml de leite integral",
        "2 fatias de pão de forma Panco Premium",
        "35 g de requeijão catupiry",
        "1 fatia de presunto",
        "1 fatia de mussarela",
      ].join("\n"),
      resolvedSegments: siblingSnapshot,
      inboundMessageId: `wamid-1057-${userId}`,
    });
    expect(latestRegistrationInput().registrationText).not.toContain(
      "Panco Pão de forma Panco",
    );
    expect((await repository.getLatestPendingOperation(userId))?.state).toBe(
      "consumed",
    );
  });

  it("mantém equivalência semântica entre resposta curta e resposta completa", async () => {
    await createPending();
    await resolvePendingWhatsappFoodClarification({
      userId,
      text: "Premium",
      receivedAt: new Date(now.getTime() + 1_000),
      userTimezone: "America/Sao_Paulo",
    });
    expect(latestRegistrationInput().registrationText).toContain(
      "2 fatias de pão de forma Panco Premium",
    );

    userId += 1;
    await createPending({ count: 3 });
    await resolvePendingWhatsappFoodClarification({
      userId,
      text: "Pão de forma Panco Premium",
      receivedAt: new Date(now.getTime() + 1_000),
      userTimezone: "America/Sao_Paulo",
    });
    expect(latestRegistrationInput().registrationText).toContain(
      "3 fatias de pão de forma Panco Premium",
    );
  });

  it("é genérico para outra marca e não depende de Panco", async () => {
    await createPending({ brand: "Wickbold" });
    await resolvePendingWhatsappFoodClarification({
      userId,
      text: "Pão de forma Wickbold Integral",
      receivedAt: new Date(now.getTime() + 1_000),
      userTimezone: "America/Sao_Paulo",
    });
    expect(latestRegistrationInput().registrationText).toContain(
      "2 fatias de pão de forma Wickbold Integral",
    );
  });

  it("mantém a pendência quando a resposta tenta trocar quantidade durante a clarificação de identidade", async () => {
    const pending = await createPending();
    const result = await resolvePendingWhatsappFoodClarification({
      userId,
      text: "3 fatias de pão de forma Panco Premium",
      receivedAt: new Date(now.getTime() + 1_000),
      userTimezone: "America/Sao_Paulo",
    });

    expect(result).toMatchObject({
      action: "clarification_needed",
      eventType: "whatsapp.meal_intent_decision.invalid_identity_details",
    });
    expect(boundary.register).not.toHaveBeenCalled();
    expect((await repository.getActivePendingOperation(userId, now))?.id).toBe(
      pending.id,
    );
  });

  it("continua permitindo que um comando completo realmente incompatível substitua a pendência", async () => {
    await createPending();
    const result = await resolvePendingWhatsappFoodClarification({
      userId,
      text: "registrar 100 g de banana",
      receivedAt: new Date(now.getTime() + 1_000),
      userTimezone: "America/Sao_Paulo",
    });

    expect(result).toBeNull();
    expect(boundary.register).not.toHaveBeenCalled();
    expect((await repository.getLatestPendingOperation(userId))?.state).toBe(
      "superseded",
    );
  });

  it.each([
    "100 g de banana",
    "250 ml de leite integral",
    "1 unidade de maçã",
  ])(
    "prioriza novo comando alimentar incompatível sem verbo operacional: %s",
    async (text) => {
      const pending = await createPending();
      expect(isCompleteWhatsappCommand(text)).toBe(true);
      expect(
        classifyMealIntentRegistrationDetailsText(pending.target, text),
      ).toBe("invalid");

      const result = await resolvePendingWhatsappFoodClarification({
        userId,
        text,
        receivedAt: new Date(now.getTime() + 1_000),
        userTimezone: "America/Sao_Paulo",
      });

      expect(result).toBeNull();
      expect(boundary.register).not.toHaveBeenCalled();
      expect((await repository.getLatestPendingOperation(userId))?.state).toBe(
        "superseded",
      );
    },
  );

  it("bloqueia resposta curta ou completa quando a pendência expirou, sem fallback nutricional", async () => {
    await createPending();
    const afterTtl = new Date(now.getTime() + 11 * 60 * 1_000);

    const full = await resolvePendingWhatsappFoodClarification({
      userId,
      text: "Pão de forma Panco Premium",
      receivedAt: afterTtl,
      userTimezone: "America/Sao_Paulo",
    });
    expect(full).toMatchObject({
      action: "clarification_needed",
      eventType:
        "whatsapp.meal_intent_decision.registration_details_unavailable",
      data: {
        fallbackBlocked: true,
        fallbackBlockReason: "stale_meal_intent_registration_details",
      },
    });
    expect(boundary.register).not.toHaveBeenCalled();

    userId += 1;
    await createPending();
    const short = await resolvePendingWhatsappFoodClarification({
      userId,
      text: "Premium",
      receivedAt: afterTtl,
      userTimezone: "America/Sao_Paulo",
    });
    expect(short?.eventType).toBe(
      "whatsapp.meal_intent_decision.registration_details_unavailable",
    );
    expect(boundary.register).not.toHaveBeenCalled();
  });

  it("consome no máximo uma vez e não permite outro usuário usar a continuação", async () => {
    await createPending();
    const first = await resolvePendingWhatsappFoodClarification({
      userId,
      text: "Premium",
      receivedAt: new Date(now.getTime() + 1_000),
      userTimezone: "America/Sao_Paulo",
      messageId: "same-inbound-1057",
    });
    const retry = await resolvePendingWhatsappFoodClarification({
      userId,
      text: "Premium",
      receivedAt: new Date(now.getTime() + 2_000),
      userTimezone: "America/Sao_Paulo",
      messageId: "same-inbound-1057",
    });

    expect(first?.action).toBe("meal_registered");
    expect(retry?.eventType).toBe(
      "whatsapp.meal_intent_decision.registration_details_unavailable",
    );
    expect(boundary.register).toHaveBeenCalledOnce();

    userId += 1;
    await createPending();
    const otherUser = await resolvePendingWhatsappFoodClarification({
      userId: userId + 99_000,
      text: "Premium",
      receivedAt: new Date(now.getTime() + 1_000),
      userTimezone: "America/Sao_Paulo",
    });
    expect(otherUser).toBeNull();
    expect((await repository.getActivePendingOperation(userId, now))?.userId).toBe(
      userId,
    );
  });
});
