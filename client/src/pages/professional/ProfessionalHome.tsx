import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ProfessionalAsyncState,
  ProfessionalLoadingState,
  ProfessionalPage,
  ProfessionalPageHeader,
  ProfessionalSplitLayout,
  ProfessionalStatusBadge,
} from "@/components/professional/ProfessionalUi";
import { professionalPatientPath } from "@/lib/professionalRoutes";
import { trpc } from "@/lib/trpc";
import { ArrowRight, BellRing, UsersRound } from "lucide-react";
import React from "react";
import { useLocation } from "wouter";

function formatPriorityDate(value: number | null | undefined) {
  if (!value) return "Atualização não informada";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function priorityDestination(item: any) {
  const signals = (item.signals ?? []) as Array<{ type?: string; key?: string }>;
  const kinds = signals.map(signal => signal.type ?? signal.key ?? "");
  if (kinds.some(kind => kind.includes("goal"))) {
    return professionalPatientPath(item.patientId, "goals");
  }
  if (kinds.some(kind => kind.includes("food") || kind.includes("record"))) {
    return professionalPatientPath(item.patientId, "reports");
  }
  if (
    kinds.some(
      kind =>
        kind.includes("weigh") ||
        kind.includes("request") ||
        kind.includes("message")
    )
  ) {
    return professionalPatientPath(item.patientId, "messages");
  }
  return professionalPatientPath(item.patientId);
}

function PrioritiesPanel() {
  const [, setLocation] = useLocation();
  const query = trpc.professionalRecord.ai.priorities.useQuery(
    { limit: 10 },
    { retry: false, refetchOnWindowFocus: true, refetchInterval: 30_000 }
  );

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
  const priorities = query.data ?? [];
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
      {priorities.map((item: any) => (
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
              {(item.signals ?? [])
                .slice(0, 3)
                .map((signal: any) => signal.label)
                .join(", ")}
            </p>
            {(item.signals ?? [])[0]?.suggestedAction ? (
              <p className="mt-1 text-sm">
                Ação sugerida: {item.signals[0].suggestedAction}
              </p>
            ) : null}
            <p className="mt-2 text-xs text-muted-foreground">
              Atualizado em {formatPriorityDate(item.updatedAt)}
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => setLocation(priorityDestination(item))}
          >
            Revisar paciente
            <ArrowRight className="h-4 w-4" />
          </Button>
        </article>
      ))}
    </div>
  );
}

function PortfolioSummary() {
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
    { retry: false, refetchOnWindowFocus: true, refetchInterval: 30_000 }
  );

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
  const summary = query.data?.summary;
  const items = [
    ["Ativos", summary?.active ?? 0, "tracking=active"],
    ["Pausados", summary?.paused ?? 0, "tracking=paused"],
    ["Encerrados", summary?.ended ?? 0, "tracking=ended"],
    [
      "Solicitações pendentes",
      summary?.pendingRequests ?? 0,
      "authorization=pending",
    ],
    ["Revisões pendentes", summary?.pendingReviews ?? 0, "review=overdue"],
    [
      "Pesagens pendentes",
      summary?.pendingWeighings ?? 0,
      "authorization=approved",
    ],
  ] as const;
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {items.map(([label, value, queryString]) => (
        <button
          key={label}
          type="button"
          className="min-w-0 rounded-2xl border bg-card p-4 text-left shadow-sm transition hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => setLocation(`/professional/patients?${queryString}`)}
        >
          <span className="text-sm text-muted-foreground">{label}</span>
          <strong className="mt-1 block text-2xl">{value}</strong>
        </button>
      ))}
    </div>
  );
}

export default function ProfessionalHome() {
  const [, setLocation] = useLocation();
  return (
    <ProfessionalPage>
      <ProfessionalPageHeader
        title="Prioridades de hoje"
        description="Comece pelos pacientes com pendências objetivas e depois consulte o resumo da carteira. A lista não cria critérios clínicos novos."
        actions={
          <Button onClick={() => setLocation("/professional/patients")}>
            <UsersRound className="h-4 w-4" />
            Ver carteira
          </Button>
        }
      />
      <ProfessionalSplitLayout
        aside={
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
        }
      >
        <section aria-labelledby="priority-list-title" className="space-y-3">
          <h2 id="priority-list-title" className="text-lg font-semibold">
            Pacientes que precisam de atenção operacional
          </h2>
          <PrioritiesPanel />
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
        <PortfolioSummary />
      </section>
    </ProfessionalPage>
  );
}
