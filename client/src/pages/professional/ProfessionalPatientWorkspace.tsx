import ProfessionalMessagesPanel from "@/components/ProfessionalMessagesPanel";
import ProfessionalOfficialGoalCard from "@/components/ProfessionalOfficialGoalCard";
import ProfessionalOperationalAlertsPanel from "@/components/ProfessionalOperationalAlertsPanel";
import ProfessionalReportsWorkspace from "@/components/ProfessionalReportsWorkspace";
import { useProfessionalWorkspace } from "@/components/ProfessionalLayout";
import {
  ProfessionalAsyncState,
  ProfessionalLoadingState,
  ProfessionalPage,
  ProfessionalPageHeader,
  ProfessionalPatientHeader,
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
import { Input } from "@/components/ui/input";
import {
  parseProfessionalPatientRoute,
  professionalPatientPath,
  type ProfessionalPatientSection,
} from "@/lib/professionalRoutes";
import { trpc } from "@/lib/trpc";
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  FileClock,
  FileText,
  History,
  MessageSquareText,
  NotebookPen,
  Scale,
  Send,
  StickyNote,
  Target,
} from "lucide-react";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";

const UNSAVED_MESSAGE =
  "Existem alterações não salvas. Deseja sair e descartá-las?";

const sections: Array<{
  section: ProfessionalPatientSection;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { section: "record", label: "Resumo", icon: ClipboardList },
  { section: "assessment", label: "Avaliação", icon: FileText },
  { section: "goals", label: "Metas", icon: Target },
  { section: "guidance", label: "Orientações", icon: Send },
  { section: "notes", label: "Anotações", icon: StickyNote },
  { section: "reports", label: "Relatórios", icon: Scale },
  { section: "messages", label: "Mensagens", icon: MessageSquareText },
  { section: "history", label: "Histórico", icon: History },
];

type AssessmentDraft = {
  objective: string;
  weightKg: string;
  heightCm: string;
  routineAndSchedule: string;
  physicalActivity: string;
  foodPreferences: string;
  restrictionsAndAllergies: string;
  reportedDifficulties: string;
  relevantHabits: string;
  professionalObservations: string;
  assessedAt: string;
  nextReviewAt: string;
};

const emptyAssessment: AssessmentDraft = {
  objective: "",
  weightKg: "",
  heightCm: "",
  routineAndSchedule: "",
  physicalActivity: "",
  foodPreferences: "",
  restrictionsAndAllergies: "",
  reportedDifficulties: "",
  relevantHabits: "",
  professionalObservations: "",
  assessedAt: "",
  nextReviewAt: "",
};

function formatDate(value: number | null | undefined) {
  return value
    ? new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
      }).format(new Date(value))
    : "Não informado";
}

function useUnsavedNavigationGuard(dirty: boolean, currentPath: string) {
  const allowNavigationRef = useRef(false);

  useEffect(() => {
    allowNavigationRef.current = false;
  }, [currentPath]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);

  useEffect(() => {
    const guardNavigation = (event: MouseEvent) => {
      if (!dirty || allowNavigationRef.current) return;
      const target = event.target as HTMLElement | null;
      const control = target?.closest(
        "[data-professional-navigation], nav[aria-label='Navegação da Área Profissional'] button, button[aria-label='Ir para o início da Área Profissional']"
      );
      if (!control) return;
      if (!window.confirm(UNSAVED_MESSAGE)) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
      } else {
        allowNavigationRef.current = true;
      }
    };
    document.addEventListener("click", guardNavigation, true);
    return () => document.removeEventListener("click", guardNavigation, true);
  }, [dirty]);

  useEffect(() => {
    const guardBack = () => {
      if (!dirty || allowNavigationRef.current) return;
      if (!window.confirm(UNSAVED_MESSAGE)) {
        window.history.pushState({ professionalDraftGuard: true }, "", currentPath);
      } else {
        allowNavigationRef.current = true;
      }
    };
    window.addEventListener("popstate", guardBack);
    return () => window.removeEventListener("popstate", guardBack);
  }, [currentPath, dirty]);

  return {
    canNavigate() {
      if (!dirty || window.confirm(UNSAVED_MESSAGE)) {
        allowNavigationRef.current = true;
        return true;
      }
      return false;
    },
    markSaved() {
      allowNavigationRef.current = true;
    },
  };
}

function PatientSubnav({
  activeSection,
  navigate,
  patientId,
}: {
  activeSection: ProfessionalPatientSection;
  navigate: (path: string) => void;
  patientId: number;
}) {
  return (
    <nav
      aria-label="Áreas do paciente"
      className="flex gap-1 overflow-x-auto rounded-2xl border bg-card p-1"
    >
      {sections.map(item => {
        const active = item.section === activeSection;
        return (
          <Button
            key={item.section}
            data-professional-navigation
            variant={active ? "secondary" : "ghost"}
            className="shrink-0"
            aria-current={active ? "page" : undefined}
            onClick={() => navigate(professionalPatientPath(patientId, item.section))}
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </Button>
        );
      })}
    </nav>
  );
}

function SummarySection({
  active,
  patientId,
  record,
  navigate,
}: {
  active: boolean;
  patientId: number;
  record: any;
  navigate: (path: string) => void;
}) {
  const latest = record.latestAssessment;
  return (
    <ProfessionalSplitLayout
      aside={
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Próximas ações</CardTitle>
            <CardDescription>
              Ações respeitam autorização e situação atual do acompanhamento.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            <Button
              variant="outline"
              disabled={!active}
              onClick={() => navigate(professionalPatientPath(patientId, "assessment"))}
            >
              <NotebookPen className="h-4 w-4" />
              Registrar avaliação
            </Button>
            <Button
              variant="outline"
              disabled={!active}
              onClick={() => navigate(professionalPatientPath(patientId, "goals"))}
            >
              <Target className="h-4 w-4" />
              Revisar metas
            </Button>
            <Button
              variant="outline"
              onClick={() => navigate(professionalPatientPath(patientId, "reports"))}
            >
              <Scale className="h-4 w-4" />
              Analisar relatório
            </Button>
          </CardContent>
        </Card>
      }
    >
      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Situação atual</CardTitle>
            <CardDescription>
              Visão resumida; detalhes permanecem nas áreas especializadas.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <div className="rounded-xl border p-3">
              <p className="text-xs text-muted-foreground">Última avaliação</p>
              <p className="mt-1 font-medium">
                {latest ? formatDate(latest.assessedAt) : "Não informado"}
              </p>
            </div>
            <div className="rounded-xl border p-3">
              <p className="text-xs text-muted-foreground">Objetivo registrado</p>
              <p className="mt-1 break-words font-medium">
                {latest?.objective ?? "Não informado"}
              </p>
            </div>
            <div className="rounded-xl border p-3">
              <p className="text-xs text-muted-foreground">Próxima revisão</p>
              <p className="mt-1 font-medium">
                {latest?.nextReviewAt
                  ? formatDate(latest.nextReviewAt)
                  : "Sem revisão agendada"}
              </p>
            </div>
          </CardContent>
        </Card>
        <ProfessionalOperationalAlertsPanel patientId={patientId} />
      </div>
    </ProfessionalSplitLayout>
  );
}

function AssessmentSection({
  active,
  draft,
  onDraftChange,
  patientId,
  record,
  save,
}: {
  active: boolean;
  draft: AssessmentDraft;
  onDraftChange: React.Dispatch<React.SetStateAction<AssessmentDraft>>;
  patientId: number;
  record: any;
  save: {
    isError: boolean;
    error: { message: string } | null;
    isPending: boolean;
    mutate: (input: any) => void;
  };
}) {
  const field = (
    key: keyof AssessmentDraft,
    label: string,
    multiline = false,
    type = "text"
  ) => (
    <label className="grid min-w-0 gap-1 text-sm">
      <span className="font-medium">{label}</span>
      {multiline ? (
        <textarea
          className="min-h-24 rounded-md border bg-background p-3"
          value={draft[key]}
          onChange={event =>
            onDraftChange(current => ({ ...current, [key]: event.target.value }))
          }
        />
      ) : (
        <Input
          type={type}
          value={draft[key]}
          onChange={event =>
            onDraftChange(current => ({ ...current, [key]: event.target.value }))
          }
        />
      )}
    </label>
  );
  return (
    <ProfessionalSplitLayout
      aside={
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Versões anteriores</CardTitle>
            <CardDescription>
              Cada salvamento cria uma nova versão auditável.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid max-h-[65vh] gap-3 overflow-y-auto">
            {record.assessmentHistory.length ? (
              record.assessmentHistory.map((item: any) => (
                <article key={item.id} className="rounded-xl border p-3">
                  <p className="font-medium">Versão {item.version}</p>
                  <p className="mt-1 break-words text-sm text-muted-foreground">
                    {item.objective}
                  </p>
                  <p className="mt-2 text-xs">{formatDate(item.assessedAt)}</p>
                </article>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">
                Nenhuma avaliação registrada.
              </p>
            )}
          </CardContent>
        </Card>
      }
    >
      <Card>
        <CardHeader>
          <CardTitle>Nova versão da avaliação</CardTitle>
          <CardDescription>
            A versão anterior será preservada. Campos sem informação podem permanecer vazios.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid min-w-0 gap-4">
          {!active ? (
            <p role="status" className="rounded-xl border bg-muted p-4 text-sm">
              Novas avaliações ficam bloqueadas enquanto o acompanhamento não estiver ativo.
            </p>
          ) : null}
          {field("objective", "Objetivo do acompanhamento", true)}
          <div className="grid gap-4 sm:grid-cols-2">
            {field("weightKg", "Peso (kg)")}
            {field("heightCm", "Altura (cm)")}
          </div>
          {field("routineAndSchedule", "Rotina e horários habituais", true)}
          {field("physicalActivity", "Atividade física", true)}
          {field("foodPreferences", "Preferências alimentares", true)}
          {field("restrictionsAndAllergies", "Restrições e alergias", true)}
          {field("reportedDifficulties", "Dificuldades relatadas", true)}
          {field("relevantHabits", "Hábitos relevantes", true)}
          {field("professionalObservations", "Observações do nutricionista", true)}
          <div className="grid gap-4 sm:grid-cols-2">
            {field("assessedAt", "Data da avaliação", false, "datetime-local")}
            {field("nextReviewAt", "Próxima revisão", false, "datetime-local")}
          </div>
          {save.isError ? (
            <p role="alert" className="text-sm text-destructive">
              {save.error?.message}
            </p>
          ) : null}
          <Button
            disabled={
              !active ||
              !draft.objective.trim() ||
              !draft.assessedAt ||
              save.isPending
            }
            onClick={() =>
              save.mutate({
                patientId,
                objective: draft.objective,
                weightKg: draft.weightKg ? Number(draft.weightKg) : undefined,
                heightCm: draft.heightCm ? Number(draft.heightCm) : undefined,
                routineAndSchedule: draft.routineAndSchedule || undefined,
                physicalActivity: draft.physicalActivity || undefined,
                foodPreferences: draft.foodPreferences || undefined,
                restrictionsAndAllergies:
                  draft.restrictionsAndAllergies || undefined,
                reportedDifficulties: draft.reportedDifficulties || undefined,
                relevantHabits: draft.relevantHabits || undefined,
                professionalObservations:
                  draft.professionalObservations || undefined,
                assessedAt: new Date(draft.assessedAt).getTime(),
                nextReviewAt: draft.nextReviewAt
                  ? new Date(draft.nextReviewAt).getTime()
                  : undefined,
              })
            }
          >
            {save.isPending ? "Salvando..." : "Salvar nova versão"}
          </Button>
        </CardContent>
      </Card>
    </ProfessionalSplitLayout>
  );
}

function GuidanceSection({
  active,
  content,
  create,
  onContentChange,
  onTitleChange,
  patientId,
  record,
  title,
}: {
  active: boolean;
  content: string;
  create: {
    isError: boolean;
    error: { message: string } | null;
    isPending: boolean;
    mutate: (input: any) => void;
  };
  onContentChange: (value: string) => void;
  onTitleChange: (value: string) => void;
  patientId: number;
  record: any;
  title: string;
}) {
  return (
    <ProfessionalSplitLayout
      aside={
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Orientações registradas</CardTitle>
          </CardHeader>
          <CardContent className="grid max-h-[65vh] gap-3 overflow-y-auto">
            {record.guidances.length ? (
              record.guidances.map((item: any) => (
                <article key={item.id} className="rounded-xl border p-3">
                  <p className="break-words font-medium">
                    {item.title} · v{item.version}
                  </p>
                  <p className="mt-2 whitespace-pre-wrap break-words text-sm">
                    {item.content}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {item.authorName} · {formatDate(item.createdAt)}
                  </p>
                </article>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">
                Nenhuma orientação registrada.
              </p>
            )}
          </CardContent>
        </Card>
      }
    >
      <Card>
        <CardHeader>
          <CardTitle>Nova orientação ao paciente</CardTitle>
          <CardDescription>
            Este conteúdo será destinado ao paciente. Uma anotação privada nunca é enviada automaticamente.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {!active ? (
            <p role="status" className="rounded-xl border bg-muted p-4 text-sm">
              Novas orientações ficam bloqueadas enquanto o acompanhamento não estiver ativo.
            </p>
          ) : null}
          <Input placeholder="Título" value={title} onChange={event => onTitleChange(event.target.value)} />
          <textarea
            className="min-h-40 rounded-md border bg-background p-3"
            value={content}
            onChange={event => onContentChange(event.target.value)}
            placeholder="Escreva a orientação que ficará disponível para o paciente."
          />
          {create.isError ? (
            <p role="alert" className="text-sm text-destructive">
              {create.error?.message}
            </p>
          ) : null}
          <Button
            disabled={!active || !title.trim() || !content.trim() || create.isPending}
            onClick={() =>
              create.mutate({
                patientId,
                title,
                content,
                deliveryStatus: "pending",
              })
            }
          >
            Registrar orientação
          </Button>
        </CardContent>
      </Card>
    </ProfessionalSplitLayout>
  );
}

function NotesSection({
  active,
  content,
  create,
  onContentChange,
  patientId,
  record,
}: {
  active: boolean;
  content: string;
  create: {
    isError: boolean;
    error: { message: string } | null;
    isPending: boolean;
    mutate: (input: any) => void;
  };
  onContentChange: (value: string) => void;
  patientId: number;
  record: any;
}) {
  return (
    <ProfessionalSplitLayout
      aside={
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Anotações anteriores</CardTitle>
          </CardHeader>
          <CardContent className="grid max-h-[65vh] gap-3 overflow-y-auto">
            {record.notes.length ? (
              record.notes.map((item: any) => (
                <article key={item.id} className="rounded-xl border p-3">
                  <p className="whitespace-pre-wrap break-words text-sm">
                    {item.content}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {formatDate(item.createdAt)}
                  </p>
                </article>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">Nenhuma anotação.</p>
            )}
          </CardContent>
        </Card>
      }
    >
      <Card>
        <CardHeader>
          <CardTitle>Nova anotação privada</CardTitle>
          <CardDescription>
            Visível somente para você. Não será enviada ao paciente nem ao WhatsApp.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {!active ? (
            <p role="status" className="rounded-xl border bg-muted p-4 text-sm">
              Novas anotações ficam bloqueadas enquanto o acompanhamento não estiver ativo.
            </p>
          ) : null}
          <textarea
            className="min-h-48 rounded-md border bg-background p-3"
            value={content}
            onChange={event => onContentChange(event.target.value)}
            placeholder="Registre observações internas do acompanhamento."
          />
          {create.isError ? (
            <p role="alert" className="text-sm text-destructive">
              {create.error?.message}
            </p>
          ) : null}
          <Button
            disabled={!active || !content.trim() || create.isPending}
            onClick={() => create.mutate({ patientId, content })}
          >
            Salvar anotação
          </Button>
        </CardContent>
      </Card>
    </ProfessionalSplitLayout>
  );
}

function HistorySection({
  page,
  record,
  setPage,
}: {
  page: number;
  record: any;
  setPage: React.Dispatch<React.SetStateAction<number>>;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileClock className="h-5 w-5" />
          Linha do tempo profissional
        </CardTitle>
        <CardDescription>
          Eventos auditáveis do vínculo, acompanhamento, avaliações, metas e orientações.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {record.timeline.length ? (
          <div className="grid gap-2">
            {record.timeline.map((item: any) => (
              <article
                key={item.id}
                className="grid min-w-0 gap-2 rounded-xl border p-3 sm:grid-cols-[minmax(0,1fr)_auto]"
              >
                <span className="break-words text-sm font-medium">
                  {item.label ?? item.eventType}
                </span>
                <time className="text-xs text-muted-foreground">
                  {formatDate(item.occurredAt)}
                </time>
              </article>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Nenhum evento disponível nesta página.
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button
            variant="outline"
            disabled={page <= 1}
            onClick={() => setPage(current => current - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
            Anterior
          </Button>
          <p className="text-sm text-muted-foreground">Página {page}</p>
          <Button
            variant="outline"
            disabled={!record.pagination.hasMore}
            onClick={() => setPage(current => current + 1)}
          >
            Próxima
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function ProfessionalPatientWorkspace() {
  const { selectedPatient } = useProfessionalWorkspace();
  const [location, setLocation] = useLocation();
  const utils = trpc.useUtils();
  const parsedRoute = parseProfessionalPatientRoute(location);
  const section =
    parsedRoute.kind === "patient" ? parsedRoute.section : "record";
  const patientId = selectedPatient?.patientId ?? 0;
  const [assessment, setAssessment] = useState(emptyAssessment);
  const [note, setNote] = useState("");
  const [guidanceTitle, setGuidanceTitle] = useState("");
  const [guidance, setGuidance] = useState("");
  const [transitionReason, setTransitionReason] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    setAssessment(emptyAssessment);
    setNote("");
    setGuidanceTitle("");
    setGuidance("");
    setTransitionReason("");
    setPage(1);
  }, [patientId]);

  const dirty = useMemo(
    () =>
      Object.values(assessment).some(Boolean) ||
      Boolean(note.trim() || guidanceTitle.trim() || guidance.trim()),
    [assessment, guidance, guidanceTitle, note]
  );
  const guard = useUnsavedNavigationGuard(dirty, location);
  const navigate = (path: string) => {
    if (guard.canNavigate()) setLocation(path);
  };

  const record = trpc.professionalRecord.get.useQuery(
    { patientId, page, pageSize: 20 },
    {
      enabled: patientId > 0,
      retry: false,
      refetchOnWindowFocus: true,
      refetchInterval: 10_000,
    }
  );
  const invalidate = async () => {
    await Promise.all([
      utils.professionalRecord.get.invalidate(),
      utils.nutrition.professionals.portfolio.invalidate(),
    ]);
  };
  const saveAssessment = trpc.professionalRecord.saveAssessment.useMutation({
    onSuccess: async () => {
      setAssessment(emptyAssessment);
      guard.markSaved();
      await invalidate();
    },
  });
  const createNote = trpc.professionalRecord.createNote.useMutation({
    onSuccess: async () => {
      setNote("");
      guard.markSaved();
      await invalidate();
    },
  });
  const createGuidance = trpc.professionalRecord.createGuidance.useMutation({
    onSuccess: async () => {
      setGuidanceTitle("");
      setGuidance("");
      guard.markSaved();
      await invalidate();
    },
  });
  const transitionTracking =
    trpc.professionalRecord.transitionTracking.useMutation({
      onSuccess: async () => {
        setTransitionReason("");
        await invalidate();
      },
    });

  useEffect(() => {
    if (!record.isError) return;
    const message = record.error?.message ?? "";
    if (
      message.includes("acesso a este paciente não está mais disponível") ||
      message.includes("não autorizado")
    ) {
      setAssessment(emptyAssessment);
      setNote("");
      setGuidanceTitle("");
      setGuidance("");
      setLocation("/professional/patients?notice=patient-access-unavailable");
    }
  }, [record.error?.message, record.isError, setLocation]);

  if (!selectedPatient) {
    return (
      <ProfessionalPage>
        <ProfessionalAsyncState
          icon="empty"
          title="Selecione um paciente"
          description="Abra um paciente autorizado pela carteira para acessar o workspace individual."
        />
      </ProfessionalPage>
    );
  }
  if (record.isLoading) {
    return (
      <ProfessionalPage>
        <ProfessionalLoadingState label="Carregando prontuário e contexto do paciente..." />
      </ProfessionalPage>
    );
  }
  if (record.isError || !record.data) {
    return (
      <ProfessionalPage>
        <ProfessionalAsyncState
          title="Não foi possível carregar o prontuário"
          description="O contexto permanece protegido. Seus dados não salvos foram preservados quando possível."
          onRetry={() => void record.refetch()}
        />
      </ProfessionalPage>
    );
  }

  const trackingStatus = record.data.patient.trackingStatus ?? "not_started";
  const active = trackingStatus === "active";
  const latest = record.data.latestAssessment;
  const transition = (nextStatus: "active" | "paused" | "ended") =>
    transitionTracking.mutate({
      accessId: record.data.patient.authorizationId,
      status: nextStatus,
      reason: transitionReason || undefined,
    });

  let content: React.ReactNode;
  if (section === "assessment") {
    content = (
      <AssessmentSection
        active={active}
        draft={assessment}
        onDraftChange={setAssessment}
        patientId={patientId}
        record={record.data}
        save={saveAssessment}
      />
    );
  } else if (section === "goals") {
    content = <ProfessionalOfficialGoalCard patientId={patientId} disabled={!active} />;
  } else if (section === "guidance") {
    content = (
      <GuidanceSection
        active={active}
        content={guidance}
        create={createGuidance}
        onContentChange={setGuidance}
        onTitleChange={setGuidanceTitle}
        patientId={patientId}
        record={record.data}
        title={guidanceTitle}
      />
    );
  } else if (section === "notes") {
    content = (
      <NotesSection
        active={active}
        content={note}
        create={createNote}
        onContentChange={setNote}
        patientId={patientId}
        record={record.data}
      />
    );
  } else if (section === "reports") {
    content = <ProfessionalReportsWorkspace />;
  } else if (section === "messages") {
    content = <ProfessionalMessagesPanel />;
  } else if (section === "history") {
    content = <HistorySection page={page} record={record.data} setPage={setPage} />;
  } else {
    content = (
      <SummarySection
        active={active}
        patientId={patientId}
        record={record.data}
        navigate={navigate}
      />
    );
  }

  return (
    <ProfessionalPage>
      <ProfessionalPageHeader
        eyebrow="Workspace do paciente"
        title={selectedPatient.displayName}
        description="O paciente e a área atual permanecem na URL. Toda leitura e alteração é revalidada antes de mostrar ou salvar dados."
        actions={
          <Button
            variant="outline"
            data-professional-navigation
            onClick={() => navigate("/professional/patients")}
          >
            Voltar à carteira
          </Button>
        }
      />
      <ProfessionalPatientHeader
        displayName={selectedPatient.displayName}
        trackingStatus={trackingStatus}
        nextReviewAt={latest?.nextReviewAt}
      />
      <PatientSubnav
        activeSection={section}
        navigate={navigate}
        patientId={patientId}
      />

      {section === "record" ? (
        <Card>
          <CardHeader className="gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <CardTitle>Ciclo de acompanhamento</CardTitle>
              <CardDescription>
                Mudanças registram ator, data e motivo quando informado.
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              {trackingStatus === "not_started" ? (
                <Button
                  disabled={transitionTracking.isPending}
                  onClick={() => transition("active")}
                >
                  Iniciar acompanhamento
                </Button>
              ) : null}
              {trackingStatus === "active" ? (
                <>
                  <Button
                    variant="outline"
                    disabled={transitionTracking.isPending}
                    onClick={() => transition("paused")}
                  >
                    Pausar
                  </Button>
                  <Button
                    variant="destructive"
                    disabled={transitionTracking.isPending}
                    onClick={() => transition("ended")}
                  >
                    Encerrar
                  </Button>
                </>
              ) : null}
              {trackingStatus === "paused" ? (
                <>
                  <Button
                    disabled={transitionTracking.isPending}
                    onClick={() => transition("active")}
                  >
                    Retomar
                  </Button>
                  <Button
                    variant="destructive"
                    disabled={transitionTracking.isPending}
                    onClick={() => transition("ended")}
                  >
                    Encerrar
                  </Button>
                </>
              ) : null}
            </div>
          </CardHeader>
          <CardContent className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Motivo da mudança (opcional)</span>
              <Input
                value={transitionReason}
                onChange={event => setTransitionReason(event.target.value)}
              />
            </label>
            {trackingStatus === "ended" ? (
              <p className="text-sm text-muted-foreground">
                O acompanhamento foi encerrado. O histórico permanece disponível para auditoria.
              </p>
            ) : null}
            {transitionTracking.isError ? (
              <p role="alert" className="text-sm text-destructive lg:col-span-2">
                {transitionTracking.error.message}
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {content}

      {section !== "history" ? (
        <div className="flex justify-end">
          <Button
            data-professional-navigation
            variant="ghost"
            onClick={() => navigate(professionalPatientPath(patientId, "history"))}
          >
            Ver histórico auditável
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      ) : null}
    </ProfessionalPage>
  );
}
