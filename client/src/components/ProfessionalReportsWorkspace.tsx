import PageIntro from "@/components/PageIntro";
import ProfessionalOperationalAlertsPanel from "@/components/ProfessionalOperationalAlertsPanel";
import { useProfessionalWorkspace } from "@/components/ProfessionalLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import ReportsExperience from "@/features/reports/ReportsExperience";
import { trpc } from "@/lib/trpc";
import { AlertCircle, BarChart3, ChevronLeft, ChevronRight, RefreshCw, UsersRound } from "lucide-react";
import React, { useState } from "react";
import { useLocation } from "wouter";

const PAGE_SIZE = 20;

function patientLabel(item: { patientUserId: number; patientName: string | null; patientEmail: string | null }) {
  return item.patientName ?? item.patientEmail ?? `Paciente ${item.patientUserId}`;
}

export default function ProfessionalReportsWorkspace() {
  const { selectedPatient, selectPatient, clearPatient } = useProfessionalWorkspace();
  const [, setLocation] = useLocation();
  const [page, setPage] = useState(1);
  const portfolio = trpc.nutrition.professionals.portfolio.useQuery({
    search: "",
    authorizationStatus: "approved",
    trackingStatus: "all",
    activity: "all",
    nextReview: "all",
    page,
    pageSize: PAGE_SIZE,
  }, { retry: false, refetchOnWindowFocus: true, refetchInterval: 30_000 });

  const summary = portfolio.data?.summary;
  const cards = [
    ["Ativos com registros no período", summary?.activeWithRecentRecords ?? 0, "Pessoas ativas com refeição confirmada nos últimos três dias.", "/professional/patients?authorization=approved&tracking=active&activity=recent"],
    ["Sem registros no período", summary?.withoutRecentActivity ?? 0, "Pessoas sem refeição confirmada nos últimos três dias.", "/professional/patients?authorization=approved&activity=inactive"],
    ["Revisões pendentes", summary?.pendingReviews ?? 0, "Revisões cuja data prevista já chegou.", "/professional/patients?authorization=approved&review=overdue"],
    ["Pesagens pendentes", summary?.pendingWeighings ?? 0, "Pesagens cuja data prevista já chegou.", "/professional/follow-up"],
  ] as const;

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <PageIntro
        eyebrow="Contexto profissional"
        title="Relatórios profissionais"
        description="Analise uma pessoa por vez com os mesmos contratos canônicos da Área do Paciente e acompanhe a situação agregada da carteira sem carregar todos os relatórios individuais."
      />

      <section aria-labelledby="portfolio-report-title" className="space-y-4">
        <div>
          <h2 id="portfolio-report-title" className="text-xl font-semibold tracking-tight">Visão da carteira</h2>
          <p className="text-sm text-muted-foreground">Indicadores operacionais agregados; detalhes pessoais aparecem somente depois da seleção explícita.</p>
        </div>
        {portfolio.isLoading ? <div role="status" className="rounded-2xl border p-6 text-sm text-muted-foreground">Carregando indicadores da carteira...</div> : null}
        {portfolio.isError ? <div role="alert" className="flex items-center justify-between gap-3 rounded-2xl border border-destructive/40 p-5"><span className="flex items-center gap-2 text-sm"><AlertCircle className="h-4 w-4" />Não foi possível carregar os indicadores. A carteira básica continua disponível.</span><Button variant="outline" onClick={() => void portfolio.refetch()}><RefreshCw className="h-4 w-4" />Tentar novamente</Button></div> : null}
        {portfolio.data ? <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{cards.map(([label, value, description, route]) => <Card key={label}><CardHeader className="pb-2"><CardDescription>{label}</CardDescription><CardTitle className="text-3xl">{value}</CardTitle></CardHeader><CardContent className="space-y-3 text-xs text-muted-foreground"><p>{description}</p><Button size="sm" variant="outline" onClick={() => setLocation(route)}>Ver pacientes</Button></CardContent></Card>)}</div>
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><UsersRound className="h-5 w-5" />Distribuição do acompanhamento</CardTitle><CardDescription>Estados operacionais são contados separadamente dos estados de autorização.</CardDescription></CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-4">{[["Ativos", summary?.active], ["Pausados", summary?.paused], ["Encerrados", summary?.ended], ["Não iniciados", summary?.notStarted]].map(([label, value]) => <div key={String(label)} className="rounded-xl border p-3"><p className="text-sm text-muted-foreground">{label}</p><p className="text-2xl font-semibold">{value ?? 0}</p></div>)}</CardContent>
          </Card>
        </> : null}
      </section>

      <ProfessionalOperationalAlertsPanel />

      <section aria-labelledby="individual-report-title" className="space-y-5">
        <Card>
          <CardHeader><CardTitle id="individual-report-title" className="flex items-center gap-2"><BarChart3 className="h-5 w-5" />Relatório individual</CardTitle><CardDescription>O paciente e o período permanecem identificados durante toda a análise.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <label className="grid gap-2 text-sm font-medium">Pessoa acompanhada
              <select aria-label="Pessoa acompanhada" className="h-11 rounded-md border bg-background px-3 font-normal" value={selectedPatient?.patientId ?? ""} onChange={event => {
                const patientId = Number(event.target.value);
                const item = portfolio.data?.items.find(candidate => candidate.patientUserId === patientId);
                if (!item) { clearPatient(); return; }
                selectPatient({ patientId, displayName: patientLabel(item) });
              }}>
                <option value="">Selecione uma pessoa autorizada</option>
                {portfolio.data?.items.map(item => <option key={item.authorizationId} value={item.patientUserId}>{patientLabel(item)}</option>)}
              </select>
            </label>
            {portfolio.data && portfolio.data.pagination.totalPages > 1 ? <div className="flex items-center justify-between"><p className="text-xs text-muted-foreground">Página {portfolio.data.pagination.page} de {portfolio.data.pagination.totalPages}</p><div className="flex gap-2"><Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(current => current - 1)}><ChevronLeft className="h-4 w-4" />Anterior</Button><Button size="sm" variant="outline" disabled={page >= portfolio.data.pagination.totalPages} onClick={() => setPage(current => current + 1)}>Próxima<ChevronRight className="h-4 w-4" /></Button></div></div> : null}
            {selectedPatient ? <p className="rounded-xl bg-muted px-4 py-3 text-sm"><strong>Paciente:</strong> {selectedPatient.displayName}</p> : null}
          </CardContent>
        </Card>
        {selectedPatient ? <ReportsExperience context="professional" subjectUserId={selectedPatient.patientId} /> : <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">Selecione uma pessoa autorizada para carregar o relatório individual.</CardContent></Card>}
      </section>
    </div>
  );
}
