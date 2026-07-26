import { trpc as baseTrpc } from "../professional-home/trpcMock";

const now = Date.UTC(2026, 6, 23, 18, 0, 0);
const resolved = async () => undefined;

function visualState() {
  return new URLSearchParams(window.location.search).get("state") ?? "main";
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
  return querySuccess({
    patientId: input.patientId,
    displayName: "Mariana de Almeida Vasconcelos e Silva",
    authorizationStatus: "approved" as const,
    lastActivityAt: now - 45 * 60_000,
    nextReviewAt: now + 12 * 86_400_000,
    trackingStatus: trackingStatusForState(),
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
      label: "Orientação registrada para o paciente",
      occurredAt: now - 45 * 60_000,
    },
    {
      id: "timeline-assessment",
      eventType: "assessment_version_created",
      label: "Nova versão da avaliação criada",
      occurredAt: now - 2 * 86_400_000,
    },
    {
      id: "timeline-tracking",
      eventType: "tracking_started",
      label: "Acompanhamento profissional iniciado",
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

const trpc = baseTrpc as any;

Object.assign(trpc.professionalRecord, {
  context: {
    useQuery: (input: { patientId: number }) => patientContextQuery(input),
  },
  get: {
    useQuery: (input: {
      patientId: number;
      page?: number;
      pageSize?: number;
    }) => recordQuery(input),
  },
  saveAssessment: { useMutation: () => mutation() },
  createNote: { useMutation: () => mutation() },
  createGuidance: { useMutation: () => mutation() },
  transitionTracking: { useMutation: () => mutation() },
  operationalAlerts: {
    list: { useQuery: () => operationalAlertsQuery() },
    close: { useMutation: () => mutation() },
    evaluate: { useMutation: () => mutation() },
  },
});

export { trpc };
