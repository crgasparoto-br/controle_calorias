// @vitest-environment jsdom
import React, { useState } from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let stateData: any;
const refetch = vi.fn(async () => undefined);
const invalidate = vi.fn(async () => undefined);
const mutate = vi.fn();

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      professionalRecord: { get: { invalidate } },
      nutrition: {
        goals: { get: { invalidate } },
        reports: { invalidate },
      },
    }),
    professionalRecord: {
      officialGoal: {
        professionalState: {
          useQuery: () => ({
            data: stateData,
            isLoading: false,
            isError: false,
            error: null,
            refetch,
          }),
        },
        activate: {
          useMutation: () => ({ mutate, isPending: false }),
        },
        retryNotification: {
          useMutation: () => ({ mutate, isPending: false }),
        },
      },
    },
  },
}));

import ProfessionalOfficialGoalCard, {
  createEmptyProfessionalOfficialGoalDraft,
} from "./ProfessionalOfficialGoalCard";

function goal(version: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `goal-v${version}`,
    version,
    status: version === 6 ? "active" : "superseded",
    calories: 1800 + version * 50,
    proteinGrams: 120 + version,
    carbsGrams: 200 + version * 2,
    fatGrams: 55 + version,
    exceptions:
      version === 6
        ? [
            {
              weekday: 0,
              durationType: "2_weeks",
              calories: 2250,
              proteinGrams: 155,
              carbsGrams: 245,
              fatGrams: 72,
              startDate: "2026-07-01",
            },
          ]
        : [],
    includeExerciseCalories: version % 2 === 0,
    effectiveFrom: `2026-0${version + 1}-01`,
    effectiveUntil: version === 6 ? null : `2026-0${version + 2}-01`,
    justification: `Justificativa da versão ${version}`,
    professionalName: "Nutricionista Auditora",
    origin: "professional",
    supersedesGoalId: version > 1 ? `goal-v${version - 1}` : null,
    createdAt: Date.UTC(2026, version - 1, 28, 12),
    active: version === 6,
    ...overrides,
  };
}

function Harness() {
  const [draft, setDraft] = useState(createEmptyProfessionalOfficialGoalDraft());
  return (
    <ProfessionalOfficialGoalCard
      patientId={41}
      disabled={false}
      draft={draft}
      onDraftChange={setDraft}
    />
  );
}

async function fillJustification(user: ReturnType<typeof userEvent.setup>) {
  const field = screen.getByLabelText("Justificativa profissional");
  await user.clear(field);
  await user.type(field, "Ajuste definido em consulta profissional");
}

async function switchMainGoalToPercent(
  user: ReturnType<typeof userEvent.setup>
) {
  const selector = screen.getByRole("group", {
    name: "Modo de preenchimento da meta padrão",
  });
  await user.click(
    within(selector).getByRole("button", { name: "Por percentual" })
  );
}

beforeEach(() => {
  stateData = {
    trackingStatus: "active",
    current: goal(6, {
      calories: 2150,
      proteinGrams: 150,
      carbsGrams: 235,
      fatGrams: 70,
    }),
    history: [goal(6), goal(5), goal(4), goal(3), goal(2), goal(1)],
    reviewRequests: [],
    notifications: [],
  };
  refetch.mockClear();
  invalidate.mockClear();
  mutate.mockClear();
});

afterEach(cleanup);

describe("ProfessionalOfficialGoalCard", () => {
  it("renders immutable goal history with values, authorship, origin, validity and supersession", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    expect(
      screen.getByRole("heading", { name: "Histórico de metas oficiais" })
    ).toBeTruthy();
    expect(screen.getByText("Versão 6 · Ativa")).toBeTruthy();
    expect(screen.getAllByText("Origem: Profissional").length).toBe(5);
    expect(
      screen.getAllByText(/por Nutricionista Auditora/).length
    ).toBeGreaterThan(0);
    expect(screen.getByText("2100 kcal")).toBeTruthy();
    expect(screen.getByText("Substitui a versão 5")).toBeTruthy();
    expect(screen.getByText("Justificativa da versão 6")).toBeTruthy();
    expect(screen.getByText("1 configurada(s)")).toBeTruthy();
    expect(screen.getByText("Segunda-feira · 2 semanas")).toBeTruthy();
    expect(
      screen.getByText(
        "2250 kcal · 155 g proteínas · 245 g carboidratos · 72 g gorduras"
      )
    ).toBeTruthy();
    expect(screen.getByText("Página 1 de 2")).toBeTruthy();
    expect(screen.queryByText("Versão 1 · Substituída")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Próxima" }));

    expect(screen.getByText("Versão 1 · Substituída")).toBeTruthy();
    expect(screen.getByText("Primeira versão oficial")).toBeTruthy();
    expect(screen.getByText("Página 2 de 2")).toBeTruthy();
    expect(screen.queryByText("goal-v5")).toBeNull();
  });

  it("converts default macro percentages to grams and keeps the API payload canonical", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await screen.findByDisplayValue("2150");
    await switchMainGoalToPercent(user);

    const calories = screen.getByLabelText("Calorias (kcal)");
    await user.clear(calories);
    await user.type(calories, "2000");

    const protein = screen.getByLabelText("Proteínas");
    const carbs = screen.getByLabelText("Carboidratos");
    const fat = screen.getByLabelText("Gorduras");
    await user.clear(protein);
    await user.type(protein, "30");
    await user.clear(carbs);
    await user.type(carbs, "40");
    await user.clear(fat);
    await user.type(fat, "30");
    await fillJustification(user);

    expect(screen.getByText(/150 g/)).toBeTruthy();
    expect(screen.getByText(/200 g/)).toBeTruthy();
    expect(screen.getByText(/67 g/)).toBeTruthy();

    const activateButton = screen.getByRole("button", {
      name: "Ativar nova versão",
    }) as HTMLButtonElement;
    expect(activateButton.disabled).toBe(false);
    await user.click(activateButton);

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        patientId: 41,
        expectedVersion: 6,
        effectiveFrom: expect.any(String),
        justification: "Ajuste definido em consulta profissional",
        goal: {
          includeExerciseCalories: true,
          defaultGoal: {
            calories: 2000,
            proteinGrams: 150,
            carbsGrams: 200,
            fatGrams: 67,
          },
          exceptions: [],
        },
      })
    );
  });

  it("blocks activation when percent macros do not total 100 percent", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await screen.findByDisplayValue("2150");
    await switchMainGoalToPercent(user);

    const protein = screen.getByLabelText("Proteínas");
    const carbs = screen.getByLabelText("Carboidratos");
    const fat = screen.getByLabelText("Gorduras");
    await user.clear(protein);
    await user.type(protein, "30");
    await user.clear(carbs);
    await user.type(carbs, "40");
    await user.clear(fat);
    await user.type(fat, "20");
    await fillJustification(user);

    expect(screen.getByRole("alert").textContent).toContain("90,0%");
    const activateButton = screen.getByRole("button", {
      name: "Ativar nova versão",
    }) as HTMLButtonElement;
    expect(activateButton.disabled).toBe(true);
    expect(mutate).not.toHaveBeenCalled();
  });

  it("supports an independent percent mode for an exception and sends its converted grams", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await screen.findByDisplayValue("2150");
    await fillJustification(user);
    await user.click(screen.getByRole("button", { name: "Adicionar exceção" }));

    const selector = screen.getByRole("group", {
      name: "Modo de preenchimento da exceção 1",
    });
    await user.click(
      within(selector).getByRole("button", { name: "Por percentual" })
    );

    const calories = screen.getByLabelText("Calorias (kcal) da exceção 1");
    await user.clear(calories);
    await user.type(calories, "2400");

    const protein = screen.getByLabelText("Proteínas da exceção 1");
    const carbs = screen.getByLabelText("Carboidratos da exceção 1");
    const fat = screen.getByLabelText("Gorduras da exceção 1");
    await user.clear(protein);
    await user.type(protein, "25");
    await user.clear(carbs);
    await user.type(carbs, "50");
    await user.clear(fat);
    await user.type(fat, "25");

    const activateButton = screen.getByRole("button", {
      name: "Ativar nova versão",
    }) as HTMLButtonElement;
    expect(activateButton.disabled).toBe(false);
    await user.click(activateButton);

    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        goal: expect.objectContaining({
          exceptions: [
            {
              weekday: 0,
              durationType: "always",
              calories: 2400,
              proteinGrams: 150,
              carbsGrams: 300,
              fatGrams: 67,
            },
          ],
        }),
      })
    );
  });
});
