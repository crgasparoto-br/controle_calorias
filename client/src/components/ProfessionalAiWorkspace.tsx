import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import {
  AlertTriangle,
  Bot,
  FileText,
  RefreshCw,
  Save,
  Sparkles,
} from "lucide-react";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";

const modeLabels = {
  summary: "Resumir período",
  comparison: "Comparar com período anterior",
  question: "Fazer pergunta",
  draft: "Preparar rascunho",
} as const;

const draftLabels = {
  guidance: "Orientação",
  reminder: "Lembrete",
  weigh_in_request: "Pedido de pesagem",
  record_request: "Pedido de registro",
  administrative: "Mensagem administrativa",
  follow_up_summary: "Resumo de acompanhamento",
} as const;

const severityLabels: Record<string, string> = {
  urgent: "Urgente",
  attention: "Atenção",
  info: "Informativo",
};

type AiMode = keyof typeof modeLabels;
type DraftType = keyof typeof draftLabels;
type Patient = { patientId: number; displayName: string };
type SourceSignal = {
  key: string;
  label: string;
  value: string;
  period?: "current" | "previous";
};

type Props = {
  selectedPatient: Patient | null;
  periodRange: { start: string; end: string };
  onOpenPatient: (patient: Patient) => void;
};

function SourceReferences({
  keys,
  sourceSignals,
}: {
  keys: string[] | undefined;
  sourceSignals: SourceSignal[];
}) {
  if (!keys?.length) return null;
  const labels = keys
    .map(key => sourceSignals.find(signal => signal.key === key)?.label)
    .filter((label): label is string => Boolean(label));
  if (!labels.length) return null;
  return (
    <p className="mt-1 text-xs text-muted-foreground">
      Fontes: {labels.join("; ")}
    </p>
  );
}

export default function ProfessionalAiWorkspace({
  selectedPatient,
  periodRange,
  onOpenPatient,
}: Props) {
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();
  const [mode, setMode] = useState<AiMode>("summary");
  const [question, setQuestion] = useState("");
  const [draftType, setDraftType] = useState<DraftType>(
    "follow_up_summary"
  );
  const [result, setResult] = useState<any>(null);
  const [draftContent, setDraftContent] = useState("");
  const activeSignatureRef = useRef("");

  const priorities = trpc.professionalRecord.ai.priorities.useQuery(
    { limit: 10 },
    { retry: false, refetchOnWindowFocus: true, refetchInterval: 30_000 }
  );
  const generate = trpc.professionalRecord.ai.generate.useMutation();
  const saveDraft = trpc.professionalRecord.messages.create.useMutation({
    onSuccess: async () => {
      await utils.professionalRecord.messages.list.invalidate();
      setLocation("/professional/messages");
    },
  });

  const signature = useMemo(
    () =>
      [
        selectedPatient?.patientId ?? 0,
        periodRange.start,
        periodRange.end,
        mode,
        draftType,
        question.trim(),
      ].join(":"),
    [draftType, mode, periodRange.end, periodRange.start, question, selectedPatient]
  );

  useEffect(() => {
    activeSignatureRef.current = signature;
    setResult(null);
    setDraftContent("");
  }, [signature]);

  const requestAssistance = () => {
    if (!selectedPatient) return;
    const requestSignature = signature;
    setResult(null);
    generate.mutate(
      {
        patientId: selectedPatient.patientId,
        startDate: periodRange.start,
        endDate: periodRange.end,
        mode,
        question: mode === "question" ? question.trim() : undefined,
        draftType: mode === "draft" ? draftType : undefined,
      },
      {
        onSuccess: data => {
          if (activeSignatureRef.current !== requestSignature) return;
          setResult(data);
          setDraftContent(data.draft?.content ?? "");
        },
      }
    );
  };

  const persistDraft = () => {
    if (!selectedPatient || !result?.draft || !draftContent.trim()) return;
    saveDraft.mutate({
      patientId: selectedPatient.patientId,
      content: draftContent.trim(),
      messageType: result.draft.messageType,
      origin: "ai_suggested",
      action: "save_draft",
      idempotencyKey: crypto.randomUUID(),
    });
  };

  return (
    <section aria-labelledby="professional-ai-title" className="space-y-5">
      <div>
        <h2
          id="professional-ai-title"
          className="flex items-center gap-2 text-xl font-semibold tracking-tight"
        >
          <Sparkles className="h-5 w-5" />
          Assistência profissional por IA
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Resumos, comparações e rascunhos baseados somente em dados autorizados.
          A decisão e o envio continuam sob responsabilidade do nutricionista.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <AlertTriangle className="h-5 w-5" />
            Pacientes para revisar primeiro
          </CardTitle>
          <CardDescription>
            Ordenação determinística pelos alertas objetivos da central de
            acompanhamento. A IA não cria novos critérios de risco.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {priorities.isLoading ? (
            <p role="status" className="text-sm text-muted-foreground">
              Carregando prioridades...
            </p>
          ) : null}
          {priorities.isError ? (
            <div role="alert" className="flex items-center justify-between gap-3">
              <p className="text-sm text-destructive">
                Não foi possível carregar as prioridades.
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void priorities.refetch()}
              >
                <RefreshCw className="h-4 w-4" />
                Tentar novamente
              </Button>
            </div>
          ) : null}
          {priorities.data?.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum alerta objetivo aberto para priorização.
            </p>
          ) : null}
          {priorities.data?.map(item => (
            <article
              key={item.patientId}
              className="grid gap-3 rounded-xl border p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
            >
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{item.displayName}</p>
                  <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
                    {severityLabels[item.highestSeverity] ?? item.highestSeverity}
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {item.alertCount} alerta(s): {item.signals.map(signal => signal.label).join(", ")}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  onOpenPatient({
                    patientId: item.patientId,
                    displayName: item.displayName,
                  })
                }
              >
                Revisar paciente
              </Button>
            </article>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5" />
            Analisar paciente selecionado
          </CardTitle>
          <CardDescription>
            Período ativo: {periodRange.start} a {periodRange.end}.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!selectedPatient ? (
            <p className="rounded-xl bg-muted p-4 text-sm text-muted-foreground">
              Selecione uma pessoa autorizada no relatório individual para usar
              a assistência.
            </p>
          ) : (
            <>
              <p className="rounded-xl bg-muted p-4 text-sm">
                <strong>Paciente:</strong> {selectedPatient.displayName}
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-2 text-sm font-medium">
                  Tipo de assistência
                  <select
                    aria-label="Tipo de assistência"
                    className="h-10 rounded-md border bg-background px-3 font-normal"
                    value={mode}
                    onChange={event => setMode(event.target.value as AiMode)}
                  >
                    {Object.entries(modeLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                {mode === "draft" ? (
                  <label className="grid gap-2 text-sm font-medium">
                    Tipo de rascunho
                    <select
                      aria-label="Tipo de rascunho"
                      className="h-10 rounded-md border bg-background px-3 font-normal"
                      value={draftType}
                      onChange={event =>
                        setDraftType(event.target.value as DraftType)
                      }
                    >
                      {Object.entries(draftLabels).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
              </div>
              {mode === "question" ? (
                <label className="grid gap-2 text-sm font-medium">
                  Pergunta sobre os dados autorizados
                  <textarea
                    aria-label="Pergunta sobre os dados autorizados"
                    className="min-h-28 rounded-md border bg-background p-3 font-normal"
                    value={question}
                    maxLength={1_000}
                    onChange={event => setQuestion(event.target.value)}
                    placeholder="Ex.: O que mudou na frequência de registros neste período?"
                  />
                </label>
              ) : null}
              <Button
                onClick={requestAssistance}
                disabled={
                  generate.isPending ||
                  (mode === "question" && !question.trim())
                }
              >
                <Sparkles className="h-4 w-4" />
                {generate.isPending ? "Analisando..." : "Gerar assistência"}
              </Button>
              {generate.isError ? (
                <p role="alert" className="text-sm text-destructive">
                  {generate.error.message}
                </p>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>

      {result ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              {result.title}
            </CardTitle>
            <CardDescription>
              {result.fallbackUsed
                ? "Modo seguro determinístico usado; nenhum conteúdo foi enviado automaticamente."
                : "Conteúdo gerado com contexto minimizado e fontes conferíveis."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <p className="whitespace-pre-wrap text-sm leading-6">
              {result.summary}
            </p>
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-2">
                <h3 className="font-semibold">Fatos calculados</h3>
                <ul className="list-disc space-y-2 pl-5 text-sm">
                  {result.facts.map((fact: string, index: number) => (
                    <li key={`${fact}-${index}`}>
                      {fact}
                      <SourceReferences
                        keys={result.factSourceKeys?.[index]}
                        sourceSignals={result.sourceSignals}
                      />
                    </li>
                  ))}
                </ul>
              </div>
              <div className="space-y-2">
                <h3 className="font-semibold">Interpretações assistidas</h3>
                <ul className="list-disc space-y-2 pl-5 text-sm">
                  {result.interpretations.map((item: string, index: number) => (
                    <li key={`${item}-${index}`}>
                      {item}
                      <SourceReferences
                        keys={result.interpretationSourceKeys?.[index]}
                        sourceSignals={result.sourceSignals}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            {result.missingData.length ? (
              <div className="rounded-xl border p-4">
                <h3 className="font-semibold">Dados ausentes</h3>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                  {result.missingData.map((item: string) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="rounded-xl border bg-muted/30 p-4">
              <h3 className="font-semibold">Fontes conferíveis</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                O catálogo abaixo contém todos os sinais enviados ao provedor.
                Cada fato e interpretação identifica as fontes correspondentes.
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {result.sourceSignals.map((signal: SourceSignal) => (
                  <div key={signal.key} className="rounded-lg bg-background p-3">
                    <p className="text-xs text-muted-foreground">
                      {signal.label}
                    </p>
                    <p className="text-sm font-medium">{signal.value}</p>
                  </div>
                ))}
              </div>
            </div>
            {result.cautions.length ? (
              <ul className="list-disc space-y-1 pl-5 text-sm text-amber-700 dark:text-amber-300">
                {result.cautions.map((item: string) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : null}
            {result.draft ? (
              <div className="space-y-3 rounded-xl border p-4">
                <h3 className="font-semibold">Rascunho para revisão</h3>
                <textarea
                  aria-label="Rascunho para revisão"
                  className="min-h-36 w-full rounded-md border bg-background p-3 text-sm"
                  value={draftContent}
                  onChange={event => setDraftContent(event.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Salvar cria apenas um rascunho em Mensagens. O envio exige uma
                  nova ação explícita.
                </p>
                <Button
                  onClick={persistDraft}
                  disabled={!draftContent.trim() || saveDraft.isPending}
                >
                  <Save className="h-4 w-4" />
                  {saveDraft.isPending
                    ? "Salvando..."
                    : "Salvar em Mensagens"}
                </Button>
                {saveDraft.isError ? (
                  <p role="alert" className="text-sm text-destructive">
                    {saveDraft.error.message}
                  </p>
                ) : null}
              </div>
            ) : null}
            <p className="text-xs text-muted-foreground">
              {result.educationalNotice}
            </p>
          </CardContent>
        </Card>
      ) : null}
    </section>
  );
}
