import { afterEach, describe, expect, it, vi } from "vitest";
import { createDrizzleProfessionalContentRepository } from "./professionalContentRepository";

afterEach(() => {
  vi.unstubAllEnvs();
});

function createRepository() {
  return createDrizzleProfessionalContentRepository({
    getDb: async () => null,
    onWarning: vi.fn(),
  });
}

function goal(calories = 1800) {
  return {
    defaultGoal: {
      calories,
      proteinGrams: 120,
      carbsGrams: 190,
      fatGrams: 55,
    },
    exceptions: [],
  };
}

describe("professional content persistence fallback", () => {
  it("fails closed instead of using process memory in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const repository = createRepository();

    await expect(
      repository.createComment({
        id: `production-${crypto.randomUUID()}`,
        professionalUserId: 80500,
        patientUserId: 80501,
        comment: "Não deve ser salvo em memória.",
      })
    ).rejects.toThrow("persistência da Área Profissional");
  });

  it("preserves comments across repository instances and isolates pairs", async () => {
    const suffix = crypto.randomUUID();
    const first = createRepository();
    const second = createRepository();

    await first.createComment({
      id: `comment-${suffix}`,
      professionalUserId: 80501,
      patientUserId: 80502,
      comment: "Comentário privado e persistente.",
      createdAt: 1000,
    });
    await first.createComment({
      id: `comment-other-${suffix}`,
      professionalUserId: 80503,
      patientUserId: 80502,
      comment: "Outro profissional.",
      createdAt: 1001,
    });

    await expect(second.listComments(80501, 80502)).resolves.toEqual([
      expect.objectContaining({
        id: `comment-${suffix}`,
        professionalUserId: 80501,
        patientUserId: 80502,
      }),
    ]);
  });

  it("creates entity and history idempotently on retry", async () => {
    const suffix = crypto.randomUUID();
    const repository = createRepository();
    const input = {
      id: `goal-${suffix}`,
      professionalUserId: 80511,
      patientUserId: 80512,
      rationale: "Ajuste progressivo.",
      status: "sent" as const,
      goal: goal(),
      createdAt: 2000,
    };

    const first = await repository.createGoalSuggestion(input);
    const retried = await repository.createGoalSuggestion(input);
    const history = await repository.listHistory(80511);

    expect(retried).toEqual(first);
    expect(history.filter(event => event.entityId === input.id)).toHaveLength(
      1
    );
  });

  it("makes final suggestion decisions persistent and idempotent", async () => {
    const suffix = crypto.randomUUID();
    const repository = createRepository();
    await repository.createGoalSuggestion({
      id: `decision-${suffix}`,
      professionalUserId: 80521,
      patientUserId: 80522,
      rationale: "Meta revisada.",
      status: "sent",
      goal: goal(1750),
      createdAt: 3000,
    });

    const [first, second] = await Promise.all([
      repository.transitionGoalSuggestion(
        80522,
        `decision-${suffix}`,
        "accepted",
        4000
      ),
      repository.transitionGoalSuggestion(
        80522,
        `decision-${suffix}`,
        "accepted",
        4000
      ),
    ]);

    expect(first.status).toBe("accepted");
    expect(second.status).toBe("accepted");
    await expect(
      repository.transitionGoalSuggestion(
        80522,
        `decision-${suffix}`,
        "refused",
        5000
      )
    ).rejects.toThrow("já foi respondida");

    const history = await repository.listHistory(80521);
    expect(
      history.filter(event => event.eventType === "goal_suggestion_accepted")
    ).toHaveLength(1);
  });

  it("uses stable descending ordering, explicit limits and cursors", async () => {
    const suffix = crypto.randomUUID();
    const repository = createRepository();
    await Promise.all(
      [1, 2, 3].map(index =>
        repository.createMealSuggestion({
          id: `meal-${index}-${suffix}`,
          professionalUserId: 80531,
          patientUserId: 80532,
          mealLabel: "Almoço",
          title: `Sugestão ${index}`,
          description: "Descrição suficiente.",
          rationale: "Justificativa suficiente.",
          status: "sent",
          createdAt: index * 1000,
        })
      )
    );

    const firstPage = await repository.listMealSuggestions(80531, 80532, {
      limit: 2,
    });
    const secondPage = await repository.listMealSuggestions(80531, 80532, {
      limit: 2,
      before: {
        createdAt: firstPage[1].createdAt,
        id: firstPage[1].id,
      },
    });

    expect(firstPage.map(item => item.title)).toEqual([
      "Sugestão 3",
      "Sugestão 2",
    ]);
    expect(secondPage.map(item => item.title)).toEqual(["Sugestão 1"]);
  });
});
