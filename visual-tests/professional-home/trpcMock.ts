const now = Date.UTC(2026, 6, 23, 18, 0, 0);
const resolved = async () => undefined;

function visualState() {
  return new URLSearchParams(window.location.search).get("state") ?? "main";
}

function priority(patientId: number) {
  const types = [
    "record_requires_review",
    "professional_request_overdue",
    "goal_review_due",
    "no_food_records",
    "weigh_in_overdue",
  ];
  const type = types[(patientId - 1) % types.length];
  const severity =
    patientId <= 2 ? "urgent" : patientId <= 7 ? "attention" : "info";
  const labels: Record<string, string> = {
    record_requires_review: "Registro que exige revisão",
    professional_request_overdue: "Solicitação sem resposta",
    goal_review_due: "Revisão de meta pendente",
    no_food_records: "Sem registros alimentares",
    weigh_in_overdue: "Pesagem pendente",
  };
  const baseNames = [
    "Mariana de Almeida Vasconcelos e Silva",
    "João Pereira",
    "Beatriz Fernandes",
    "Carlos Henrique",
    "Daniela Souza",
    "Eduardo Lima",
    "Fernanda Rodrigues",
    "Gabriel Oliveira",
    "Helena Martins",
    "Igor Costa",
    "Juliana Ribeiro",
  ];
  const displayName =
    baseNames[patientId - 1] ??
    `Paciente com nome extenso para validação visual número ${patientId}`;
  const primarySignal = {
    id: `priority-${patientId}`,
    type,
    label: labels[type],
    severity,
    reason:
      type === "no_food_records"
        ? "Nenhum registro alimentar confirmado no período esperado para acompanhamento."
        : `Existe uma pendência objetiva com prazo alcançado para ${displayName}.`,
    suggestedAction:
      type === "goal_review_due"
        ? "Registrar a revisão da meta ou reagendar a próxima data."
        : type === "weigh_in_overdue"
          ? "Solicitar a pesagem ou encerrar a solicitação."
          : "Revisar a pendência e registrar a ação realizada.",
    period: {
      start: now - patientId * 86_400_000,
      end: now - (patientId - 1) * 86_400_000,
    },
    updatedAt: now - patientId * 3_600_000,
  };
  return {
    patientId,
    displayName,
    score:
      (severity === "urgent" ? 3 : severity === "attention" ? 2 : 1) *
        1_000 +
      2,
    alertCount: patientId % 3 === 0 ? 4 : 2,
    highestSeverity: severity,
    primarySignal,
    signals: [primarySignal],
    updatedAt: primarySignal.updatedAt,
  };
}

function priorityQuery(input: { limit: number; offset?: number }) {
  const state = visualState();
  if (state === "priority-error") {
    return {
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: resolved,
    };
  }
  if (state === "loading") {
    return {
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: resolved,
    };
  }
  const priorities = Array.from({ length: 151 }, (_, index) =>
    priority(index + 1)
  );
  const offset = input.offset ?? 0;
  return {
    data:
      state === "empty" || state === "portfolio-error"
        ? []
        : priorities.slice(offset, offset + input.limit),
    isLoading: false,
    isError: false,
    refetch: resolved,
  };
}

const portfolioItems = [
  {
    authorizationId: "approved-1",
    patientUserId: 1,
    patientName: "Mariana de Almeida Vasconcelos e Silva",
    patientEmail: "mariana@example.com",
    authorizationStatus: "approved",
    trackingStatus: "active",
    lastFoodActivityAt: now - 3_600_000,
    nextReviewAt: now + 2 * 86_400_000,
  },
  {
    authorizationId: "pending-2",
    patientUserId: 2,
    patientName: "João Pereira",
    patientEmail: null,
    authorizationStatus: "pending",
    trackingStatus: null,
    lastFoodActivityAt: null,
    nextReviewAt: null,
  },
  {
    authorizationId: "rejected-3",
    patientUserId: 3,
    patientName: "Beatriz Fernandes",
    patientEmail: null,
    authorizationStatus: "rejected",
    trackingStatus: null,
    lastFoodActivityAt: null,
    nextReviewAt: null,
  },
  {
    authorizationId: "revoked-4",
    patientUserId: 4,
    patientName: "Carlos Henrique",
    patientEmail: null,
    authorizationStatus: "revoked",
    trackingStatus: null,
    lastFoodActivityAt: null,
    nextReviewAt: null,
  },
];

function portfolioQuery() {
  const state = visualState();
  if (state === "portfolio-error") {
    return {
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: resolved,
    };
  }
  if (state === "loading") {
    return {
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: resolved,
    };
  }
  const empty = state === "empty";
  return {
    data: {
      items: empty ? [] : portfolioItems,
      pagination: {
        page: 1,
        pageSize: 20,
        total: empty ? 0 : portfolioItems.length,
        totalPages: empty ? 0 : 1,
      },
      summary: {
        active: 24,
        paused: 4,
        ended: 6,
        pendingRequests: 3,
        pendingReviews: 7,
        pendingWeighings: 5,
      },
    },
    isLoading: false,
    isError: false,
    refetch: resolved,
  };
}

function cancellable() {
  return { cancel: resolved };
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

export const trpc = {
  useUtils: () => ({
    nutrition: {
      professionals: {
        patientTimeZone: { ...cancellable(), fetch: resolved },
        patientDashboard: cancellable(),
        patientPeriodBundle: cancellable(),
        myAccesses: { invalidate: resolved },
      },
    },
    professionalRecord: {
      context: cancellable(),
      get: cancellable(),
      messages: { list: cancellable() },
      operationalAlerts: { list: cancellable() },
      ai: { priorities: cancellable() },
      officialGoal: { professionalState: cancellable() },
    },
  }),
  professionalRecord: {
    context: {
      useQuery: () => ({
        data: null,
        isLoading: false,
        isFetching: false,
        isError: false,
        isSuccess: true,
        isFetchedAfterMount: true,
        error: null,
        refetch: resolved,
      }),
    },
    settings: {
      entitlements: {
        useQuery: () => ({
          data: {
            allowed: true,
            enabledResources: [
              "professional_dashboard",
              "professional_portfolio",
              "professional_record",
              "professional_goals",
              "professional_operational_alerts",
              "professional_messages",
              "professional_reports",
              "professional_ai_assistance",
              "professional_settings",
            ],
          },
          isLoading: false,
          isError: false,
          refetch: resolved,
        }),
      },
    },
    ai: {
      priorities: {
        useQuery: (input: { limit: number; offset?: number }) =>
          priorityQuery(input),
      },
    },
  },
  nutrition: {
    professionals: {
      profile: {
        useQuery: () => ({
          data: { active: true },
          isLoading: false,
          isFetching: false,
          isError: false,
          isSuccess: true,
          isFetchedAfterMount: true,
          refetch: resolved,
        }),
      },
      portfolio: {
        useQuery: () => portfolioQuery(),
      },
      requestAccess: {
        useMutation: () => mutation(),
      },
    },
  },
};
