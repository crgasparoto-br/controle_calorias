import { useProfessionalWorkspace } from "@/components/ProfessionalLayout";
import {
  professionalLabel,
  ProfessionalAsyncState,
  ProfessionalLoadingState,
  ProfessionalPageHeader,
  ProfessionalSplitLayout,
  ProfessionalStatusBadge,
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
import { professionalPatientPath } from "@/lib/professionalRoutes";
import { trpc } from "@/lib/trpc";
import {
  ArrowRight,
  Inbox,
  MessageCircleReply,
  RefreshCw,
  Search,
  Send,
} from "lucide-react";
import React, { useEffect, useMemo, useRef, useState } from "react";
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

type ProfessionalMessageType =
  | "guidance"
  | "reminder"
  | "weigh_in_request"
  | "record_request"
  | "administrative"
  | "follow_up_summary";

type Cursor = { createdAt: number; id: string };

function formatDate(value: number | null | undefined) {
  return value
    ? new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
      }).format(new Date(value))
    : "Não informado";
}

export default function ProfessionalMessagesPanel() {
  const { selectedPatient } = useProfessionalWorkspace();
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();
  const [content, setContent] = useState("");
  const [messageType, setMessageType] =
    useState<ProfessionalMessageType>("guidance");
  const [origin, setOrigin] = useState<
    "professional" | "ai_suggested" | "automatic"
  >("professional");
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState(() =>
    crypto.randomUUID()
  );
  const [cursor, setCursor] = useState<Cursor | undefined>();
  const [items, setItems] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState("all");
  const patientId = selectedPatient?.patientId;
  const dirty = Boolean(content.trim());
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  useEffect(() => {
    setCursor(undefined);
    setItems([]);
    setContent("");
    setSelectedTemplateId("");
    setIdempotencyKey(crypto.randomUUID());
  }, [patientId]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    const guard = (event: MouseEvent) => {
      if (!dirtyRef.current) return;
      const target = event.target as HTMLElement | null;
      const navigation = target?.closest(
        "[data-professional-navigation], nav[aria-label='Navegação da Área Profissional'] button, button[aria-label='Ir para o início da Área Profissional']"
      );
      if (!navigation) return;
      if (!window.confirm("Existe um rascunho não salvo. Deseja descartá-lo?")) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", guard, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", guard, true);
    };
  }, []);

  const settings = trpc.professionalRecord.settings.get.useQuery(undefined, {
    retry: false,
    staleTime: 30_000,
  });
  const accesses = trpc.nutrition.professionals.myAccesses.useQuery(undefined, {
    retry: false,
    enabled: !patientId,
    staleTime: 30_000,
  });
  const record = trpc.professionalRecord.get.useQuery(
    { patientId: patientId ?? 0, page: 1, pageSize: 20 },
    { enabled: Boolean(patientId), retry: false, staleTime: 30_000 }
  );
  const query = trpc.professionalRecord.messages.list.useQuery(
    { patientId, cursor, pageSize: 20 },
    {
      retry: false,
      refetchInterval: cursor ? false : 30_000,
      refetchOnWindowFocus: !cursor,
    }
  );

  useEffect(() => {
    if (!query.data) return;
    setItems(current => {
      const next = cursor ? [...current, ...query.data.items] : query.data.items;
      const seen = new Set<string>();
      return next.filter((item: any) => {
        if (seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      });
    });
  }, [cursor, query.data]);

  const templates = settings.data?.preferences.messageTemplates ?? [];
  const patientNames = useMemo(() => {
    const map = new Map<number, string>();
    ((accesses.data ?? []) as any[]).forEach(access => {
      map.set(
        access.patientUserId,
        access.patient?.name ??
          access.patient?.email ??
          "Paciente autorizado"
      );
    });
    return map;
  }, [accesses.data]);

  const create = trpc.professionalRecord.messages.create.useMutation({
    onSuccess: async () => {
      setContent("");
      setSelectedTemplateId("");
      setIdempotencyKey(crypto.randomUUID());
      setCursor(undefined);
      setItems([]);
      await utils.professionalRecord.messages.list.invalidate();
    },
  });
  const retry = trpc.professionalRecord.messages.retry.useMutation({
    onSuccess: async () => {
      setCursor(undefined);
      setItems([]);
      await utils.professionalRecord.messages.list.invalidate();
    },
  });

  const submit = (action: "save_draft" | "send_web" | "send_whatsapp") => {
    if (!patientId) return;
    create.mutate({
      patientId,
      content,
      messageType,
      origin,
      action,
      idempotencyKey,
    });
  };
  const applyTemplate = (templateId: string) => {
    setSelectedTemplateId(templateId);
    const template = templates.find(item => item.id === templateId);
    if (!template) return;
    setContent(template.content);
    setMessageType(template.messageType as ProfessionalMessageType);
    setOrigin("professional");
    setIdempotencyKey(crypto.randomUUID());
  };

  const trackingStatus = record.data?.patient.trackingStatus ?? "not_started";
  const ended = trackingStatus === "ended";
  const paused = trackingStatus === "paused";
  const canDeliver =
    !ended && (!paused || messageType === "administrative") && origin !== "automatic";
  const visibleItems = items.filter(item => {
    const patientName = patientNames.get(item.patientUserId) ?? "";
    const matchesSearch =
      !search.trim() ||
      patientName.toLowerCase().includes(search.trim().toLowerCase()) ||
      item.content.toLowerCase().includes(search.trim().toLowerCase());
    const matchesState = stateFilter === "all" || item.state === stateFilter;
    return matchesSearch && matchesState;
  });

  return (
    <div className="space-y-6">
      <ProfessionalPageHeader
        eyebrow={patientId ? "Conversa do paciente" : "Comunicação da carteira"}
        title={patientId ? "Mensagens" : "Caixa de mensagens"}
        description={
          patientId
            ? `Conversa com ${selectedPatient?.displayName}. Modelos e IA apenas preenchem rascunhos; toda entrega exige sua ação.`
            : "Acompanhe mensagens recentes da carteira e abra a conversa contextual do paciente."
        }
      />

      {patientId ? (
        <ProfessionalSplitLayout
          aside={
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Regras da conversa</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-muted-foreground">
                <p>Mensagens enviadas não são editadas silenciosamente.</p>
                <p>Falhas permanecem no histórico e podem ser reenviadas quando permitido.</p>
                <p>Rascunhos automáticos exigem revisão antes da entrega.</p>
              </CardContent>
            </Card>
          }
        >
          <Card>
            <CardHeader>
              <CardTitle>Nova mensagem</CardTitle>
              <CardDescription>
                {ended
                  ? "O acompanhamento foi encerrado e não aceita novas mensagens."
                  : paused
                    ? "Durante a pausa, somente comunicações administrativas podem ser entregues."
                    : "Escolha um modelo ou escreva uma mensagem do zero."}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              {templates.length > 0 ? (
                <label className="grid gap-1 text-sm">
                  <span className="font-medium">Modelo de mensagem</span>
                  <select
                    aria-label="Modelo de mensagem"
                    className="h-10 rounded-md border bg-background px-3 text-sm"
                    value={selectedTemplateId}
                    onChange={event => applyTemplate(event.target.value)}
                  >
                    <option value="">Escrever sem modelo</option>
                    {templates.map(template => (
                      <option key={template.id} value={template.id}>
                        {template.title}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <div className="grid gap-3 sm:grid-cols-2">
                <select
                  aria-label="Tipo da mensagem"
                  className="h-10 rounded-md border bg-background px-3 text-sm"
                  value={messageType}
                  onChange={event => {
                    setMessageType(event.target.value as ProfessionalMessageType);
                    setSelectedTemplateId("");
                  }}
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
                  onChange={event =>
                    setOrigin(event.target.value as typeof origin)
                  }
                >
                  <option value="professional">Escrita pelo nutricionista</option>
                  <option value="ai_suggested">Sugestão da IA revisada</option>
                  <option value="automatic">Automática para revisão</option>
                </select>
              </div>
              <textarea
                aria-label="Conteúdo da mensagem"
                className="min-h-36 rounded-md border bg-background p-3"
                value={content}
                onChange={event => {
                  setContent(event.target.value);
                  setSelectedTemplateId("");
                }}
                placeholder="Escreva a orientação, lembrete ou solicitação..."
              />
              {create.isError ? (
                <p role="alert" className="text-sm text-destructive">
                  {create.error.message}
                </p>
              ) : null}
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
                  disabled={!content.trim() || create.isPending || !canDeliver}
                  onClick={() => submit("send_web")}
                >
                  <Send className="h-4 w-4" />
                  Disponibilizar na web
                </Button>
                <Button
                  disabled={!content.trim() || create.isPending || !canDeliver}
                  onClick={() => submit("send_whatsapp")}
                >
                  <Send className="h-4 w-4" />
                  Enviar por WhatsApp
                </Button>
              </div>
            </CardContent>
          </Card>
        </ProfessionalSplitLayout>
      ) : (
        <div className="grid gap-3 rounded-2xl border bg-card p-4 sm:grid-cols-[minmax(0,1fr)_220px]">
          <label className="relative">
            <span className="sr-only">Buscar mensagens</span>
            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-9"
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="Buscar paciente ou conteúdo"
            />
          </label>
          <select
            aria-label="Filtrar estado da mensagem"
            className="h-10 rounded-md border bg-background px-3 text-sm"
            value={stateFilter}
            onChange={event => setStateFilter(event.target.value)}
          >
            <option value="all">Todos os estados</option>
            <option value="draft">Rascunhos</option>
            <option value="pending">Pendentes</option>
            <option value="sent">Enviadas</option>
            <option value="failed">Falhas no envio</option>
            <option value="received">Recebidas</option>
          </select>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {patientId ? (
              <MessageCircleReply className="h-5 w-5" />
            ) : (
              <Inbox className="h-5 w-5" />
            )}
            {patientId ? "Histórico da conversa" : "Mensagens recentes"}
          </CardTitle>
          <CardDescription>
            Ordem estável por data; mensagens anteriores podem ser carregadas sem duplicação.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {query.isLoading && items.length === 0 ? (
            <ProfessionalLoadingState label="Carregando mensagens..." />
          ) : null}
          {query.isError ? (
            <ProfessionalAsyncState
              variant="panel"
              title="Não foi possível carregar as mensagens"
              description="Nenhuma mensagem nova foi adicionada à lista."
              onRetry={() => void query.refetch()}
            />
          ) : null}
          {!query.isLoading && !visibleItems.length ? (
            <ProfessionalAsyncState
              variant="panel"
              icon="empty"
              title="Nenhuma mensagem encontrada"
              description={
                patientId
                  ? "A conversa ainda não possui mensagens registradas."
                  : "A caixa não possui mensagens para os filtros atuais."
              }
            />
          ) : null}
          {visibleItems.map(item => {
            const fromPatient = item.direction === "patient_to_professional";
            const name =
              selectedPatient?.displayName ??
              patientNames.get(item.patientUserId) ??
              "Paciente autorizado";
            return (
              <article
                key={item.id}
                className={`min-w-0 rounded-2xl border p-4 ${
                  fromPatient ? "border-primary/30 bg-primary/5" : "bg-card"
                }`}
              >
                <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    {!patientId ? (
                      <p className="break-words text-sm font-semibold">{name}</p>
                    ) : null}
                    <p className="break-words font-medium">
                      {fromPatient
                        ? "Mensagem do paciente"
                        : typeLabels[item.messageType] ?? "Mensagem profissional"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {professionalLabel("origin", item.origin)} · {formatDate(item.createdAt)}
                    </p>
                  </div>
                  <ProfessionalStatusBadge kind="message" value={item.state} />
                </div>
                <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6">
                  {item.content}
                </p>
                {item.lastError ? (
                  <p role="alert" className="mt-2 text-xs text-destructive">
                    {item.lastError}
                  </p>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  {!patientId ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setLocation(
                          professionalPatientPath(item.patientUserId, "messages")
                        )
                      }
                    >
                      Abrir conversa
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  ) : null}
                  {(item.state === "failed" ||
                    (item.state === "draft" && item.origin !== "automatic")) ? (
                    <Button
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
                  ) : null}
                </div>
              </article>
            );
          })}
          {query.data?.nextCursor ? (
            <Button
              variant="outline"
              disabled={query.isFetching}
              onClick={() => setCursor(query.data?.nextCursor ?? undefined)}
            >
              {query.isFetching ? "Carregando..." : "Carregar mensagens anteriores"}
            </Button>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
