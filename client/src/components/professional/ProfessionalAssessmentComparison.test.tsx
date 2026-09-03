// @vitest-environment jsdom
import React, { useState } from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import ProfessionalAssessmentComparison from "./ProfessionalAssessmentComparison";

const baseDraft = {
  objective: "Rascunho da nova avaliação",
  weightKg: "82",
  heightCm: "181",
  routineAndSchedule: "Rotina em edição",
  physicalActivity: "Treino atual",
  foodPreferences: "Preferências atuais",
  restrictionsAndAllergies: "",
  reportedDifficulties: "",
  relevantHabits: "",
  professionalObservations: "Observação ainda não salva",
  assessedAt: "2026-09-02T18:00",
  nextReviewAt: "2026-09-30T18:00",
};

function historicalAssessment(overrides: Record<string, unknown> = {}) {
  return {
    id: "assessment-2",
    version: 2,
    objective: "Objetivo histórico v2",
    weightKg: 79,
    heightCm: 180,
    routineAndSchedule: "Rotina histórica v2",
    physicalActivity: "Musculação histórica v2",
    foodPreferences: "Preferências históricas v2",
    restrictionsAndAllergies: "Lactose histórica v2",
    reportedDifficulties: "Dificuldade histórica v2",
    relevantHabits: "Hábito histórico v2",
    professionalObservations: "Observação histórica v2",
    assessedAt: Date.UTC(2026, 7, 2, 18),
    nextReviewAt: Date.UTC(2026, 7, 30, 18),
    createdAt: Date.UTC(2026, 7, 2, 18),
    authorName: "Nutricionista Histórica",
    ...overrides,
  };
}

function recordFixture(total = 2) {
  return {
    patient: {
      authorizationId: "authorization-1039",
      trackingStatus: "active",
    },
    latestAssessment: historicalAssessment({
      id: "assessment-latest",
      version: 99,
      objective: "Objetivo da latest que não deve completar histórico",
      physicalActivity: "Atividade da latest que não deve vazar",
    }),
    assessmentHistory: [
      historicalAssessment(),
      historicalAssessment({
        id: "assessment-1",
        version: 1,
        objective: "Objetivo histórico v1",
        weightKg: 75,
        routineAndSchedule: "Rotina histórica v1",
        physicalActivity: null,
        foodPreferences: null,
        restrictionsAndAllergies: null,
        reportedDifficulties: null,
        relevantHabits: null,
        professionalObservations: null,
        assessedAt: Date.UTC(2026, 6, 2, 18),
        nextReviewAt: null,
      }),
    ],
    pagination: {
      page: 1,
      pageSize: 20,
      totals: { assessments: total, notes: 0, guidances: 0, timeline: 0 },
      hasMore: false,
    },
  };
}

function Harness({ active = true, record = recordFixture() }) {
  const [draft, setDraft] = useState(baseDraft);
  return (
    <ProfessionalAssessmentComparison
      active={active}
      draft={draft}
      onDraftChange={setDraft}
      onPageChange={vi.fn()}
      page={1}
      patientId={41}
      record={record}
      save={{ isError: false, error: null, isPending: false, mutate: vi.fn() }}
    />
  );
}

afterEach(cleanup);

describe("ProfessionalAssessmentComparison", () => {
  it("opens the selected persisted version in read-only comparison without changing the draft", async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness />);

    expect(screen.getByText("Histórico de avaliações")).toBeTruthy();
    const draftObjective = screen.getByLabelText(
      "Objetivo do acompanhamento"
    ) as HTMLTextAreaElement;
    await user.type(draftObjective, " preservado");

    const viewButtons = screen.getAllByRole("button", {
      name: "Visualizar avaliação",
    });
    await user.click(viewButtons[1]!);

    const historical = screen.getByTestId("historical-assessment");
    expect(within(historical).getByText(/Versão 1/)).toBeTruthy();
    expect(screen.getByTestId("historical-objective").textContent).toBe(
      "Objetivo histórico v1"
    );
    expect(screen.getByTestId("historical-weightKg").textContent).toBe("75 kg");
    expect(screen.getByTestId("historical-physicalActivity").textContent).toBe(
      "Não informado"
    );
    expect(
      within(historical).queryByText("Atividade da latest que não deve vazar")
    ).toBeNull();
    expect(within(historical).queryByRole("textbox")).toBeNull();
    expect(
      within(historical).queryByRole("button", { name: "Salvar nova versão" })
    ).toBeNull();
    expect(
      screen.getAllByRole("button", { name: "Salvar nova versão" })
    ).toHaveLength(1);
    expect(
      container.querySelector("[data-assessment-comparison='open']")?.className
    ).toContain("xl:grid-cols-2");
    expect(draftObjective.value).toBe("Rascunho da nova avaliação preservado");

    await user.click(viewButtons[0]!);
    expect(screen.getByTestId("historical-objective").textContent).toBe(
      "Objetivo histórico v2"
    );
    expect(draftObjective.value).toBe("Rascunho da nova avaliação preservado");

    await user.click(
      screen.getByRole("button", { name: "Fechar comparação" })
    );
    expect(screen.queryByTestId("historical-assessment")).toBeNull();
    expect(draftObjective.value).toBe("Rascunho da nova avaliação preservado");
  });

  it("keeps history readable while a paused tracking blocks saving a new version", async () => {
    const user = userEvent.setup();
    render(<Harness active={false} />);

    expect(
      (screen.getByRole("button", {
        name: "Salvar nova versão",
      }) as HTMLButtonElement).disabled
    ).toBe(true);
    await user.click(
      screen.getAllByRole("button", { name: "Visualizar avaliação" })[0]!
    );
    expect(screen.getByTestId("historical-assessment")).toBeTruthy();
    expect(screen.getByText(/Somente leitura/)).toBeTruthy();
  });

  it("shows a clear empty state without a visualization action", () => {
    const record = recordFixture(0);
    record.assessmentHistory = [];
    render(<Harness record={record} />);

    expect(screen.getByText("Nenhuma avaliação registrada.")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Visualizar avaliação" })
    ).toBeNull();
  });

  it("preserves pagination for more than twenty versions and closes comparison when changing page", async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    render(
      <ProfessionalAssessmentComparison
        active
        draft={baseDraft}
        onDraftChange={vi.fn()}
        onPageChange={onPageChange}
        page={1}
        patientId={41}
        record={recordFixture(21)}
        save={{ isError: false, error: null, isPending: false, mutate: vi.fn() }}
      />
    );

    await user.click(
      screen.getAllByRole("button", { name: "Visualizar avaliação" })[0]!
    );
    expect(screen.getByTestId("historical-assessment")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Próxima" }));

    expect(onPageChange).toHaveBeenCalledWith(2);
    expect(screen.queryByTestId("historical-assessment")).toBeNull();
  });
});
