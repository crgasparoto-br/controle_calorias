import { useProfessionalWorkspace } from "@/components/ProfessionalLayout";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { MessageSquareText, RefreshCw, Send } from "lucide-react";
import React, { useMemo, useState } from "react";
import { useLocation } from "wouter";

const typeLabels: Record<string, string> = {
  guidance: "Orientação",
  reminder: "Lembrete",
  weigh_in_request: "Pedido de pesagem",
  record_request: "Pedido de registro",
  administrative: "Administrativa",
  follow_up_summary: "Resumo de acompanhamento",
  response: "Resposta",
};
const originLabels: Record<string, string> = {
  automatic: "Automática",
  ai_suggested: "Sugestão da IA revisada",
  professional: "Nutricionista",
  patient: "Paciente",
};
const stateLabels: Record<string, string> = {
  draft: "Rascunho",
  pending: "Pendente",
  sent: "Enviada",
  failed: "Falha",
  received: "Recebida",
};

export default function ProfessionalMessagesPanel() {
  const { selectedPatient } = useProfessionalWorkspace();
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();
  const [content, setContent] = useState("");
  const [messageType, setMessageType] = useState<
    | "guidance"
    | "reminder"
    | "weigh_in_request"
    | "record_request"
    | "administrative"
    | "follow_up_summary"
  >("guidance");
  const [origin, setOrigin] = useState<
    "professional" | "ai_suggested" | "automatic"
  >("professional");
  const [idempotencyKey, setIdempotencyKey] = useState(() =>
    crypto.randomUUID()
  );
  const input = useMemo(
    () => ({ patientId: selectedPatient?.patientId, pageSize: 20 }),
    [selectedPatient?.patientId]
  );
  const query = trpc.professionalRecord.messages.list.useQuery(input, {
    retry: false,
    refetchInterval: 30_000,
  });
  const create = trpc.professionalRecord.messages.create.useMutation({
    onSuccess: async () => {
      setContent("");
      setIdempotencyKey(crypto.randomUUID());
      await utils.professionalRecord.messages.list.invalidate();
    },
  });
  const retry = trpc.professionalRecord.messages.retry.useMutation({
    onSuccess: () => utils.professionalRecord.messages.list.invalidate(),
  });
  const submit = (action: "save_draft" | "send_web" | "send_whatsapp") => {
    if (selectedPatient)
      create.mutate({
        patientId: selectedPatient.patientId,
        content,
        messageType,
        origin,
        action,
        idempotencyKey,
      });
  };
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Mensagens</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Histórico persistente do acompanhamento, com entrega pela web ou
          WhatsApp.
        </p>
      </div>
      {!selectedPatient ? (
        <Card>
          <CardContent className="py-10 text-center">
            <MessageSquareText className="mx-auto h-9 w-9 text-muted-foreground" />
            <h2 className="mt-3 font-semibold">Selecione um paciente</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Abra um paciente na carteira antes de escrever uma mensagem.
            </p>
            <Button
              className="mt-4"
              onClick={() => setLocation("/professional/patients")}
            >
              Ir para pacientes
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>
              Nova mensagem para {selectedPatient.displayName}
            </CardTitle>
            <CardDescription>
              Rascunhos automáticos e da IA nunca são enviados sem sua ação
              explícita.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <select
                aria-label="Tipo da mensagem"
                className="h-10 rounded-md border bg-background px-3 text-sm"
                value={messageType}
                onChange={e =>
                  setMessageType(e.target.value as typeof messageType)
                }
              >
                {Object.entries(typeLabels)
                  .filter(([key]) => key !== "response")
                  .map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
              </select>
              <select
                aria-label="Origem da mensagem"
                className="h-10 rounded-md border bg-background px-3 text-sm"
                value={origin}
                onChange={e => setOrigin(e.target.value as typeof origin)}
              >
                <option value="professional">Escrita pelo nutricionista</option>
                <option value="ai_suggested">Sugestão da IA revisada</option>
                <option value="automatic">Automática para revisão</option>
              </select>
            </div>
            <textarea
              aria-label="Conteúdo da mensagem"
              className="min-h-32 rounded-md border bg-background p-3"
              value={content}
              onChange={e => setContent(e.target.value)}
              placeholder="Escreva a orientação, lembrete ou solicitação..."
            />
            {create.isError && (
              <p role="alert" className="text-sm text-destructive">
                {create.error.message}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={!content.trim() || create.isPending}
                onClick={() => submit("save_draft")}
              >
                Salvar rascunho
              </Button>
              <Button
                variant="outline"
                disabled={
                  !content.trim() || create.isPending || origin === "automatic"
                }
                onClick={() => submit("send_web")}
              >
                <Send className="h-4 w-4" />
                Disponibilizar na web
              </Button>
              <Button
                disabled={
                  !content.trim() || create.isPending || origin === "automatic"
                }
                onClick={() => submit("send_whatsapp")}
              >
                <Send className="h-4 w-4" />
                Enviar por WhatsApp
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Histórico</CardTitle>
          <CardDescription>
            {selectedPatient
              ? `Conversa com ${selectedPatient.displayName}`
              : "Mensagens recentes da carteira"}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {query.isLoading && <p role="status">Carregando mensagens...</p>}
          {query.isError && (
            <p role="alert" className="text-sm text-destructive">
              Não foi possível carregar as mensagens.
            </p>
          )}
          {query.data?.items.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhuma mensagem registrada.
            </p>
          )}
          {query.data?.items.map((item: any) => (
            <article key={item.id} className="rounded-xl border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">
                  {item.direction === "patient_to_professional"
                    ? "Resposta do paciente"
                    : typeLabels[item.messageType]}
                </p>
                <span className="text-xs text-muted-foreground">
                  {item.createdAt
                    ? new Date(item.createdAt).toLocaleString("pt-BR")
                    : ""}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {originLabels[item.origin]} · {stateLabels[item.state]}
              </p>
              <p className="mt-3 whitespace-pre-wrap text-sm">{item.content}</p>
              {item.lastError && (
                <p role="alert" className="mt-2 text-xs text-destructive">
                  {item.lastError}
                </p>
              )}
              {(item.state === "failed" ||
                (item.state === "draft" && item.origin !== "automatic")) && (
                <Button
                  className="mt-3"
                  size="sm"
                  variant="outline"
                  disabled={retry.isPending}
                  onClick={() => retry.mutate({ messageId: item.id })}
                >
                  <RefreshCw className="h-4 w-4" />
                  {item.state === "draft"
                    ? "Revisado: enviar por WhatsApp"
                    : "Tentar novamente"}
                </Button>
              )}
            </article>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
