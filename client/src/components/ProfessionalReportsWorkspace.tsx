import ProfessionalOperationalAlertsPanel from "@/components/ProfessionalOperationalAlertsPanel";
import { useProfessionalWorkspace } from "@/components/ProfessionalLayout";
import ProfessionalAiAssistant from "@/components/professional/ProfessionalAiAssistant";
import ProfessionalReportRecoveryGate from "@/components/professional/ProfessionalReportRecoveryGate";
import {
  ProfessionalAsyncState,
  ProfessionalLoadingState,
  ProfessionalPageHeader,
  ProfessionalSplitLayout,
} from "@/components/professional/ProfessionalUi";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import ReportsExperience from "@/features/reports/ReportsExperience";
import { trpc } from "@/lib/trpc";
import { CalendarDays } from "lucide-react";
import React, { useMemo, useState } from "react";
import { useLocation } from "wouter";

function dateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}
function daysBetween(start: string, end: string) {
  const startDate = new Date(`${start}T12:00:00Z`);
  const endDate = new Date(`${end}T12:00:00Z`);
  return Math.floor((endDate.getTime() - startDate.getTime()) / 86_400_000) + 1;
}

export function professionalPortfolioDetailPath(
  filters: Record<string, string | undefined>
) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  const query = params.toString();
  return `/professional/patients${query ? `?${query}` : ""}`;
}

type AggregateCard = {
  label: string;
  value: number | null | undefined;
  description: string;
  route: string;
};

function AggregateMetricCards({
  cards,
  onOpen,
}: {
  cards: AggregateCard[];
  onOpen: (route: string) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map(card => (
        <Card key={card.label}>
          <CardHeader className="pb-2">
            <CardDescription>{card.label}</CardDescription>
            <CardTitle className="text-3xl">
              {card.value === null || card.value === undefined
                ? "Não informado"
                : card.value}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">{card.description}</p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onOpen(card.route)}
            >
              Ver pacientes
            </Button>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function AggregateReports() {
  const [, setLocation] = useLocation();
  const [startDate, setStartDate] = useState(() =>
    dateKey(new Date(Date.now() - 29 * 86_400_000))
  );
  const [endDate, setEndDate] = useState(() => dateKey(new Date()));
  const validRange =
    startDate <= endDate && daysBetween(startDate, endDate) <= 90;
  const queryOptions = {
    retry: false,
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
  } as const;
  const activityQuery = trpc.professionalRecord.portfolioReport.useQuery(
    {
      block: "activity",
      reportStartDate: startDate,
      reportEndDate: endDate,
    },
    { ...queryOptions, enabled: validRange }
  );
  const scheduleQuery = trpc.professionalRecord.portfolioReport.useQuery(
    { block: "schedule" },
    queryOptions
  );
  const trackingQuery = trpc.professionalRecord.portfolioReport.useQuery(
    { block: "tracking" },
    queryOptions
  );
  const activitySummary = activityQuery.data?.summary;
  const scheduleSummary = scheduleQuery.data?.summary;
  const trackingSummary = trackingQuery.data?.summary;
  const activityCards = useMemo<AggregateCard[]>(
    () => [
      {
        label: "Ativos com registros no período",
        value: activitySummary?.activeWithRecentRecords,
        description:
          "Acompanhamentos ativos com ao menos uma refeição confirmada no período selecionado.",
        route: professionalPortfolioDetailPath({
          authorization: "approved",
          tracking: "active",
          records: "with_records",
          reportStart: startDate,
          reportEnd: endDate,
        }),
      },
      {
        label: "Sem registros no período",
        value: activitySummary?.withoutRecentActivity,
        description:
          "Autorizações aprovadas sem refeição confirmada no período selecionado.",
        route: professionalPortfolioDetailPath({
          authorization: "approved",
          records: "without_records",
          reportStart: startDate,
          reportEnd: endDate,
        }),
      },
    ],
    [activitySummary, endDate, startDate]
  );
  const scheduleCards = useMemo<AggregateCard[]>(
    () => [
      {
        label: "Revisões pendentes",
        value: scheduleSummary?.pendingReviews,
        description:
          "Pacientes com próxima revisão registrada e vencida até agora.",
        route: professionalPortfolioDetailPath({
          authorization: "approved",
          review: "overdue",
        }),
      },
      {
        label: "Pesagens pendentes",
        value: scheduleSummary?.pendingWeighings,
        description:
          "Pacientes com próxima pesagem registrada e vencida até agora.",
        route: professionalPortfolioDetailPath({
          authorization: "approved",
          weighing: "overdue",
        }),
      },
    ],
    [scheduleSummary]
  );
  const trackingDistribution = useMemo(
    () => [
      {
        label: "Ativos",
        value: trackingSummary?.active,
        route: professionalPortfolioDetailPath({
          authorization: "approved",
          tracking: "active",
        }),
      },
      {
        label: "Pausados",
        value: trackingSummary?.paused,
        route: professionalPortfolioDetailPath({
          authorization: "approved",
          tracking: "paused",
        }),
      },
      {
        label: "Encerrados",
        value: trackingSummary?.ended,
        route: professionalPortfolioDetailPath({
          authorization: "approved",
          tracking: "ended",
        }),
      },
      {
        label: "Não iniciados",
        value: trackingSummary?.notStarted,
        route: professionalPortfolioDetailPath({
          authorization: "approved",
          tracking: "not_started",
        }),
      },
    ],
    [trackingSummary]
  );

  return (
    <div className="space-y-6">
      <ProfessionalPageHeader
        title="Relatórios da carteira"
        description="Visão agregada sem seleção de paciente e sem carregar bundles nutricionais individuais. As prioridades globais ficam centralizadas no Início."
      />
      <section className="grid gap-4 rounded-2xl border bg-card p-4 md:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end">
        <label className="grid gap-1 text-sm">
          <span className="font-medium">Início do período</span>
          <input
            className="h-10 rounded-md border bg-background px-3"
            type="date"
            value={startDate}
            max={endDate}
            onChange={event => setStartDate(event.target.value)}
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-medium">Fim do período</span>
          <input
            className="h-10 rounded-md border bg-background px-3"
            type="date"
            value={endDate}
            min={startDate}
            onChange={event => setEndDate(event.target.value)}
          />
        </label>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <CalendarDays className="h-4 w-4" />
          {validRange ? `${daysBetween(startDate, endDate)} dias` : "Até 90 dias"}
        </div>
        {!validRange ? (
          <p
            role="alert"
            className="text-sm text-destructive md:col-span-2 lg:col-span-3"
          >
            Escolha um período válido de até 90 dias.
          </p>
        ) : null}
      </section>

      <section aria-labelledby="report-activity-title" className="space-y-3">
        <div>
          <h2 id="report-activity-title" className="text-lg font-semibold">
            Registros no período
          </h2>
          <p className="text-sm text-muted-foreground">
            Contagem pelo calendário local de cada paciente autorizado.
          </p>
        </div>
        {!validRange ? (
          <ProfessionalAsyncState
            variant="panel"
            icon="empty"
            title="Período de registros indisponível"
            description="Ajuste o início e o fim para carregar somente este bloco. Os demais indicadores continuam disponíveis."
          />
        ) : activityQuery.isLoading ? (
          <ProfessionalLoadingState label="Carregando registros do período..." />
        ) : activityQuery.isError ? (
          <ProfessionalAsyncState
            variant="panel"
            title="Não foi possível carregar os registros do período"
            description="Revisões, pesagens e distribuição continuam disponíveis."
            onRetry={() => void activityQuery.refetch()}
          />
        ) : activityQuery.data ? (
          <AggregateMetricCards cards={activityCards} onOpen={setLocation} />
        ) : null}
      </section>

      <section aria-labelledby="report-schedule-title" className="space-y-3">
        <div>
          <h2 id="report-schedule-title" className="text-lg font-semibold">
            Agenda operacional
          </h2>
          <p className="text-sm text-muted-foreground">
            Revisões e pesagens vencidas no acompanhamento canônico.
          </p>
        </div>
        {scheduleQuery.isLoading ? (
          <ProfessionalLoadingState label="Carregando agenda operacional..." />
        ) : scheduleQuery.isError ? (
          <ProfessionalAsyncState
            variant="panel"
            title="Não foi possível carregar a agenda operacional"
            description="Os indicadores de registros e acompanhamento continuam disponíveis."
            onRetry={() => void scheduleQuery.refetch()}
          />
        ) : scheduleQuery.data ? (
          <AggregateMetricCards cards={scheduleCards} onOpen={setLocation} />
        ) : null}
      </section>

      <section aria-labelledby="report-tracking-title" className="space-y-3">
        <div>
          <h2 id="report-tracking-title" className="text-lg font-semibold">
            Distribuição do acompanhamento
          </h2>
          <p className="text-sm text-muted-foreground">
            A situação do acompanhamento é contada separadamente da autorização.
          </p>
        </div>
        {trackingQuery.isLoading ? (
          <ProfessionalLoadingState label="Carregando distribuição do acompanhamento..." />
        ) : trackingQuery.isError ? (
          <ProfessionalAsyncState
            variant="panel"
            title="Não foi possível carregar a distribuição"
            description="Os indicadores de registros e agenda continuam disponíveis."
            onRetry={() => void trackingQuery.refetch()}
          />
        ) : trackingQuery.data ? (
          <Card>
            <CardContent className="grid gap-3 pt-6 sm:grid-cols-2 xl:grid-cols-4">
              {trackingDistribution.map(item => (
                <div key={item.label} className="rounded-xl border p-3">
                  <p className="text-sm text-muted-foreground">{item.label}</p>
                  <p className="mt-1 text-2xl font-semibold">
                    {item.value === null || item.value === undefined
                      ? "Não informado"
                      : item.value}
                  </p>
                  <Button
                    className="mt-3"
                    size="sm"
                    variant="ghost"
                    onClick={() => setLocation(item.route)}
                  >
                    Ver pacientes
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        ) : null}
      </section>
    </div>
  );
}

function IndividualReport({
  patient,
}: {
  patient: { patientId: number; displayName: string };
}) {
  const [range, setRange] = useState<{ start: string; end: string } | null>(null);
  const fallbackRange = useMemo(
    () => ({
      start: dateKey(new Date(Date.now() - 6 * 86_400_000)),
      end: dateKey(new Date()),
    }),
    []
  );
  const activeRange = range ?? fallbackRange;
  return (
    <div className="space-y-6">
      <ProfessionalPageHeader
        eyebrow="Relatório individual"
        title={`Análise de ${patient.displayName}`}
        description="O período, os alertas e a assistência usam o mesmo paciente autorizado e o timezone efetivo do dono dos dados."
      />
      <ProfessionalReportRecoveryGate
        patientId={patient.patientId}
        range={activeRange}
      >
        <>
          <ProfessionalSplitLayout
            aside={
              <ProfessionalOperationalAlertsPanel
                patientId={patient.patientId}
                periodRange={activeRange}
              />
            }
          >
            <ReportsExperience
              context="professional"
              subjectUserId={patient.patientId}
              onRangeChange={setRange}
            />
          </ProfessionalSplitLayout>
          <ProfessionalAiAssistant patient={patient} periodRange={activeRange} />
        </>
      </ProfessionalReportRecoveryGate>
    </div>
  );
}

export default function ProfessionalReportsWorkspace() {
  const { selectedPatient } = useProfessionalWorkspace();
  return selectedPatient ? (
    <IndividualReport
      key={selectedPatient.patientId}
      patient={selectedPatient}
    />
  ) : (
    <AggregateReports />
  );
}
