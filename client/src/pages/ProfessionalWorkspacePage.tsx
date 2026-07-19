import ProfessionalLayout, { useProfessionalWorkspace } from "@/components/ProfessionalLayout";
import PageIntro from "@/components/PageIntro";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { AlertCircle, CalendarClock, ChevronLeft, ChevronRight, RefreshCw, Search, UsersRound } from "lucide-react";
import React, { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";

const dateFormatter = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });
const authorizationLabels: Record<string, string> = { pending: "Pendente", approved: "Aprovada", rejected: "Recusada", revoked: "Revogada" };
const trackingLabels: Record<string, string> = { active: "Ativo", paused: "Pausado", ended: "Encerrado", not_started: "Não iniciado" };

type Filters = {
  search: string;
  authorizationStatus: "all" | "pending" | "approved" | "rejected" | "revoked";
  trackingStatus: "all" | "not_started" | "active" | "paused" | "ended";
  activity: "all" | "recent" | "inactive" | "unavailable";
  nextReview: "all" | "scheduled" | "due_soon" | "overdue" | "unavailable";
  page: number;
  pageSize: number;
};
const initialFilters: Filters = { search: "", authorizationStatus: "all", trackingStatus: "all", activity: "all", nextReview: "all", page: 1, pageSize: 20 };

function filtersFromUrl(): Filters {
  if (typeof window === "undefined") return initialFilters;
  const params = new URLSearchParams(window.location.search);
  const page = Number(params.get("page"));
  const allowed = <T extends string>(value: string | null, values: readonly T[], fallback: T) => value && values.includes(value as T) ? value as T : fallback;
  return {
    search: params.get("search") ?? "",
    authorizationStatus: allowed(params.get("authorization"), ["all", "pending", "approved", "rejected", "revoked"] as const, "all"),
    trackingStatus: allowed(params.get("tracking"), ["all", "not_started", "active", "paused", "ended"] as const, "all"),
    activity: allowed(params.get("activity"), ["all", "recent", "inactive", "unavailable"] as const, "all"),
    nextReview: allowed(params.get("review"), ["all", "scheduled", "due_soon", "overdue", "unavailable"] as const, "all"),
    page: Number.isInteger(page) && page > 0 ? page : 1,
    pageSize: 20,
  };
}

function usePortfolioFilters(compact = false) {
  const [filters, setFilters] = useState<Filters>(() => compact ? { ...initialFilters, pageSize: 10 } : filtersFromUrl());
  useEffect(() => {
    if (compact || typeof window === "undefined") return;
    const params = new URLSearchParams();
    if (filters.search) params.set("search", filters.search);
    if (filters.authorizationStatus !== "all") params.set("authorization", filters.authorizationStatus);
    if (filters.trackingStatus !== "all") params.set("tracking", filters.trackingStatus);
    if (filters.activity !== "all") params.set("activity", filters.activity);
    if (filters.nextReview !== "all") params.set("review", filters.nextReview);
    if (filters.page > 1) params.set("page", String(filters.page));
    const query = params.toString();
    window.history.replaceState({}, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
  }, [compact, filters]);
  return [filters, setFilters] as const;
}

function formatDate(value: number | null | undefined) {
  return value ? dateFormatter.format(new Date(value)) : "Não informado";
}

function PortfolioState({ filters, setFilters, compact = false }: { filters: Filters; setFilters: React.Dispatch<React.SetStateAction<Filters>>; compact?: boolean }) {
  const [, setLocation] = useLocation();
  const { selectPatient } = useProfessionalWorkspace();
  const utils = trpc.useUtils();
  const [openingPatientId, setOpeningPatientId] = useState<number | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const query = trpc.nutrition.professionals.portfolio.useQuery(filters, { retry: false, refetchOnWindowFocus: true, refetchInterval: 30_000 });
  if (query.isLoading) return <div role="status" className="rounded-2xl border bg-card p-8 text-sm text-muted-foreground">Carregando carteira profissional...</div>;
  if (query.isError) return <div role="alert" className="rounded-2xl border bg-card p-8"><AlertCircle className="h-8 w-8 text-destructive" /><h2 className="mt-3 font-semibold">Não foi possível carregar a carteira</h2><Button className="mt-4" variant="outline" onClick={() => void query.refetch()}><RefreshCw className="h-4 w-4" />Tentar novamente</Button></div>;
  const data = query.data;
  if (!data) return null;
  return <>
    {!compact && <div className="grid gap-3 md:grid-cols-5">
      <label className="relative"><span className="sr-only">Buscar paciente</span><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input className="pl-9" value={filters.search} onChange={event => setFilters(current => ({ ...current, search: event.target.value, page: 1 }))} placeholder="Nome, e-mail ou identificador" /></label>
      <select aria-label="Filtrar autorização" className="h-10 rounded-md border bg-background px-3 text-sm" value={filters.authorizationStatus} onChange={event => setFilters(current => ({ ...current, authorizationStatus: event.target.value as Filters["authorizationStatus"], page: 1 }))}><option value="all">Todas as autorizações</option><option value="pending">Pendentes</option><option value="approved">Aprovadas</option><option value="rejected">Recusadas</option><option value="revoked">Revogadas</option></select>
      <select aria-label="Filtrar acompanhamento" className="h-10 rounded-md border bg-background px-3 text-sm" value={filters.trackingStatus} onChange={event => setFilters(current => ({ ...current, trackingStatus: event.target.value as Filters["trackingStatus"], page: 1 }))}><option value="all">Todos os acompanhamentos</option><option value="not_started">Não iniciados</option><option value="active">Ativos</option><option value="paused">Pausados</option><option value="ended">Encerrados</option></select>
      <select aria-label="Filtrar atividade" className="h-10 rounded-md border bg-background px-3 text-sm" value={filters.activity} onChange={event => setFilters(current => ({ ...current, activity: event.target.value as Filters["activity"], page: 1 }))}><option value="all">Qualquer atividade</option><option value="recent">Atividade recente</option><option value="inactive">Sem atividade recente</option><option value="unavailable">Atividade indisponível</option></select>
      <select aria-label="Filtrar próxima revisão" className="h-10 rounded-md border bg-background px-3 text-sm" value={filters.nextReview} onChange={event => setFilters(current => ({ ...current, nextReview: event.target.value as Filters["nextReview"], page: 1 }))}><option value="all">Qualquer revisão</option><option value="scheduled">Revisão agendada</option><option value="due_soon">Próximos 7 dias</option><option value="overdue">Revisão atrasada</option><option value="unavailable">Sem revisão agendada</option></select>
    </div>}
    {openError && <div role="alert" className="rounded-md border border-destructive/40 p-3 text-sm">{openError}</div>}
    {data.items.length === 0 ? <Card><CardContent className="flex flex-col items-center py-12 text-center"><UsersRound className="h-10 w-10 text-muted-foreground" /><h2 className="mt-4 font-semibold">Nenhum paciente encontrado</h2></CardContent></Card> : <div className="grid gap-3">{data.items.map(item => {
      const accessible = item.authorizationStatus === "approved";
      const displayName = item.patientName ?? item.patientEmail ?? `Paciente ${item.patientUserId}`;
      return <Card key={item.authorizationId}><CardContent className="grid gap-4 p-5 lg:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))_auto] lg:items-center">
        <div className="min-w-0"><p className="truncate font-semibold">{displayName}</p><p className="truncate text-sm text-muted-foreground">{item.patientEmail ?? `Identificador ${item.patientUserId}`}</p></div>
        <div><p className="text-xs text-muted-foreground">Autorização</p><p className="text-sm font-medium">{authorizationLabels[item.authorizationStatus]}</p></div>
        <div><p className="text-xs text-muted-foreground">Acompanhamento</p><p className="text-sm font-medium">{item.trackingStatus ? trackingLabels[item.trackingStatus] : "Não iniciado"}</p></div>
        <div><p className="text-xs text-muted-foreground">Última atividade</p><p className="text-sm font-medium">{formatDate(item.lastFoodActivityAt)}</p><p className="mt-1 text-xs text-muted-foreground">Próxima revisão: {formatDate(item.nextReviewAt)}</p></div>
        <Button disabled={!accessible || openingPatientId !== null} onClick={async () => { setOpenError(null); setOpeningPatientId(item.patientUserId); try { await utils.nutrition.professionals.patientTimeZone.fetch({ patientId: item.patientUserId, weekOffset: 0 }); selectPatient({ patientId: item.patientUserId, displayName }); setLocation(`/professional/follow-up${window.location.search}`); } catch { setOpenError("O acesso a este paciente não está mais disponível. A carteira foi atualizada."); await query.refetch(); } finally { setOpeningPatientId(null); } }}>{openingPatientId === item.patientUserId ? "Validando acesso..." : accessible ? "Abrir paciente" : "Aguardando acesso"}</Button>
      </CardContent></Card>;
    })}</div>}
    {!compact && data.pagination.totalPages > 1 && <div className="flex items-center justify-between"><p className="text-sm text-muted-foreground">Página {data.pagination.page} de {data.pagination.totalPages}</p><div className="flex gap-2"><Button variant="outline" disabled={filters.page <= 1} onClick={() => setFilters(current => ({ ...current, page: current.page - 1 }))}><ChevronLeft className="h-4 w-4" />Anterior</Button><Button variant="outline" disabled={filters.page >= data.pagination.totalPages} onClick={() => setFilters(current => ({ ...current, page: current.page + 1 }))}>Próxima<ChevronRight className="h-4 w-4" /></Button></div></div>}
  </>;
}

function ProfessionalHome() {
  const [, setLocation] = useLocation();
  const [filters, setFilters] = usePortfolioFilters(true);
  const query = trpc.nutrition.professionals.portfolio.useQuery(filters, { retry: false });
  const summary = query.data?.summary;
  const cards = [["Acompanhamentos ativos", summary?.active ?? 0], ["Pausados", summary?.paused ?? 0], ["Encerrados", summary?.ended ?? 0], ["Solicitações pendentes", summary?.pendingRequests ?? 0], ["Revisões pendentes", summary?.pendingReviews ?? 0], ["Pesagens pendentes", summary?.pendingWeighings ?? 0]];
  return <div className="mx-auto max-w-6xl space-y-6"><PageIntro title="Início profissional" description="Acompanhe a situação da carteira e abra rapidamente o contexto de cada paciente." /><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{cards.map(([label, value]) => <Card key={String(label)}><CardHeader className="pb-2"><CardDescription>{label}</CardDescription><CardTitle className="text-3xl">{value}</CardTitle></CardHeader></Card>)}</div><Button variant="outline" onClick={() => setLocation("/professional/patients")}>Ver carteira completa</Button><PortfolioState filters={filters} setFilters={setFilters} compact /></div>;
}

function PatientsPage() {
  const [filters, setFilters] = usePortfolioFilters(false);
  return <div className="mx-auto max-w-6xl space-y-6"><PageIntro title="Pacientes" description="Localize vínculos, acompanhe autorizações e filtre a carteira por situação operacional." /><PortfolioState filters={filters} setFilters={setFilters} /></div>;
}

type AssessmentDraft = { objective: string; weightKg: string; heightCm: string; routineAndSchedule: string; physicalActivity: string; foodPreferences: string; restrictionsAndAllergies: string; reportedDifficulties: string; relevantHabits: string; professionalObservations: string; nextReviewAt: string };
const emptyAssessment: AssessmentDraft = { objective: "", weightKg: "", heightCm: "", routineAndSchedule: "", physicalActivity: "", foodPreferences: "", restrictionsAndAllergies: "", reportedDifficulties: "", relevantHabits: "", professionalObservations: "", nextReviewAt: "" };

function FollowUpPage() {
  const { selectedPatient, clearPatient } = useProfessionalWorkspace();
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();
  const [assessment, setAssessment] = useState(emptyAssessment);
  const [note, setNote] = useState("");
  const [guidanceTitle, setGuidanceTitle] = useState("");
  const [guidance, setGuidance] = useState("");
  const [dirty, setDirty] = useState(false);
  const patientId = selectedPatient?.patientId ?? 0;
  const record = trpc.professionalRecord.get.useQuery({ patientId, page: 1, pageSize: 20 }, { enabled: patientId > 0, retry: false, refetchOnWindowFocus: true });
  const saveAssessment = trpc.professionalRecord.saveAssessment.useMutation({ onSuccess: async () => { setDirty(false); await utils.professionalRecord.get.invalidate(); } });
  const createNote = trpc.professionalRecord.createNote.useMutation({ onSuccess: async () => { setNote(""); await utils.professionalRecord.get.invalidate(); } });
  const createGuidance = trpc.professionalRecord.createGuidance.useMutation({ onSuccess: async () => { setGuidanceTitle(""); setGuidance(""); await utils.professionalRecord.get.invalidate(); } });
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);
  useEffect(() => {
    if (record.isError) { clearPatient(); setLocation("/professional/patients"); }
  }, [clearPatient, record.isError, setLocation]);
  const active = record.data?.patient.trackingStatus === "active";
  const latest = record.data?.latestAssessment;
  const field = (key: keyof AssessmentDraft, label: string, multiline = false) => <label className="grid gap-1 text-sm"><span className="font-medium">{label}</span>{multiline ? <textarea className="min-h-24 rounded-md border bg-background p-3" value={assessment[key]} onChange={event => { setAssessment(current => ({ ...current, [key]: event.target.value })); setDirty(true); }} /> : <Input value={assessment[key]} onChange={event => { setAssessment(current => ({ ...current, [key]: event.target.value })); setDirty(true); }} />}</label>;
  if (!selectedPatient) return <Card><CardContent className="py-12 text-center"><h2 className="font-semibold">Selecione um paciente</h2><p className="mt-2 text-sm text-muted-foreground">Abra um paciente pela carteira para acessar o prontuário.</p><Button className="mt-4" onClick={() => setLocation("/professional/patients")}>Ir para pacientes</Button></CardContent></Card>;
  if (record.isLoading) return <div role="status" className="rounded-2xl border bg-card p-8">Carregando prontuário...</div>;
  if (!record.data) return null;
  return <div className="mx-auto max-w-6xl space-y-6">
    <PageIntro title={`Prontuário de ${selectedPatient.displayName}`} description={`Autorização aprovada · Acompanhamento ${trackingLabels[record.data.patient.trackingStatus]}`} />
    {!active && <div role="status" className="rounded-md border bg-muted p-4 text-sm">Novas avaliações, anotações e orientações ficam bloqueadas enquanto o acompanhamento não estiver ativo.</div>}
    <div className="grid gap-6 xl:grid-cols-2">
      <Card><CardHeader><CardTitle>Avaliação nutricional</CardTitle><CardDescription>{latest ? `Versão atual: ${latest.version} · ${formatDate(latest.assessedAt)}` : "Nenhuma avaliação registrada"}</CardDescription></CardHeader><CardContent className="grid gap-4">
        {field("objective", "Objetivo do acompanhamento", true)}
        <div className="grid gap-4 sm:grid-cols-2">{field("weightKg", "Peso (kg)")}{field("heightCm", "Altura (cm)")}</div>
        {field("routineAndSchedule", "Rotina e horários habituais", true)}{field("physicalActivity", "Atividade física", true)}{field("foodPreferences", "Preferências alimentares", true)}{field("restrictionsAndAllergies", "Restrições e alergias", true)}{field("reportedDifficulties", "Dificuldades relatadas", true)}{field("relevantHabits", "Hábitos relevantes", true)}{field("professionalObservations", "Observações do nutricionista", true)}{field("nextReviewAt", "Próxima revisão (data e hora)")}
        {saveAssessment.isError && <p role="alert" className="text-sm text-destructive">{saveAssessment.error.message}</p>}
        <Button disabled={!active || !assessment.objective.trim() || saveAssessment.isPending} onClick={() => saveAssessment.mutate({ patientId, objective: assessment.objective, weightKg: assessment.weightKg ? Number(assessment.weightKg) : undefined, heightCm: assessment.heightCm ? Number(assessment.heightCm) : undefined, routineAndSchedule: assessment.routineAndSchedule || undefined, physicalActivity: assessment.physicalActivity || undefined, foodPreferences: assessment.foodPreferences || undefined, restrictionsAndAllergies: assessment.restrictionsAndAllergies || undefined, reportedDifficulties: assessment.reportedDifficulties || undefined, relevantHabits: assessment.relevantHabits || undefined, professionalObservations: assessment.professionalObservations || undefined, assessedAt: Date.now(), nextReviewAt: assessment.nextReviewAt ? new Date(assessment.nextReviewAt).getTime() : undefined })}>{saveAssessment.isPending ? "Salvando..." : "Salvar nova versão"}</Button>
      </CardContent></Card>
      <div className="grid gap-6">
        <Card><CardHeader><CardTitle>Anotação privada</CardTitle><CardDescription>Visível somente para você. Não é enviada ao paciente nem ao WhatsApp.</CardDescription></CardHeader><CardContent className="grid gap-3"><textarea className="min-h-28 rounded-md border bg-background p-3" value={note} onChange={event => setNote(event.target.value)} /><Button disabled={!active || !note.trim() || createNote.isPending} onClick={() => createNote.mutate({ patientId, content: note })}>Salvar anotação</Button></CardContent></Card>
        <Card><CardHeader><CardTitle>Orientação ao paciente</CardTitle><CardDescription>Cria um novo registro versionado e visível na Área do Paciente.</CardDescription></CardHeader><CardContent className="grid gap-3"><Input placeholder="Título" value={guidanceTitle} onChange={event => setGuidanceTitle(event.target.value)} /><textarea className="min-h-28 rounded-md border bg-background p-3" value={guidance} onChange={event => setGuidance(event.target.value)} /><Button disabled={!active || !guidanceTitle.trim() || !guidance.trim() || createGuidance.isPending} onClick={() => createGuidance.mutate({ patientId, title: guidanceTitle, content: guidance, deliveryStatus: "pending" })}>Registrar orientação</Button></CardContent></Card>
      </div>
    </div>
    <div className="grid gap-6 lg:grid-cols-3">
      <Card><CardHeader><CardTitle>Versões da avaliação</CardTitle></CardHeader><CardContent className="grid gap-3">{record.data.assessmentHistory.length ? record.data.assessmentHistory.map(item => <div key={item.id} className="rounded-md border p-3"><p className="font-medium">Versão {item.version}</p><p className="text-sm text-muted-foreground">{item.objective}</p><p className="mt-1 text-xs">{formatDate(item.assessedAt)}</p></div>) : <p className="text-sm text-muted-foreground">Nenhuma versão registrada.</p>}</CardContent></Card>
      <Card><CardHeader><CardTitle>Anotações privadas</CardTitle></CardHeader><CardContent className="grid gap-3">{record.data.notes.length ? record.data.notes.map(item => <div key={item.id} className="rounded-md border p-3"><p className="whitespace-pre-wrap text-sm">{item.content}</p><p className="mt-1 text-xs text-muted-foreground">{formatDate(item.createdAt)}</p></div>) : <p className="text-sm text-muted-foreground">Nenhuma anotação.</p>}</CardContent></Card>
      <Card><CardHeader><CardTitle>Orientações</CardTitle></CardHeader><CardContent className="grid gap-3">{record.data.guidances.length ? record.data.guidances.map(item => <div key={item.id} className="rounded-md border p-3"><p className="font-medium">{item.title} · v{item.version}</p><p className="whitespace-pre-wrap text-sm">{item.content}</p><p className="mt-1 text-xs text-muted-foreground">Entrega: {item.deliveryStatus} · {formatDate(item.createdAt)}</p></div>) : <p className="text-sm text-muted-foreground">Nenhuma orientação.</p>}</CardContent></Card>
    </div>
    <Card><CardHeader><CardTitle>Linha do tempo profissional</CardTitle><CardDescription>Eventos auditáveis do vínculo e do acompanhamento.</CardDescription></CardHeader><CardContent className="grid gap-2">{record.data.timeline.map(item => <div key={item.id} className="flex justify-between gap-4 border-b py-2 text-sm"><span>{item.eventType}</span><span className="text-muted-foreground">{formatDate(item.occurredAt)}</span></div>)}</CardContent></Card>
  </div>;
}

const remainingContent: Record<string, { title: string; description: string }> = {
  "/professional/messages": { title: "Mensagens", description: "A comunicação profissional persistente será centralizada neste espaço." },
  "/professional/reports": { title: "Relatórios profissionais", description: "Os relatórios individuais e da carteira reutilizam os cálculos canônicos." },
  "/professional/settings": { title: "Configurações profissionais", description: "Gerencie identificação e preferências próprias do contexto profissional." },
};
function Placeholder({ location }: { location: string }) { const content = remainingContent[location] ?? remainingContent["/professional/messages"]; return <div className="mx-auto max-w-6xl space-y-6"><PageIntro title={content.title} description={content.description} /><Card><CardContent className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><CalendarClock className="h-4 w-4" />Capacidade preservada para entrega incremental.</CardContent></Card></div>; }

export default function ProfessionalWorkspacePage() {
  const [location] = useLocation();
  return <ProfessionalLayout>{location === "/professional" ? <ProfessionalHome /> : location === "/professional/patients" ? <PatientsPage /> : location === "/professional/follow-up" ? <FollowUpPage /> : <Placeholder location={location} />}</ProfessionalLayout>;
}
