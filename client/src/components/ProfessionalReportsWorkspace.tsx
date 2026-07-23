import ProfessionalOperationalAlertsPanel from "@/components/ProfessionalOperationalAlertsPanel";
import { useProfessionalWorkspace } from "@/components/ProfessionalLayout";
import ProfessionalAiAssistant from "@/components/professional/ProfessionalAiAssistant";
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
import { CalendarDays, UsersRound } from "lucide-react";
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

function AggregateReports() {
  const [, setLocation] = useLocation();
  const [startDate, setStartDate] = useState(() =>
    dateKey(new Date(Date.now() - 29 * 86_400_000))
  );
  const [endDate, setEndDate] = useState(() => dateKey(new Date()));
  const validRange =
    startDate <= endDate && daysBetween(startDate, endDate) <= 90;
  const query = trpc.professionalRecord.portfolioReport.useQuery(
    {
      search: "",
      authorizationStatus: "all",
      trackingStatus: "all",
      activity: "all",
      nextReview: "all",
      page: 1,
      pageSize: 20,
      reportStartDate: startDate,
      reportEndDate: endDate,
      includeHistoricalActivity: false,
    },
    {
      enabled: validRange,
      retry: false,
      refetchOnWindowFocus: true,
      refetchInterval: 30_000,
    }
  );
  const summary = query.data?.summary;
  const cards = useMemo(
    () => [
      [
        "Ativos com registros no período",
        summary?.activeWithRecentRecords,
        "/professional/patients?authorization=approved&tracking=active",
      ],
      [
        "Sem registros no período",
        summary?.withoutRecentActivity,
        "/professional/patients?authorization=approved&activity=inactive",
      ],
      [
        "Revisões pendentes",
        summary?.pendingReviews,
        "/professional/patients?authorization=approved&review=overdue",
      ],
      [
        "Pesagens pendentes",
        summary?.pendingWeighings,
        "/professional/patients?authorization=approved",
      ],
    ],
    [summary]
  );

  return (
    <div className="space-y-6">
      <ProfessionalPageHeader
        title="Relatórios da carteira"
        description="Visão agregada sem seleção de paciente e sem carregar bundles nutricionais individuais."
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
          <p role="alert" className="text-sm text-destructive md:col-span-2 lg:col-span-3">
            Escolha um período válido de até 90 dias.
          </p>
        ) : null}
      </section>

      {query.isLoading ? (
        <ProfessionalLoadingState label="Carregando indicadores agregados..." />
      ) : query.isError ? (
        <ProfessionalAsyncState
          title="Não foi possível carregar os indicadores"
          description="A carteira e as demais áreas continuam disponíveis."
          onRetry={() => void query.refetch()}
        />
      ) : query.data ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {cards.map(([label, value, route]) => (
              <Card key={String(label)}>
                <CardHeader className="pb-2">
                  <CardDescription>{label}</CardDescription>
                  <CardTitle className="text-3xl">
                    {value === null || value === undefined ? "Não informado" : value}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setLocation(String(route))}
                  >
                    Ver pacientes
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UsersRound className="h-5 w-5" />
                Distribuição do acompanhamento
              </CardTitle>
              <CardDescription>
                A situação do acompanhamento é contada separadamente da autorização.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {[
                ["Ativos", summary?.active],
                ["Pausados", summary?.paused],
                ["Encerrados", summary?.ended],
                ["Não iniciados", summary?.notStarted],
              ].map(([label, value]) => (
                <div key={String(label)} className="rounded-xl border p-3">
                  <p className="text-sm text-muted-foreground">{label}</p>
                  <p className="mt-1 text-2xl font-semibold">
                    {value === null || value === undefined ? "Não informado" : value}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      ) : null}

      <ProfessionalOperationalAlertsPanel />
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
    </div>
  );
}

export default function ProfessionalReportsWorkspace() {
  const { selectedPatient } = useProfessionalWorkspace();
  return selectedPatient ? (
    <IndividualReport patient={selectedPatient} />
  ) : (
    <AggregateReports />
  );
}
