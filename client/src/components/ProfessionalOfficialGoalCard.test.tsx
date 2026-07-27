// @vitest-environment jsdom
import React, { useState } from "react";
import { cleanup, render, screen } from "@testing-library/react";
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
});
