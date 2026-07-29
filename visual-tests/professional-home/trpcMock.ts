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
      (severity === "urgent" ? 3 : severity === "attention" ? 2 : 1) * 1_000 +
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
    authorizationId: "receipt-pending-2",
    patientUserId: 0,
    patientName: "Solicitação aguardando confirmação",
    patientEmail: null,
    authorizationStatus: "pending",
    trackingStatus: null,
    lastFoodActivityAt: null,
    nextReviewAt: null,
  },
  {
    authorizationId: "rejected-3",
    patientUserId: 0,
    patientName: "Solicitação recusada",
    patientEmail: null,
    authorizationStatus: "rejected",
    trackingStatus: null,
    lastFoodActivityAt: null,
    nextReviewAt: null,
  },
  {
    authorizationId: "revoked-4",
    patientUserId: 0,
    patientName: "Acesso revogado",
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
        activeWithRecentRecords: 18,
        withoutRecentActivity: 6,
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

const allProfessionalResources = [
  "professional_dashboard",
  "professional_portfolio",
  "professional_record",
  "professional_goals",
  "professional_operational_alerts",
  "professional_messages",
  "professional_reports",
  "professional_ai_assistance",
  "professional_settings",
];

function settingsQuery() {
  return {
    data: {
      profile: {
        active: true,
        displayName:
          "Nutricionista com nome profissional extenso para validação responsiva",
        registrationNumber: "CRN 123456",
      },
      identity: {
        contactEmail: "nutricionista@example.com",
        contactPhone: "+55 15 99999-9999",
        patientFacingBio:
          "Atendimento nutricional com acompanhamento individualizado, comunicação contextual e revisão periódica das metas.",
      },
      preferences: {
        defaultReviewIntervalDays: 30,
        messageTemplates: [
          {
            id: "visual-template-1",
            title: "Lembrete de acompanhamento",
            messageType: "reminder",
            content:
              "Olá! Este é um lembrete para revisar seus registros antes do próximo acompanhamento.",
          },
        ],
      },
      operationalAlertCriteria: [
        {
          key: "no_food_records",
          label: "Ausência de registros alimentares",
          description:
            "Sinaliza pacientes ativos sem registros alimentares no período esperado.",
          value: 3,
          configurable: false,
        },
      ],
      entitlements: {
        allowed: true,
        mode: "open_access",
        commercialState: "open_access",
        planName: "Acesso profissional",
        fallbackUsed: false,
        enabledResources: allProfessionalResources,
        capacity: {
          limit: 50,
          used: 12,
          usageAvailable: true,
        },
      },
    },
    isLoading: false,
    isError: false,
    refetch: resolved,
  };
}

function patientRequestsQuery() {
  const isError = visualState() === "access-error";
  return {
    data: [],
    isLoading: false,
    isError,
    refetch: resolved,
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
        profile: { invalidate: resolved },
        patientRequests: { invalidate: resolved },
        history: { invalidate: resolved },
        portfolio: { invalidate: resolved },
      },
    },
    professionalRecord: {
      context: cancellable(),
      get: { ...cancellable(), reset: resolved },
      messages: { list: cancellable() },
      operationalAlerts: { list: cancellable() },
      ai: { priorities: cancellable() },
      officialGoal: { professionalState: cancellable() },
      settings: {
        get: { invalidate: resolved },
        entitlements: { invalidate: resolved },
      },
    },
  }),
  professionalRecord: {
    portfolioReport: {
      useQuery: () => portfolioQuery(),
    },
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
      get: {
        useQuery: () => settingsQuery(),
      },
      updateIdentity: {
        useMutation: () => mutation(),
      },
      updatePreferences: {
        useMutation: () => mutation(),
      },
      setActive: {
        useMutation: () => mutation(),
      },
      entitlements: {
        useQuery: () => ({
          data: {
            allowed: true,
            enabledResources: allProfessionalResources,
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
    onboarding: {
      timeZone: {
        useQuery: () => ({
          data: {
            timeZone: "America/Sao_Paulo",
            source: "profile",
            fallbackReason: null,
          },
          status: "success",
          isLoading: false,
          isFetching: false,
          isError: false,
          isSuccess: true,
          error: null,
          refetch: resolved,
        }),
      },
    },
    professionals: {
      profile: {
        useQuery: () => {
          const isError = visualState() === "profile-error";
          return {
            data: isError
              ? undefined
              : {
                  active: true,
                  displayName: "Nutricionista de validação",
                  registrationNumber: "CRN 123456",
                },
            isLoading: false,
            isFetching: false,
            isError,
            isSuccess: !isError,
            isFetchedAfterMount: true,
            refetch: resolved,
          };
        },
      },
      portfolio: {
        useQuery: () => portfolioQuery(),
      },
      patientRequests: {
        useQuery: () => patientRequestsQuery(),
      },
      approveAccess: {
        useMutation: () => mutation(),
      },
      revokeAccess: {
        useMutation: () => mutation(),
      },
      upsertProfile: {
        useMutation: () => mutation(),
      },
      requestAccess: {
        useMutation: () => mutation(),
      },
    },
  },
};
