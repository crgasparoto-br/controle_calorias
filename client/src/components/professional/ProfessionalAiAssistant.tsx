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
import { Bot, FileText, Save, Sparkles } from "lucide-react";
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

type AiMode = keyof typeof modeLabels;
type DraftType = keyof typeof draftLabels;
type SourceSignal = { key: string; label: string; value: string };

function SourceReferences({
  keys,
  sourceSignals,
}: {
  keys?: string[];
  sourceSignals: SourceSignal[];
}) {
  const labels = (keys ?? [])
    .map(key => sourceSignals.find(signal => signal.key === key)?.label)
    .filter((label): label is string => Boolean(label));
  if (!labels.length) return null;
  return (
    <p className="mt-1 text-xs text-muted-foreground">
      Fontes: {labels.join("; ")}
    </p>
  );
}

export default function ProfessionalAiAssistant({
  patient,
  periodRange,
}: {
  patient: { patientId: number; displayName: string };
  periodRange: { start: string; end: string };
}) {
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();
  const [mode, setMode] = useState<AiMode>("summary");
  const [question, setQuestion] = useState("");
  const [draftType, setDraftType] =
    useState<DraftType>("follow_up_summary");
  const [resultState, setResultState] = useState<{
    signature: string;
    data: any;
  } | null>(null);
  const [draftContent, setDraftContent] = useState("");
  const activeSignatureRef = useRef("");
  const generate = trpc.professionalRecord.ai.generate.useMutation();
  const saveDraft = trpc.professionalRecord.messages.create.useMutation({
    onSuccess: async () => {
      await utils.professionalRecord.messages.list.invalidate();
      setLocation(professionalPatientPath(patient.patientId, "messages"));
    },
  });

  const signature = useMemo(
    () =>
      [
        patient.patientId,
        periodRange.start,
        periodRange.end,
        mode,
        draftType,
        question.trim(),
      ].join(":"),
    [draftType, mode, patient.patientId, periodRange.end, periodRange.start, question]
  );
  const result =
    resultState?.signature === signature ? resultState.data : null;

  useEffect(() => {
    activeSignatureRef.current = signature;
    setResultState(null);
    setDraftContent("");
  }, [signature]);

  const requestAssistance = () => {
    const requestSignature = signature;
    setResultState(null);
    generate.mutate(
      {
        patientId: patient.patientId,
        startDate: periodRange.start,
        endDate: periodRange.end,
        mode,
        question: mode === "question" ? question.trim() : undefined,
        draftType: mode === "draft" ? draftType : undefined,
      },
      {
        onSuccess: data => {
          if (activeSignatureRef.current !== requestSignature) return;
          setResultState({ signature: requestSignature, data });
          setDraftContent(data.draft?.content ?? "");
        },
      }
    );
  };

  return (
    <section aria-labelledby="professional-ai-title" className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle id="professional-ai-title" className="flex items-center gap-2">
            <Bot className="h-5 w-5" />
            Assistência por IA
          </CardTitle>
          <CardDescription>
            Resuma, compare, pergunte ou prepare um rascunho para {patient.displayName}. A IA não envia mensagens nem altera dados automaticamente.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="rounded-xl bg-muted p-3 text-sm">
            Período analisado: <strong>{periodRange.start}</strong> a <strong>{periodRange.end}</strong>
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Tipo de assistência</span>
              <select
                className="h-10 rounded-md border bg-background px-3"
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
              <label className="grid gap-1 text-sm">
                <span className="font-medium">Tipo de rascunho</span>
                <select
                  className="h-10 rounded-md border bg-background px-3"
                  value={draftType}
                  onChange={event => setDraftType(event.target.value as DraftType)}
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
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Pergunta sobre os dados autorizados</span>
              <textarea
                className="min-h-28 rounded-md border bg-background p-3"
                value={question}
                maxLength={1_000}
                onChange={event => setQuestion(event.target.value)}
                placeholder="Ex.: O que mudou na frequência de registros neste período?"
              />
            </label>
          ) : null}
          <Button
            disabled={generate.isPending || (mode === "question" && !question.trim())}
            onClick={requestAssistance}
          >
            <Sparkles className="h-4 w-4" />
            {generate.isPending ? "Analisando..." : "Gerar assistência"}
          </Button>
          {generate.isError ? (
            <p role="alert" className="text-sm text-destructive">
              Não foi possível gerar a assistência. Tente novamente sem alterar o período ou o paciente.
            </p>
          ) : null}
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
              Conteúdo assistido com fontes conferíveis. Revise antes de usar.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div>
              <p className="whitespace-pre-wrap text-sm leading-6">{result.summary}</p>
              <SourceReferences
                keys={result.summarySourceKeys}
                sourceSignals={result.sourceSignals ?? []}
              />
            </div>
            <div className="grid gap-5 lg:grid-cols-2">
              <div>
                <h3 className="font-semibold">Fatos calculados</h3>
                <ul className="mt-2 list-disc space-y-2 pl-5 text-sm">
                  {(result.facts ?? []).map((fact: string, index: number) => (
                    <li key={`${fact}-${index}`}>
                      {fact}
                      <SourceReferences
                        keys={result.factSourceKeys?.[index]}
                        sourceSignals={result.sourceSignals ?? []}
                      />
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h3 className="font-semibold">Interpretações assistidas</h3>
                <ul className="mt-2 list-disc space-y-2 pl-5 text-sm">
                  {(result.interpretations ?? []).map(
                    (interpretation: string, index: number) => (
                      <li key={`${interpretation}-${index}`}>{interpretation}</li>
                    )
                  )}
                </ul>
              </div>
            </div>
            {result.draft ? (
              <div className="space-y-3 rounded-2xl border p-4">
                <h3 className="font-semibold">Rascunho editável</h3>
                <textarea
                  className="min-h-36 w-full rounded-md border bg-background p-3 text-sm"
                  value={draftContent}
                  onChange={event => setDraftContent(event.target.value)}
                />
                <Button
                  disabled={!draftContent.trim() || saveDraft.isPending}
                  onClick={() =>
                    saveDraft.mutate({
                      patientId: patient.patientId,
                      content: draftContent.trim(),
                      messageType: result.draft.messageType,
                      origin: "ai_suggested",
                      action: "save_draft",
                      idempotencyKey: crypto.randomUUID(),
                    })
                  }
                >
                  <Save className="h-4 w-4" />
                  Salvar e abrir conversa
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </section>
  );
}
