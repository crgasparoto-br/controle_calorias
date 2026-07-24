const now = Date.UTC(2026, 6, 23, 18, 0, 0);

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
  const severity = patientId <= 2 ? "urgent" : patientId <= 7 ? "attention" : "info";
  const labels: Record<string, string> = {
    record_requires_review: "Registro que exige revisão",
    professional_request_overdue: "Solicitação sem resposta",
    goal_review_due: "Revisão de meta pendente",
    no_food_records: "Sem registros alimentares",
    weigh_in_overdue: "Pesagem pendente",
  };
  const names = [
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
  const primarySignal = {
    id: `priority-${patientId}`,
    type,
    label: labels[type],
    severity,
    reason:
      type === "no_food_records"
        ? "Nenhum registro alimentar confirmado no período esperado para acompanhamento."
        : `Existe uma pendência objetiva com prazo alcançado para ${names[patientId - 1]}.`,
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
    displayName: names[patientId - 1],
    score: (severity === "urgent" ? 3 : severity === "attention" ? 2 : 1) * 1_000 + 2,
    alertCount: patientId % 3 === 0 ? 4 : 2,
    highestSeverity: severity,
    primarySignal,
    signals: [
      primarySignal,
      {
        ...primarySignal,
        id: `secondary-${patientId}`,
        type: "goal_review_due",
        label: "Revisão de meta pendente",
        severity: "attention",
      },
      ...(patientId % 3 === 0
        ? [
            {
              ...primarySignal,
              id: `third-${patientId}`,
              type: "weigh_in_overdue",
              label: "Pesagem pendente",
              severity: "info",
            },
            {
              ...primarySignal,
              id: `fourth-${patientId}`,
              type: "no_food_records",
              label: "Sem registros alimentares",
              severity: "info",
            },
          ]
        : []),
    ],
    updatedAt: primarySignal.updatedAt,
  };
}

function priorityQuery() {
  const state = visualState();
  if (state === "priority-error") {
    return {
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: async () => undefined,
    };
  }
  if (state === "loading") {
    return {
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: async () => undefined,
    };
  }
  return {
    data: state === "empty" ? [] : Array.from({ length: 11 }, (_, index) => priority(index + 1)),
    isLoading: false,
    isError: false,
    refetch: async () => undefined,
  };
}

function portfolioQuery() {
  const state = visualState();
  if (state === "portfolio-error") {
    return {
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: async () => undefined,
    };
  }
  if (state === "loading") {
    return {
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: async () => undefined,
    };
  }
  const empty = state === "empty";
  return {
    data: {
      items: empty ? [] : [{ patientUserId: 1 }],
      pagination: { page: 1, pageSize: 10, total: empty ? 0 : 34, totalPages: empty ? 1 : 4 },
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
    refetch: async () => undefined,
  };
}

export const trpc = {
  professionalRecord: {
    settings: {
      entitlements: {
        useQuery: () => ({
          data: {
            allowed: true,
            enabledResources: [
              "professional_dashboard",
              "professional_ai_assistance",
              "professional_portfolio",
              "professional_messages",
              "professional_reports",
            ],
          },
          isLoading: false,
          isError: false,
          refetch: async () => undefined,
        }),
      },
    },
    ai: {
      priorities: {
        useQuery: () => priorityQuery(),
      },
    },
  },
  nutrition: {
    professionals: {
      portfolio: {
        useQuery: () => portfolioQuery(),
      },
    },
  },
};
