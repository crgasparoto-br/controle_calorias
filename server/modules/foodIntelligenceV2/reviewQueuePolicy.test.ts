import { describe, expect, it } from "vitest";
import { getReviewPriorityBand, projectReviewQueue } from "./reviewQueuePolicy";

type Request = Parameters<typeof projectReviewQueue>[0];
type Case = Request["cases"][number];
type Factors = NonNullable<Case["factors"]>;
const OPENED = Date.parse("2026-03-08T02:30:00.000Z"); // March 7, 23:30 in São Paulo.
const AS_OF = Date.parse("2026-03-15T02:00:00.000Z"); // Still March 14 locally.
const established: Factors = {
  affectedUsers90d: 99,
  occurrences90d: 99,
  severity: 3,
  scope: "personal",
  effort: [],
  readyEvidence: [],
};

function activeCase(id: number, changes: Partial<Case> = {}): Case {
  return {
    id,
    cycleOpenedAtMs: OPENED,
    recordedDeadlineDate: null,
    factors: established,
    ...changes,
  };
}

function project(
  cases: readonly Case[],
  changes: Partial<Omit<Request, "cases">> = {}
) {
  return projectReviewQueue({
    cases,
    asOfMs: AS_OF,
    timeZone: "America/Sao_Paulo",
    spentMinutesThisWeek: null,
    outstandingDemandMinutes: null,
    ...changes,
  });
}

describe("política inicial da fila de curadoria V2 (§14), inativa", () => {
  it("usa impacto e custo reais, alcance global exatamente duplo e evidência sem soma", () => {
    const result = project(
      [
        activeCase(1, {
          factors: {
            ...established,
            effort: ["missing_profile", "missing_profile"],
          },
        }),
        activeCase(2, {
          factors: {
            ...established,
            effort: ["missing_profile"],
            scope: "global",
            readyEvidence: [
              "associated_useful_label_barcode_or_package",
              "unambiguous_useful_official_source",
            ],
          },
        }),
        activeCase(3, {
          factors: {
            ...established,
            effort: [
              "ambiguous_identity",
              "missing_profile",
              "missing_canonical_portion",
              "conflicting_sources",
              "materiality_judgment",
            ],
          },
        }),
      ],
      { asOfMs: OPENED }
    );
    expect(result.ranked.map(({ id }) => id)).toEqual([2, 1, 3]);
    expect(result.ranked[0].evaluation).toMatchObject({
      factors: { A: 99, F: 99, G: 3, R: 2, E: 1, Ev: 2, D: 0 },
      score: 48,
      band: "critical",
      windowDays: 90,
      asOfMs: OPENED,
      policyVersion: "adr-2026-10-05-v1",
    });
    expect(result.ranked[1].evaluation.score).toBe(6);
    expect(result.ranked[2].evaluation.score).toBeCloseTo(2.4);
  });

  it("limita o envelhecimento sem transformar data futura em idade negativa", () => {
    const along = (asOfMs: number) =>
      project([activeCase(1)], { asOfMs }).ranked[0].evaluation;
    expect(along(OPENED - 1)).toMatchObject({ score: 12, factors: { D: 0 } });
    expect(along(OPENED + 15 * 86_400_000)).toMatchObject({
      score: 18,
      factors: { D: 0.5 },
    });
    expect(along(OPENED + 50 * 86_400_000)).toMatchObject({
      score: 24,
      factors: { D: 1 },
    });
  });

  it.each([
    [0, "low", null],
    [1.999999, "low", null],
    [2, "medium", 30],
    [5.999999, "medium", 30],
    [6, "high", 14],
    [11.999999, "high", 14],
    [12, "critical", 7],
  ] as const)("atribui %s à faixa %s", (score, band, targetDays) => {
    expect(getReviewPriorityBand(score)).toEqual({ band, targetDays });
  });

  it("ordena sem arredondar; empates usam gravidade, ciclo e ID, inclusive para zero", () => {
    const a = activeCase(2, {
      factors: { ...established, severity: 1, occurrences90d: 999 },
    });
    const b = activeCase(9, {
      factors: { ...established, severity: 1, occurrences90d: 1000 },
    });
    const zero = (
      id: number,
      severity: Factors["severity"],
      cycleOpenedAtMs = OPENED
    ) =>
      activeCase(id, {
        factors: { ...established, severity, occurrences90d: 0 },
        cycleOpenedAtMs,
      });
    const cases = [
      a,
      b,
      zero(8, 5),
      zero(6, 5),
      zero(10, 5, OPENED - 1),
      zero(1, 4),
    ];
    const first = project(cases);
    expect(first.ranked[0].evaluation.score.toFixed(2)).toBe(
      first.ranked[1].evaluation.score.toFixed(2)
    );
    expect(first.ranked.map(({ id }) => id)).toEqual([9, 2, 10, 6, 8, 1]);
    expect(project([...cases].reverse())).toEqual(first);
    expect(cases.map(({ id }) => id)).toEqual([2, 9, 8, 6, 10, 1]);
  });

  it("não simula zero quando uma consulta ou outra evidência falta; mantém pendentes e prazos", () => {
    const deadline = "2026-03-13";
    const result = project([
      activeCase(4, { recordedDeadlineDate: deadline, factors: null }),
      activeCase(3, {
        factors: { ...established, affectedUsers90d: 0, readyEvidence: null },
      }),
      activeCase(2, { factors: { ...established, affectedUsers90d: null } }),
      activeCase(1, {
        recordedDeadlineDate: deadline,
        factors: { ...established, affectedUsers90d: 0 },
      }),
    ]);
    expect(result.ranked).toMatchObject([
      {
        id: 1,
        deadlineDate: deadline,
        overdue: true,
        evaluation: { band: "low", score: 0 },
      },
    ]);
    expect(result.pendingAssessment.map(item => item.id)).toEqual([2, 3, 4]);
    expect(result.pendingAssessment[2]).toMatchObject({
      deadlineDate: deadline,
      overdue: true,
    });
    expect(result.pendingAssessment[2].evaluation).not.toHaveProperty("score");
  });

  it("usa calendário local, nunca prorroga metas, permite antecipar e preserva novo ciclo separado", () => {
    const earlier = activeCase(1, { recordedDeadlineDate: "2026-03-12" });
    const later = activeCase(2, { recordedDeadlineDate: "2026-03-25" });
    const openedAgain = activeCase(3, {
      cycleOpenedAtMs: Date.parse("2026-03-10T16:00:00.000Z"),
    });
    const result = project([earlier, later, openedAgain]);
    const byId = new Map(result.ranked.map(entry => [entry.id, entry]));
    expect(byId.get(1)).toMatchObject({
      deadlineDate: "2026-03-12",
      overdue: true,
    });
    expect(byId.get(2)).toMatchObject({
      deadlineDate: "2026-03-14",
      overdue: false,
    });
    expect(byId.get(3)).toMatchObject({
      deadlineDate: "2026-03-17",
      overdue: false,
    });
    expect(
      project([later], { asOfMs: Date.parse("2026-03-15T03:00:00.000Z") })
        .ranked[0].overdue
    ).toBe(true);
  });

  it("preserva todo o backlog sob sobrecarga, inclusive apuração, sem confundir limite e alerta", () => {
    const cases = [
      activeCase(1),
      activeCase(2, { factors: null }),
      activeCase(3),
    ];
    const atBoundary = project(cases, {
      spentMinutesThisWeek: 20,
      outstandingDemandMinutes: 40,
    });
    const above = project(cases, {
      spentMinutesThisWeek: 20,
      outstandingDemandMinutes: 41,
    });
    expect(above.capacity).toMatchObject({
      budgetMinutes: 60,
      remainingMinutes: 40,
      exceedsCapacity: true,
    });
    expect(atBoundary.capacity.exceedsCapacity).toBe(false);
    expect(above.ranked).toEqual(atBoundary.ranked);
    expect(above.pendingAssessment).toEqual(atBoundary.pendingAssessment);
    expect(above.ranked.map(({ id }) => id)).toEqual([1, 3]);
    expect(above.pendingAssessment.map(({ id }) => id)).toEqual([2]);
    expect(
      project(cases, { spentMinutesThisWeek: 61, outstandingDemandMinutes: 1 })
        .capacity
    ).toMatchObject({ remainingMinutes: 0, exceedsCapacity: true });
    expect(project(cases, { spentMinutesThisWeek: 61 }).capacity).toMatchObject(
      { remainingMinutes: 0, exceedsCapacity: true }
    );
    expect(project(cases, { spentMinutesThisWeek: 60 }).capacity).toMatchObject(
      { remainingMinutes: 0, exceedsCapacity: null }
    );
  });

  it("usa a semana civil configurada e não infere dados quando medições faltam", () => {
    const sundayUtc = Date.parse("2026-03-09T01:00:00.000Z");
    expect(
      project([], { asOfMs: sundayUtc, timeZone: "America/New_York" }).capacity
    ).toMatchObject({
      weekStartDate: "2026-03-02",
      weekEndDateExclusive: "2026-03-09",
      exceedsCapacity: null,
    });
    expect(
      project([], {
        asOfMs: sundayUtc,
        timeZone: "UTC",
        spentMinutesThisWeek: 0,
        outstandingDemandMinutes: 0,
      }).capacity
    ).toMatchObject({
      weekStartDate: "2026-03-09",
      weekEndDateExclusive: "2026-03-16",
      remainingMinutes: 60,
      exceedsCapacity: false,
    });
    expect(() => project([], { timeZone: "" })).toThrow(
      "operational time zone"
    );
    expect(() => project([activeCase(1), activeCase(1)])).toThrow(
      "duplicate review case"
    );
  });
});
