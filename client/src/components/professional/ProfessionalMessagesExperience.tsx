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
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation } from "wouter";

const UNSAVED_MESSAGE = "Existe um rascunho não salvo. Deseja descartá-lo?";

const messageTypeLabels: Record<string, string> = {
  guidance: "Orientação",
  reminder: "Lembrete",
  weigh_in_request: "Pedido de pesagem",
  record_request: "Pedido de registro",
  administrative: "Administrativa",
  follow_up_summary: "Resumo de acompanhamento",
  response: "Resposta",
};

type MessageType =
  | "guidance"
  | "reminder"
  | "weigh_in_request"
  | "record_request"
  | "administrative"
  | "follow_up_summary";
type MessageOrigin =
  | "professional"
  | "ai_suggested"
  | "automatic"
  | "patient";
type ComposerOrigin = Exclude<MessageOrigin, "patient">;
type Cursor = { createdAt: number; id: string };
type MessageItem = {
  id: string;
  patientUserId: number;
  direction: string;
  origin: MessageOrigin;
  messageType: MessageType | "response";
  content: string;
  state: string;
  lastError?: string | null;
  createdAt?: number | null;
  authorName?: string | null;
  patientName?: string | null;
};
type MessageTemplate = {
  id: string;
  title: string;
  content: string;
  messageType: string;
};

function mergeMessageItems(
  current: MessageItem[],
  incoming: MessageItem[],
  patientSelected: boolean
) {
  const byId = new Map(current.map(item => [item.id, item]));
  for (const item of incoming) byId.set(item.id, item);
  const merged = Array.from(byId.values());
  return merged.sort((left, right) => {
    const timeDifference =
      (left.createdAt ?? 0) - (right.createdAt ?? 0) ||
      left.id.localeCompare(right.id);
    return patientSelected ? timeDifference : -timeDifference;
  });
}

function formatDate(value: number | null | undefined) {
  return value
    ? new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
      }).format(new Date(value))
    : "Não informado";
}

export default function ProfessionalMessagesExperience() {
  const { selectedPatient } = useProfessionalWorkspace();
  const [location, setLocation] = useLocation();
  const utils = trpc.useUtils();
  const patientId = selectedPatient?.patientId;

  const [content, setContent] = useState("");
  const [messageType, setMessageType] = useState<MessageType>("guidance");
  const [origin, setOrigin] = useState<ComposerOrigin>("professional");
  const [supersededOrigin, setSupersededOrigin] =
    useState<ComposerOrigin | null>(null);
  const [templateId, setTemplateId] = useState("");
  const [supersedesMessageId, setSupersedesMessageId] = useState<string | null>(
    null
  );
  const [idempotencyKey, setIdempotencyKey] = useState(() =>
    crypto.randomUUID()
  );
  const [cursor, setCursor] = useState<Cursor | undefined>();
  const [items, setItems] = useState<MessageItem[]>([]);
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState("all");
  const dirtyRef = useRef(false);
  dirtyRef.current = Boolean(content.trim());

  const clearComposer = useCallback(() => {
    setContent("");
    setMessageType("guidance");
    setOrigin("professional");
    setSupersededOrigin(null);
    setTemplateId("");
    setSupersedesMessageId(null);
    setIdempotencyKey(crypto.randomUUID());
  }, []);

  useEffect(() => {
    setCursor(undefined);
    setItems([]);
    clearComposer();
  }, [clearComposer, patientId]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    const guardNavigation = (event: MouseEvent) => {
      if (!dirtyRef.current) return;
      const target = event.target as HTMLElement | null;
      const navigation = target?.closest(
        "[data-professional-navigation], [data-sidebar='footer'] button, nav[aria-label='Navegação da Área Profissional'] button, button[aria-label='Ir para o início da Área Profissional']"
      );
      if (!navigation) return;
      if (!window.confirm(UNSAVED_MESSAGE)) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
      } else {
        clearComposer();
      }
    };
    const guardBack = () => {
      if (!dirtyRef.current) return;
      if (!window.confirm(UNSAVED_MESSAGE)) {
        window.history.pushState({ professionalMessageDraft: true }, "", location);
      } else {
        clearComposer();
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("popstate", guardBack);
    document.addEventListener("click", guardNavigation, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener("popstate", guardBack);
      document.removeEventListener("click", guardNavigation, true);
    };
  }, [clearComposer, location]);

  const templatesQuery = trpc.professionalRecord.messages.templates.useQuery(
    undefined,
    {
      enabled: Boolean(patientId),
      retry: false,
      staleTime: 30_000,
    }
  );
  const messages = trpc.professionalRecord.messages.list.useQuery(
    { patientId, cursor, pageSize: 20 },
    {
      retry: false,
      refetchInterval: cursor ? false : 30_000,
      refetchOnWindowFocus: !cursor,
    }
  );
  const latestMessages = trpc.professionalRecord.messages.list.useQuery(
    { patientId, pageSize: 20 },
    {
      enabled: Boolean(cursor),
      retry: false,
      refetchInterval: cursor ? 30_000 : false,
      refetchOnWindowFocus: Boolean(cursor),
    }
  );

  useEffect(() => {
    if (!messages.data) return;
    setItems(current => {
      const baseline = cursor ? current : [];
      return mergeMessageItems(
        baseline,
        messages.data.items as MessageItem[],
        Boolean(patientId)
      );
    });
  }, [cursor, messages.data, patientId]);

  useEffect(() => {
    if (!cursor || !latestMessages.data) return;
    setItems(current =>
      mergeMessageItems(
        current,
        latestMessages.data.items as MessageItem[],
        Boolean(patientId)
      )
    );
  }, [cursor, latestMessages.data, patientId]);

  const templates = (templatesQuery.data ?? []) as MessageTemplate[];

  const create = trpc.professionalRecord.messages.create.useMutation({
    onSuccess: async () => {
      clearComposer();
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
    if (!patientId || !content.trim()) return;
    create.mutate({
      patientId,
      content,
      messageType,
      origin: supersededOrigin === "ai_suggested" ? "ai_suggested" : origin,
      action,
      idempotencyKey,
      supersedesMessageId: supersedesMessageId ?? undefined,
    });
  };
  const applyTemplate = (nextTemplateId: string) => {
    setTemplateId(nextTemplateId);
    setSupersedesMessageId(null);
    setSupersededOrigin(null);
    const template = templates.find(item => item.id === nextTemplateId);
    if (!template) return;
    setContent(template.content);
    setMessageType(template.messageType as MessageType);
    setOrigin("professional");
    setIdempotencyKey(crypto.randomUUID());
  };

  continueDraft = (item: MessageItem) => {
    setContent(item.content);
    setMessageType(item.messageType as MessageType);
    setOrigin(item.origin === "patient" ? "professional" : item.origin);
    setSupersededOrigin(
      item.origin === "patient" ? "professional" : item.origin
    );
    setTemplateId("");
    setSupersedesMessageId(item.id);
    setIdempotencyKey(crypto.randomUUID());
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const visibleItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    return items.filter(item => {
      const matchesSearch =
        !query ||
        (item.content ?? "").toLowerCase().includes(query) ||
        (item.patientName ?? "").toLowerCase().includes(query);
      const matchesState = stateFilter === "all" || item.state === stateFilter;
      return matchesSearch && matchesState;
    });
  }, [items, search, stateFilter]);

  const trackingStatus = selectedPatient?.trackingStatus ?? "not_started";
  const ended = trackingStatus === "ended";
  const paused = trackingStatus === "paused";
  const notStarted = trackingStatus === "not_started";
  const canDeliver =
    !templateId &&
    !(origin === "automatic" && !supersedesMessageId) &&
    !(paused && messageType !== "administrative") &&
    !ended &&
    !notStarted;
  const canRetry = (item: MessageItem) =>
    !!ended &&
    !!item.lastError &&
    item.direction === "professional_to_patient" &&
    (trackingStatus === "active" ||
      (paused && item.messageType === "administrative"));

  return (
    <div className="space-y-6">
      <ProfessionalPageHeader
        title={patientId ? `Conversa com ${selectedPatient!.displayName}` : "Caixa de mensagens"}
        description={
          patientId
            ? "Histórico contextual, rascunhos revisíveis e entregas explícitas."
            : "Acompanhe conversas recentes da carteira e abra o workspace do paciente para responder."
        }
      />

      {patientId ? (
        <private_variant className="grid gap-4 rounded-2xl border px-4 py-3 text-sm" aria-label="Contexto da conversa">
          <strong>{selectedPatient!.displayName}</strong>
          <span className="text-muted-foreground">
            {trackingStatus === "active"
              ? "Acompanhamento ativo"
              : trackingStatus === "paused"
                ? "Acompanhamento pausado"
                : trackingStatus === "ended"
                  ? "Acompanhamento encerrado"
                  : "Acompanhamento não iniciado"}
          </span>
        </private_variant>
      ) : null}

      {ended ? (
        <ProfessionalAsyncState
          variant="panel"
          title="Acompanhamento encerrado"
          description="O acompanhamento foi encerrado. As mensagens anteriores permanecem disponíveis somente para consulta."
        />
      ) : null}

      {paused ? (
        <ProfessionalAsyncState
          variant="panel"
          title="Comunicação administrativa"
          description="Durante a pausa, utilize somente mensagens administrativas."
        />
      ) : null}

      {notStarted && patientId ? (
        <ProfessionalAsyncState
          variant="panel"
          title="Acompanhamento não iniciado"
          description="Inicie no Prontuário antes de criar ou publicar mensagens."
        />
      ) : null}

      {patientId ? (
        <ProfessionalSplitLayout
          primary={
            <Card>
              <CardHeader>
                <CardTitle>Nova mensagem</CardTitle>
                <CardDescription>
                  Modelos e IA apenas preenchem o rascunho. O nutricionista sempre revisa e
                  confirma a ação final.
                </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <select
                  aria-label="Modelo de mensagem"
                  className="h-10 rounded-md border bg-background px-3 text-sm"
                  value={templateId}
                  disabled={ended || notStarted}
                  onChange={event => applyTemplate(event.target.value)}
                >
                  <option value="">Sem modelo</option>
                  {templates.map(template => (
                    <option key={template.id} value={template.id}>
                      {template.title}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Tipo da mensagem"
                  className="h-10 rounded-md border bg-background px-3 text-sm"
                  value={messageType}
                  disabled={ended || notStarted}
                  onChange={event => setMessageType(event.target.value as MessageType)}
                >
                  <option value="guidance">Orientação</option>
                  <option value="reminder">Lembrete</option>
                  <option value="weigh_in_request">Pedido de pesagem</option>
                  <option value="record_request">Pedido de registro</option>
                  <option value="administrative">Administrativa</option>
                  <option value="follow_up_summary">Resumo</option>
                </select>
                <select
                  aria-label="Origem da mensagem"
                  className="h-10 rounded-md border bg-background px-3 text-sm"
                  value={origin}
                  disabled={
                    ended || notStarted || supersededOrigin === "ai_suggested"
                  }
                  onChange={event =>
                    setOrigin(event.target.value as ComposerOrigin)
                  }
                >
                  <option value="professional">Nutricionista</option>
                  <option value="ai_suggested">Sugestço da IA revisada</option>
                  <option value="automatic">Automática para revisão</option>
                </select>
              </div>
              {supersededOrigin === "ai_suggested" ? (
                <p className="text-xs text-muted-foreground">
                  A origem da sugestão da IA epreservada nesta nova versão.
                </p>
              ) : null}
              <textarea
                aria-label="Conteúdo da mensagem"
                className="min-h-36 rounded-md border bg-background p-3"
                placeholder="Escreva a mensagem para o paciente."
                value={content}
                disabled={ended || notStarted}
                onChange={event => setContent(event.target.value)}
             />
              {create.isError ? (
                <p role="alert" className="text-sm text-destructive">
                  Não foi possível concluir a ção. Recarregue o contexto e tente
                  novamente.
                </p>
              ) : null}
            </CardContent>
            </Card>
          }
          secondary={
            <Card>
              <CardHeader>
                <CardTitle>Ações</CardTitle>
                <CardDescription>
                  Envio exige uma ação explícita. Os estados do ascompanhamento são respeitados.
                </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2">
              <Button
                variant="outline"
                disabled={!content.trim() || create.isPending || ended || notStarted}
                onClick={() => submit("save_draft")}
              >
                Salvar rascunho
              </Button>
              <Button
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
            Ordem estável por data; mensagens anteriores podem ser carregadas sem
            duplicação.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {messages.isLoading && !items.length ? (
            <ProfessionalLoadingState label="Carregando mensagens..." />
          ) : null}
          {messages.isError ? (
            <ProfessionalAsyncState
              variant="panel"
              title="Não foi possível carregar as mensagens"
              description="Nenhuma mensagem nova foi adicionada à lista."
              onRetry={() => void messages.refetch()}
            />
          ) : null}
          {!messages.isLoading && !visibleItems.length ? (
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
            const patientName =
              selectedPatient?.displayName ?? item.patientName ?? "Paciente";
            const authorName =
              item.authorName ?? (fromPatient ? patientName : "Nutricionista");
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
                      <p className="break-words text-sm font-semibold">
                        {patientName}
                      </p>
                    ) : null}
                    <p className="break-words font-medium">
                      {fromPatient
                        ? "Mensagem do paciente"
                        : messageTypeLabels[item.messageType] ??
                          "Mensagem profissional"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {professionalLabel("origin", item.origin)} · Por {authorName} ·{" "}
                      {formatDate(item.createdAt)}
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
                  {patientId &&
                  item.state === "draft" &&
                  (trackingStatus === "active" ||
                    (paused && item.messageType === "administrative")) ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => continueDraft(item)}
                    >
                      Continuar edição
                    </Button>
                  ) : null}
                  {canRetry(item) ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={retry.isPending}
                      onClick={() => retry.mutate({ messageId: item.id })}
                    >
                      <RefreshCw className="h-4 w-4" />
                      Tentar novamente
                    </Button>
                  ) : null}
                </div>
                {retry.isError ? (
                  <p role="alert" className="mt-2 text-xs text-destructive">
                    Não foi possível tentar a entrega novamente. Confirme o
                    acesso e o estado do acompanhamento.
                  </p>
                ) : null}
              </article>
            );
          })}
          {messages.data?.nextCursor ? (
            <Button
              variant="outline"
              disabled={messages.isFetching}
              onClick={() => setCursor(messages.data?.nextCursor ?? undefined)}
            >
              {messages.isFetching
                ? "Carregando..."
                : "Carregar mensagens anteriores"}
            </Button>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
