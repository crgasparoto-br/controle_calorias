import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import React, { useEffect, useMemo, useState } from "react";

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

type HistoricalAssessment = {
  id: string;
  version: number;
  objective: string;
  weightKg: number | null;
  heightCm: number | null;
  routineAndSchedule: string | null;
  physicalActivity: string | null;
  foodPreferences: string | null;
  restrictionsAndAllergies: string | null;
  reportedDifficulties: string | null;
  relevantHabits: string | null;
  professionalObservations: string | null;
  assessedAt: number | null;
  nextReviewAt: number | null;
  createdAt: number | null;
  authorName: string;
};

const RECORD_PAGE_SIZE = 20;

function formatDate(value: number | null | undefined) {
  return value
    ? new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
      }).format(new Date(value))
    : "Não informado";
}

function recordCollectionTotal(input: {
  total: unknown;
  visibleCount: number;
  page: number;
}) {
  if (
    typeof input.total === "number" &&
    Number.isFinite(input.total) &&
    input.total >= 0
  ) {
    return input.total;
  }
  return (input.page - 1) * RECORD_PAGE_SIZE + input.visibleCount;
}

function valueOrFallback(value: string | number | null | undefined) {
  if (typeof value === "string") return value.trim() || "Não informado";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "Não informado";
}

function HistoricalField({
  label,
  testId,
  value,
}: {
  label: string;
  testId: string;
  value: React.ReactNode;
}) {
  return (
    <div className="grid min-w-0 gap-1 text-sm">
      <p className="font-medium">{label}</p>
      <div
        data-testid={testId}
        className="min-h-10 whitespace-pre-wrap break-words rounded-md border bg-muted/30 px-3 py-2 text-sm leading-6"
      >
        {value}
      </div>
    </div>
  );
}

function RecordCollectionPagination({
  label,
  onPageChange,
  page,
  total,
}: {
  label: string;
  onPageChange: (page: number) => void;
  page: number;
  total: number;
}) {
  const totalPages = Math.max(1, Math.ceil(total / RECORD_PAGE_SIZE));
  if (totalPages <= 1 && page <= 1) return null;
  return (
    <nav
      aria-label={`Paginação de ${label}`}
      className="flex flex-wrap items-center justify-between gap-3 border-t pt-3"
    >
      <Button
        type="button"
        variant="outline"
        disabled={page <= 1}
        onClick={() => onPageChange(Math.max(1, page - 1))}
      >
        Anterior
      </Button>
      <p className="text-sm text-muted-foreground" aria-live="polite">
        Página {page} de {totalPages}
      </p>
      <Button
        type="button"
        variant="outline"
        disabled={page >= totalPages}
        onClick={() => onPageChange(Math.min(totalPages, page + 1))}
      >
        Próxima
      </Button>
    </nav>
  );
}

export default function ProfessionalAssessmentComparison({
  active,
  draft,
  onDraftChange,
  onPageChange,
  page,
  patientId,
  record,
  save,
}: {
  active: boolean;
  draft: AssessmentDraft;
  onDraftChange: React.Dispatch<React.SetStateAction<AssessmentDraft>>;
  onPageChange: (page: number) => void;
  page: number;
  patientId: number;
  record: any;
  save: {
    isError: boolean;
    error: { message: string } | null;
    isPending: boolean;
    mutate: (input: any) => void;
  };
}) {
  const [selectedAssessmentId, setSelectedAssessmentId] = useState<string | null>(
    null
  );
  const authorizationId = record.patient?.authorizationId ?? "";
  const assessmentHistory = (record.assessmentHistory ?? []) as HistoricalAssessment[];
  const selectedAssessment = useMemo(
    () =>
      assessmentHistory.find(item => item.id === selectedAssessmentId) ?? null,
    [assessmentHistory, selectedAssessmentId]
  );

  useEffect(() => {
    setSelectedAssessmentId(null);
  }, [authorizationId, patientId]);

  useEffect(() => {
    if (!selectedAssessmentId) return;
    if (!assessmentHistory.some(item => item.id === selectedAssessmentId)) {
      setSelectedAssessmentId(null);
    }
  }, [assessmentHistory, selectedAssessmentId]);

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
            onDraftChange(current => ({
              ...current,
              [key]: event.target.value,
            }))
          }
        />
      ) : (
        <Input
          type={type}
          value={draft[key]}
          onChange={event =>
            onDraftChange(current => ({
              ...current,
              [key]: event.target.value,
            }))
          }
        />
      )}
    </label>
  );

  const history = (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Histórico de avaliações</CardTitle>
        <CardDescription>
          Abra uma versão anterior para consultar os dados completos e compará-la
          com a nova avaliação sem alterar o rascunho atual.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid max-h-[55vh] gap-3 overflow-y-auto">
          {assessmentHistory.length ? (
            assessmentHistory.map(item => {
              const selected = item.id === selectedAssessmentId;
              return (
                <article
                  key={item.id}
                  className={`rounded-xl border p-3 ${selected ? "bg-muted/40" : ""}`}
                >
                  <p className="font-medium">Versão {item.version}</p>
                  <p className="mt-1 break-words text-sm text-muted-foreground">
                    {item.objective?.trim() || "Objetivo não informado"}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {item.authorName ?? "Autoria não informada"} ·{" "}
                    {formatDate(item.assessedAt)}
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant={selected ? "secondary" : "outline"}
                    className="mt-3"
                    aria-pressed={selected}
                    onClick={() => setSelectedAssessmentId(item.id)}
                  >
                    Visualizar avaliação
                  </Button>
                </article>
              );
            })
          ) : (
            <p className="text-sm text-muted-foreground">
              Nenhuma avaliação registrada.
            </p>
          )}
        </div>
        <RecordCollectionPagination
          label="avaliações"
          page={page}
          total={recordCollectionTotal({
            total: record.pagination?.totals?.assessments,
            visibleCount: assessmentHistory.length,
            page,
          })}
          onPageChange={nextPage => {
            setSelectedAssessmentId(null);
            onPageChange(nextPage);
          }}
        />
      </CardContent>
    </Card>
  );

  const historicalAssessment = selectedAssessment ? (
    <Card data-testid="historical-assessment">
      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <CardTitle>
            Avaliação histórica · Versão {selectedAssessment.version}
          </CardTitle>
          <CardDescription>
            Somente leitura · {selectedAssessment.authorName || "Autoria não informada"} ·{" "}
            {formatDate(selectedAssessment.assessedAt)}
          </CardDescription>
        </div>
        <Button
          type="button"
          variant="outline"
          className="shrink-0"
          onClick={() => setSelectedAssessmentId(null)}
        >
          Fechar comparação
        </Button>
      </CardHeader>
      <CardContent className="grid min-w-0 gap-4">
        <HistoricalField
          label="Objetivo do acompanhamento"
          testId="historical-objective"
          value={valueOrFallback(selectedAssessment.objective)}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <HistoricalField
            label="Peso (kg)"
            testId="historical-weightKg"
            value={
              selectedAssessment.weightKg == null
                ? "Não informado"
                : `${selectedAssessment.weightKg} kg`
            }
          />
          <HistoricalField
            label="Altura (cm)"
            testId="historical-heightCm"
            value={
              selectedAssessment.heightCm == null
                ? "Não informado"
                : `${selectedAssessment.heightCm} cm`
            }
          />
        </div>
        <HistoricalField
          label="Rotina e horários habituais"
          testId="historical-routineAndSchedule"
          value={valueOrFallback(selectedAssessment.routineAndSchedule)}
        />
        <HistoricalField
          label="Atividade física"
          testId="historical-physicalActivity"
          value={valueOrFallback(selectedAssessment.physicalActivity)}
        />
        <HistoricalField
          label="Preferências alimentares"
          testId="historical-foodPreferences"
          value={valueOrFallback(selectedAssessment.foodPreferences)}
        />
        <HistoricalField
          label="Restrições e alergias"
          testId="historical-restrictionsAndAllergies"
          value={valueOrFallback(selectedAssessment.restrictionsAndAllergies)}
        />
        <HistoricalField
          label="Dificuldades relatadas"
          testId="historical-reportedDifficulties"
          value={valueOrFallback(selectedAssessment.reportedDifficulties)}
        />
        <HistoricalField
          label="Hábitos relevantes"
          testId="historical-relevantHabits"
          value={valueOrFallback(selectedAssessment.relevantHabits)}
        />
        <HistoricalField
          label="Observações do nutricionista"
          testId="historical-professionalObservations"
          value={valueOrFallback(selectedAssessment.professionalObservations)}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <HistoricalField
            label="Data da avaliação"
            testId="historical-assessedAt"
            value={formatDate(selectedAssessment.assessedAt)}
          />
          <HistoricalField
            label="Próxima revisão"
            testId="historical-nextReviewAt"
            value={formatDate(selectedAssessment.nextReviewAt)}
          />
        </div>
      </CardContent>
    </Card>
  ) : null;

  const newAssessment = (
    <Card>
      <CardHeader>
        <CardTitle>Nova versão da avaliação</CardTitle>
        <CardDescription>
          A versão anterior será preservada. Campos sem informação podem
          permanecer vazios.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid min-w-0 gap-4">
        {!active ? (
          <p role="status" className="rounded-xl border bg-muted p-4 text-sm">
            Novas avaliações ficam bloqueadas enquanto o acompanhamento não
            estiver ativo.
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
        {field(
          "professionalObservations",
          "Observações do nutricionista",
          true
        )}
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
  );

  return (
    <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(280px,360px)] xl:items-start">
      <aside className="order-first min-w-0 xl:order-last xl:sticky xl:top-24">
        {history}
      </aside>
      <div
        data-assessment-comparison={selectedAssessment ? "open" : "closed"}
        className={`grid min-w-0 gap-6 ${selectedAssessment ? "xl:grid-cols-2 xl:items-start" : ""}`}
      >
        {historicalAssessment}
        {newAssessment}
      </div>
    </div>
  );
}
