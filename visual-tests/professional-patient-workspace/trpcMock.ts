import { useSyncExternalStore } from "react";
import { trpc as baseTrpc } from "../professional-home/trpcMock";

const now = Date.UTC(2026, 6, 23, 18, 0, 0);
const resolved = async () => undefined;
export const VISUAL_PROFESSIONAL_STATE_EVENT =
  "visual-professional-state-change";

function visualState() {
  return new URLSearchParams(window.location.search).get("state") ?? "main";
}

function useVisualState() {
  return useSyncExternalStore(
    onStoreChange => {
      window.addEventListener(VISUAL_PROFESSIONAL_STATE_EVENT, onStoreChange);
      return () =>
        window.removeEventListener(
          VISUAL_PROFESSIONAL_STATE_EVENT,
          onStoreChange
        );
    },
    visualState,
    () => "main"
  );
}

function trackingStatusForState() {
  const state = visualState();
  if (state === "paused") return "paused" as const;
  if (state === "ended") return "ended" as const;
  return "active" as const;
}

function querySuccess<T>(data: T) {
  return {
    data,
    isLoading: false,
    isFetching: false,
    isError: false,
    isSuccess: true,
    isFetchedAfterMount: true,
    error: null,
    refetch: resolved,
  };
}

function mutation() {
  return {
    mutate: () => undefined,
    reset: () => undefined,
    isPending: false,
    isError: false,
    error: null,
  };
}

function patientContextQuery(input: { patientId: number }) {
  const trackingStatus = trackingStatusForState();
  return querySuccess({
    patientId: input.patientId,
    authorizationId:
      trackingStatus === "ended" ? undefined : "authorization-visual-1",
    displayName: "Mariana de Almeida Vasconcelos e Silva",
    authorizationStatus: "approved" as const,
    lastActivityAt: now - 45 * 60_000,
    lastActivityLabel:
      trackingStatus === "ended" ? undefined : "Orientação ao paciente registrada",
    nextReviewAt: now + 12 * 86_400_000,
    trackingStatus,
  });
}

function recordQuery(input: {
  patientId: number;
  page?: number;
  pageSize?: number;
}) {
  const state = visualState();
  if (state === "patient-loading") {
    return {
      data: undefined,
      isLoading: true,
      isFetching: true,
      isError: false,
      isSuccess: false,
      isFetchedAfterMount: false,
      error: null,
      refetch: resolved,
    };
  }
  if (state === "patient-error") {
    return {
      data: undefined,
      isLoading: false,
      isFetching: false,
      isError: true,
      isSuccess: false,
      isFetchedAfterMount: true,
      error: new Error("Falha visual simulada ao carregar o prontuário"),
      refetch: resolved,
    };
  }

  const trackingStatus = trackingStatusForState();
  const timeline = [
    {
      id: "timeline-guidance",
      eventType: "guidance_created",
      label: "Orientação ao paciente registrada",
      occurredAt: now - 45 * 60_000,
    },
    {
      id: "timeline-assessment",
      eventType: "assessment_version_created",
      label: "Nova versão da avaliação registrada",
      occurredAt: now - 2 * 86_400_000,
    },
    {
      id: "timeline-tracking",
      eventType: "tracking_started",
      label: "Acompanhamento iniciado",
      occurredAt: now - 15 * 86_400_000,
    },
  ];

  return querySuccess({
    patient: {
      authorizationId: "approved-1",
      trackingStatus,
    },
    latestAssessment: {
      id: "assessment-2",
      version: 2,
      objective:
        "Melhorar a composição corporal preservando desempenho e rotina alimentar.",
      assessedAt: now - 2 * 86_400_000,
      nextReviewAt: now + 12 * 86_400_000,
    },
    assessmentHistory: [
      {
        id: "assessment-2",
        version: 2,
        objective:
          "Melhorar a composição corporal preservando desempenho e rotina alimentar.",
        assessedAt: now - 2 * 86_400_000,
      },
      {
        id: "assessment-1",
        version: 1,
        objective:
          "Organizar horários e aumentar a regularidade das refeições.",
        assessedAt: now - 30 * 86_400_000,
      },
    ],
    guidances: [
      {
        id: "guidance-1",
        title: "Organização do pré-treino",
        version: 1,
        content:
          "Planejar uma refeição leve antes do treino e registrar qualquer desconforto percebido.",
        authorName: "Nutricionista de validação",
        createdAt: now - 45 * 60_000,
      },
    ],
    notes: [
      {
        id: "note-1",
        content:
          "Paciente relatou boa adesão durante a semana e maior dificuldade nos fins de semana.",
        authorName: "Nutricionista de validação",
        createdAt: now - 3 * 60 * 60_000,
      },
    ],
    timeline,
    pagination: {
      page: input.page ?? 1,
      pageSize: input.pageSize ?? 20,
      hasMore: false,
    },
  });
}

function operationalAlertsQuery() {
  return querySuccess([
    {
      id: "alert-review-1",
      patientUserId: 1,
      patientName: "Mariana de Almeida Vasconcelos e Silva",
      type: "record_requires_review",
      severity: "attention",
      reason: "Existe um registro recente que precisa de revisão profissional.",
      suggestedAction: "Revisar o registro e documentar a decisão tomada.",
      period: { start: now - 86_400_000, end: now },
      origin: { type: "meals", id: "meal-visual-1" },
    },
  ]);
}

function officialGoalQuery() {
  const history = [
    {
      id: "goal-visual-3",
      version: 3,
      status: "active",
      calories: 2345,
      proteinGrams: 187,
      carbsGrams: 301,
      fatGrams: 79,
      exceptions: [
        {
          weekday: 0,
          durationType: "2_weeks",
          calories: 2450,
          proteinGrams: 192,
          carbsGrams: 315,
          fatGrams: 82,
          startDate: "2026-07-01",
        },
      ],
      includeExerciseCalories: true,
      effectiveFrom: "2026-07-01",
      effectiveUntil: null,
      justification: "Revisão oficial para o ciclo atual",
      professionalName: "Nutricionista de validação",
      origin: "professional",
      supersedesGoalId: "goal-visual-2",
      createdAt: now - 2 * 86_400_000,
      active: true,
    },
    {
      id: "goal-visual-2",
      version: 2,
      status: "superseded",
      calories: 2190,
      proteinGrams: 172,
      carbsGrams: 280,
      fatGrams: 74,
      exceptions: [],
      includeExerciseCalories: false,
      effectiveFrom: "2026-06-01",
      effectiveUntil: "2026-07-01",
      justification: "Meta oficial do ciclo anterior",
      professionalName: "Nutricionista de validação",
      origin: "professional",
      supersedesGoalId: "goal-visual-1",
      createdAt: now - 32 * 86_400_000,
      active: false,
    },
    {
      id: "goal-visual-1",
      version: 1,
      status: "superseded",
      calories: 2050,
      proteinGrams: 160,
      carbsGrams: 260,
      fatGrams: 70,
      exceptions: [],
      includeExerciseCalories: false,
      effectiveFrom: "2026-05-01",
      effectiveUntil: "2026-06-01",
      justification: "Primeira meta oficial registrada",
      professionalName: "Nutricionista de validação",
      origin: "professional",
      supersedesGoalId: null,
      createdAt: now - 62 * 86_400_000,
      active: false,
    },
  ];
  return querySuccess({
    current: history[0],
    history,
    reviewRequests: [
      {
        id: "review-visual-1",
        status: "open",
      },
    ],
    notifications: [
      {
        goalId: "goal-visual-3",
        status: "failed",
        attempts: 2,
      },
    ],
  });
}

const trpc = baseTrpc as any;
const baseUseUtils = trpc.useUtils;
trpc.useUtils = () => {
  const utils = baseUseUtils();
  return {
    ...utils,
    nutrition: {
      ...utils.nutrition,
      goals: { get: { invalidate: resolved } },
      reports: { invalidate: resolved },
    },
    professionalRecord: {
      ...utils.professionalRecord,
      get: { ...utils.professionalRecord.get, invalidate: resolved },
    },
  };
};

Object.assign(trpc.professionalRecord, {
  context: {
    useQuery: (input: { patientId: number }) => {
      useVisualState();
      return patientContextQuery(input);
    },
  },
  get: {
    useQuery: (input: {
      patientId: number;
      page?: number;
      pageSize?: number;
    }) => {
      useVisualState();
      return recordQuery(input);
    },
  },
  saveAssessment: { useMutation: () => mutation() },
  createNote: { useMutation: () => mutation() },
  createGuidance: { useMutation: () => mutation() },
  transitionTracking: { useMutation: () => mutation() },
  officialGoal: {
    professionalState: { useQuery: () => officialGoalQuery() },
    activate: { useMutation: () => mutation() },
    retryNotification: { useMutation: () => mutation() },
  },
  operationalAlerts: {
    list: { useQuery: () => operationalAlertsQuery() },
    close: { useMutation: () => mutation() },
    evaluate: { useMutation: () => mutation() },
  },
});

export { trpc };
