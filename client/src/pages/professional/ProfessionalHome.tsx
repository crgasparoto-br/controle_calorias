import {
  ProfessionalAsyncState,
  ProfessionalLoadingState,
  ProfessionalPage,
  ProfessionalPageHeader,
  ProfessionalSplitLayout,
  ProfessionalStatusBadge,
} from "@/components/professional/ProfessionalUi";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { professionalPatientPath } from "@/lib/professionalRoutes";
import { trpc } from "@/lib/trpc";
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  BellRing,
  MessageSquareText,
  UsersRound,
} from "lucide-react";
import React from "react";
import { useLocation } from "wouter";

function formatDateTime(value: number | null | undefined) {
  if (!value) return null;
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatPriorityPeriod(signal: any) {
  const start = formatDateTime(signal?.period?.start);
  const end = formatDateTime(signal?.period?.end);
  if (start && end) return `${start} até ${end}`;
  if (end) return `Prazo: ${end}`;
  if (start) return `Desde ${start}`;
  const updatedAt = formatDateTime(signal?.updatedAt);
  return updatedAt ? `Atualizado em ${updatedAt}` : "Prazo não informado";
}

function priorityDestination(item: any) {
  const type = item.primarySignal?.type;
  if (type === "goal_review_due") {
    return professionalPatientPath(item.patientId, "goals");
  }
  if (type === "no_food_records" || type === "record_requires_review") {
    return professionalPatientPath(item.patientId, "reports");
  }
  if (
    type === "weigh_in_overdue" ||
    type === "professional_request_overdue"
  ) {
    return professionalPatientPath(item.patientId, "messages");
  }
  return professionalPatientPath(item.patientId);
}

function priorityActionLabel(item: any) {
  const type = item.primarySignal?.type;
  if (type === "goal_review_due") return "Abrir metas";
  if (type === "no_food_records" || type === "record_requires_review") {
    return "Abrir relatório";
  }
  if (
    type === "weigh_in_overdue" ||
    type === "professional_request_overdue"
  ) {
    return "Abrir mensagens";
  }
  return "Revisar paciente";
}

function PrioritiesPanel({
  enabled,
  showAll,
}: {
  enabled: boolean;
  showAll: boolean;
}) {
  const [, setLocation] = useLocation();
  const query = trpc.professionalRecord.ai.priorities.useQuery(
    { limit: showAll ? 100 : 11 },
    {
      enabled,
      retry: false,
      refetchOnWindowFocus: true,
      refetchInterval: enabled ? 30_000 : false,
    }
  );

  if (!enabled) {
    return (
      <ProfessionalAsyncState
        variant="panel"
        icon="empty"
        title="Prioridades assistidas indisponíveis"
        description="A assistência por IA não está incluída no acesso profissional atual. As demais áreas autorizadas continuam disponíveis."
      />
    );
  }
  if (query.isLoading) {
    return <ProfessionalLoadingState label="Carregando prioridades de hoje..." />;
  }
  if (query.isError) {
    return (
      <ProfessionalAsyncState
        variant="panel"
        title="Não foi possível carregar as prioridades"
        description="O resumo da carteira continua disponível. Tente atualizar somente esta lista."
        onRetry={() => void query.refetch()}
      />
    );
  }

  const allPriorities = query.data ?? [];
  const hasMore = !showAll && allPriorities.length > 10;
  const priorities = showAll ? allPriorities : allPriorities.slice(0, 10);
  if (!priorities.length) {
    return (
      <ProfessionalAsyncState
        variant="panel"
        icon="success"
        title="Nenhuma prioridade operacional aberta"
        description="Não há pendências objetivas para esta lista no momento. Isso não representa uma avaliação clínica."
      />
    );
  }

  return (
    <div className="grid gap-3">
      {priorities.map((item: any) => {
        const primary = item.primarySignal ?? item.signals?.[0];
        const visibleSignals = (item.signals ?? []).slice(0, 3);
        const remainingSignals = Math.max(
          0,
          Number(item.alertCount ?? visibleSignals.length) - visibleSignals.length
        );
        return (
          <article
            key={item.patientId}
            className="grid min-w-0 gap-4 rounded-2xl border bg-card p-4 shadow-sm lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="break-words font-semibold">{item.displayName}</h3>
                <ProfessionalStatusBadge
                  kind="severity"
                  value={item.highestSeverity}
                />
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                {item.alertCount} pendência(s):{" "}
                {visibleSignals.map((signal: any) => signal.label).join(", ")}
                {remainingSignals > 0 ? ` e mais ${remainingSignals}` : ""}
              </p>
              {primary?.reason ? (
                <p className="mt-2 text-sm">{primary.reason}</p>
              ) : null}
              <p className="mt-1 text-xs text-muted-foreground">
                {formatPriorityPeriod(primary)}
              </p>
              {primary?.suggestedAction ? (
                <p className="mt-2 text-sm">
                  <span className="font-medium">Ação sugerida:</span>{" "}
                  {primary.suggestedAction}
                </p>
              ) : null}
            </div>
            <Button
              variant="outline"
              onClick={() => setLocation(priorityDestination(item))}
            >
              {priorityActionLabel(item)}
              <ArrowRight className="h-4 w-4" />
            </Button>
          </article>
        );
      })}

      {hasMore ? (
        <div className="flex justify-center pt-2">
          <Button
            variant="outline"
            onClick={() => setLocation("/professional?priorities=all")}
          >
            Ver todas as prioridades
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      ) : null}
      {showAll ? (
        <div className="flex justify-center pt-2">
          <Button variant="ghost" onClick={() => setLocation("/professional")}>
            <ArrowLeft className="h-4 w-4" />
            Voltar às dez primeiras
          </Button>
        </div>
      ) : null}
    </div>
  );
}

type SummaryItem = {
  label: string;
  value: number;
  description: string;
  path?: string;
};

function SummaryTile({
  item,
  onOpen,
}: {
  item: SummaryItem;
  onOpen: (path: string) => void;
}) {
  const className =
    "min-w-0 rounded-2xl border bg-card p-4 text-left shadow-sm";
  const content = (
    <>
      <span className="text-sm text-muted-foreground">{item.label}</span>
      <strong className="mt-1 block text-2xl">{item.value}</strong>
      <span className="mt-2 block text-xs leading-5 text-muted-foreground">
        {item.description}
      </span>
    </>
  );

  return item.path ? (
    <button
      type="button"
      className={`${className} transition hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
      onClick={() => onOpen(item.path as string)}
    >
      {content}
    </button>
  ) : (
    <div className={className}>{content}</div>
  );
}

function PortfolioSummary({ enabled }: { enabled: boolean }) {
  const [, setLocation] = useLocation();
  const query = trpc.nutrition.professionals.portfolio.useQuery(
    {
      search: "",
      authorizationStatus: "all",
      trackingStatus: "all",
      activity: "all",
      nextReview: "all",
      page: 1,
      pageSize: 10,
      includeHistoricalActivity: false,
    },
    {
      enabled,
      retry: false,
      refetchOnWindowFocus: true,
      refetchInterval: enabled ? 30_000 : false,
    }
  );

  if (!enabled) {
    return (
      <ProfessionalAsyncState
        variant="panel"
        icon="empty"
        title="Resumo da carteira indisponível"
        description="A gestão da carteira não está incluída no acesso profissional atual. O início profissional permanece protegido e utilizável."
      />
    );
  }
  if (query.isLoading) {
    return <ProfessionalLoadingState label="Carregando resumo da carteira..." />;
  }
  if (query.isError) {
    return (
      <ProfessionalAsyncState
        variant="panel"
        title="Não foi possível carregar o resumo"
        description="As prioridades já carregadas foram preservadas."
        onRetry={() => void query.refetch()}
      />
    );
  }

  const total = Number(
    query.data?.pagination?.total ?? query.data?.items?.length ?? 0
  );
  if (total === 0) {
    return (
      <ProfessionalAsyncState
        variant="panel"
        icon="empty"
        title="Sua carteira ainda está vazia"
        description="Solicite acesso a um paciente para iniciar o acompanhamento profissional."
        actionLabel="Solicitar acesso"
        onRetry={() => setLocation("/professional/patients?request=new")}
      />
    );
  }

  const summary = query.data?.summary;
  const items: SummaryItem[] = [
    {
      label: "Ativos",
      value: summary?.active ?? 0,
      description: "Acompanhamentos em andamento.",
      path: "/professional/patients?tracking=active",
    },
    {
      label: "Pausados",
      value: summary?.paused ?? 0,
      description: "Acompanhamentos temporariamente pausados.",
      path: "/professional/patients?tracking=paused",
    },
    {
      label: "Encerrados",
      value: summary?.ended ?? 0,
      description: "Acompanhamentos finalizados.",
      path: "/professional/patients?tracking=ended",
    },
    {
      label: "Solicitações pendentes",
      value: summary?.pendingRequests ?? 0,
      description: "Pedidos de acesso aguardando resposta.",
      path: "/professional/patients?authorization=pending",
    },
    {
      label: "Revisões pendentes",
      value: summary?.pendingReviews ?? 0,
      description: "Datas de revisão já alcançadas.",
      path: "/professional/patients?review=overdue",
    },
    {
      label: "Pesagens pendentes",
      value: summary?.pendingWeighings ?? 0,
      description:
        "Solicitações de pesagem vencidas. Consulte a prioridade ou as mensagens do paciente.",
    },
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {items.map(item => (
        <SummaryTile key={item.label} item={item} onOpen={setLocation} />
      ))}
    </div>
  );
}

function OperationalShortcuts({ resources }: { resources: string[] }) {
  const [, setLocation] = useLocation();
  const shortcuts = [
    {
      resource: "professional_portfolio",
      label: "Abrir carteira",
      description: "Localize pacientes, vínculos e acompanhamentos.",
      path: "/professional/patients",
      icon: UsersRound,
    },
    {
      resource: "professional_messages",
      label: "Abrir mensagens",
      description: "Consulte solicitações e conversas profissionais.",
      path: "/professional/messages",
      icon: MessageSquareText,
    },
    {
      resource: "professional_reports",
      label: "Abrir relatórios",
      description: "Acesse indicadores agregados e análises individuais.",
      path: "/professional/reports",
      icon: BarChart3,
    },
  ].filter(shortcut => resources.includes(shortcut.resource));

  if (!shortcuts.length) return null;
  return (
    <section aria-labelledby="operational-shortcuts-title" className="space-y-3">
      <div>
        <h2 id="operational-shortcuts-title" className="text-lg font-semibold">
          Atalhos operacionais
        </h2>
        <p className="text-sm text-muted-foreground">
          Acesse áreas secundárias sem tirar o foco das prioridades de hoje.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {shortcuts.map(shortcut => {
          const Icon = shortcut.icon;
          return (
            <Button
              key={shortcut.path}
              variant="outline"
              className="h-auto min-h-20 justify-start whitespace-normal p-4 text-left"
              onClick={() => setLocation(shortcut.path)}
            >
              <Icon className="h-5 w-5 shrink-0" />
              <span>
                <strong className="block">{shortcut.label}</strong>
                <span className="mt-1 block text-xs font-normal text-muted-foreground">
                  {shortcut.description}
                </span>
              </span>
            </Button>
          );
        })}
      </div>
    </section>
  );
}

export default function ProfessionalHome() {
  const [location, setLocation] = useLocation();
  const entitlements =
    trpc.professionalRecord.settings.entitlements.useQuery(undefined, {
      retry: false,
      staleTime: 30_000,
      refetchOnWindowFocus: true,
    });

  if (entitlements.isLoading) {
    return (
      <ProfessionalPage>
        <ProfessionalLoadingState label="Carregando capacidades profissionais..." />
      </ProfessionalPage>
    );
  }
  if (entitlements.isError || !entitlements.data?.allowed) {
    return (
      <ProfessionalPage>
        <ProfessionalAsyncState
          title="Não foi possível confirmar as capacidades do início"
          description="O conteúdo profissional permanece protegido. Tente novamente antes de continuar."
          onRetry={() => void entitlements.refetch()}
        />
      </ProfessionalPage>
    );
  }

  const resources = entitlements.data.enabledResources;
  const hasAiAssistance = resources.includes("professional_ai_assistance");
  const hasPortfolio = resources.includes("professional_portfolio");
  const showAllPriorities =
    new URLSearchParams(location.split("?")[1] ?? "").get("priorities") ===
    "all";

  return (
    <ProfessionalPage>
      <ProfessionalPageHeader
        title={showAllPriorities ? "Todas as prioridades" : "Prioridades de hoje"}
        description="Comece pelos pacientes com pendências objetivas e depois consulte o resumo da carteira. A lista não cria critérios clínicos novos."
        actions={
          hasPortfolio ? (
            <Button onClick={() => setLocation("/professional/patients")}>
              <UsersRound className="h-4 w-4" />
              Ver carteira
            </Button>
          ) : undefined
        }
      />
      <ProfessionalSplitLayout
        aside={
          hasAiAssistance ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <BellRing className="h-4 w-4" />
                  Como esta fila é formada
                </CardTitle>
                <CardDescription>
                  Usa somente alertas e solicitações operacionais já registrados no sistema.
                </CardDescription>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                Sem registros, pesagem pendente, revisão de meta, solicitação sem resposta ou registro marcado para revisão.
              </CardContent>
            </Card>
          ) : null
        }
      >
        <section aria-labelledby="priority-list-title" className="space-y-3">
          <h2 id="priority-list-title" className="text-lg font-semibold">
            {showAllPriorities
              ? "Fila operacional completa"
              : "Pacientes que precisam de atenção operacional"}
          </h2>
          <PrioritiesPanel
            enabled={hasAiAssistance}
            showAll={showAllPriorities}
          />
        </section>
      </ProfessionalSplitLayout>
      <section aria-labelledby="portfolio-summary-title" className="space-y-3">
        <div>
          <h2 id="portfolio-summary-title" className="text-lg font-semibold">
            Resumo da carteira
          </h2>
          <p className="text-sm text-muted-foreground">
            Indicadores compactos, sem carregar relatórios individuais.
          </p>
        </div>
        <PortfolioSummary enabled={hasPortfolio} />
      </section>
      <OperationalShortcuts resources={resources} />
    </ProfessionalPage>
  );
}
