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
  ProfessionalAsyncState,
  ProfessionalLoadingState,
  ProfessionalPage,
  ProfessionalPageHeader,
  ProfessionalStatusBadge,
} from "@/components/professional/ProfessionalUi";
import { professionalPatientPath } from "@/lib/professionalRoutes";
import { trpc } from "@/lib/trpc";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Search,
  UserRoundPlus,
} from "lucide-react";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";

type Filters = {
  search: string;
  authorizationStatus: "all" | "pending" | "approved" | "rejected" | "revoked";
  trackingStatus: "all" | "not_started" | "active" | "paused" | "ended";
  activity: "all" | "recent" | "inactive" | "unavailable";
  nextReview: "all" | "scheduled" | "due_soon" | "overdue" | "unavailable";
  page: number;
  pageSize: number;
};

function validValue<T extends string>(
  value: string | null,
  allowed: readonly T[],
  fallback: T
) {
  return value && allowed.includes(value as T) ? (value as T) : fallback;
}

export function filtersFromLocation(location: string): Filters {
  const params = new URLSearchParams(location.split("?")[1] ?? "");
  const page = Number(params.get("page"));
  return {
    search: params.get("search") ?? "",
    authorizationStatus: validValue(
      params.get("authorization"),
      ["all", "pending", "approved", "rejected", "revoked"] as const,
      "all"
    ),
    trackingStatus: validValue(
      params.get("tracking"),
      ["all", "not_started", "active", "paused", "ended"] as const,
      "all"
    ),
    activity: validValue(
      params.get("activity"),
      ["all", "recent", "inactive", "unavailable"] as const,
      "all"
    ),
    nextReview: validValue(
      params.get("review"),
      ["all", "scheduled", "due_soon", "overdue", "unavailable"] as const,
      "all"
    ),
    page: Number.isInteger(page) && page > 0 ? page : 1,
    pageSize: 20,
  };
}

export function filtersToLocation(filters: Filters) {
  const params = new URLSearchParams();
  if (filters.search) params.set("search", filters.search);
  if (filters.authorizationStatus !== "all")
    params.set("authorization", filters.authorizationStatus);
  if (filters.trackingStatus !== "all")
    params.set("tracking", filters.trackingStatus);
  if (filters.activity !== "all") params.set("activity", filters.activity);
  if (filters.nextReview !== "all") params.set("review", filters.nextReview);
  if (filters.page > 1) params.set("page", String(filters.page));
  const query = params.toString();
  return `/professional/patients${query ? `?${query}` : ""}`;
}

export function requestAccessErrorMessage(error: unknown) {
  const code = (error as { data?: { code?: string } } | null)?.data?.code;
  if (code === "FORBIDDEN" || code === "NOT_FOUND" || code === "BAD_REQUEST") {
    return "Não foi possível enviar a solicitação com os dados informados. Confira o contato ou tente novamente mais tarde.";
  }
  return "Não foi possível enviar a solicitação agora. Tente novamente em alguns instantes.";
}

function formatDate(value: number | null | undefined, fallback: string) {
  return value
    ? new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
      }).format(new Date(value))
    : fallback;
}

function unavailableActionLabel(status: Filters["authorizationStatus"]) {
  if (status === "pending") return "Aguardando autorização";
  if (status === "revoked") return "Acesso revogado";
  if (status === "rejected") return "Solicitação recusada";
  return "Acesso indisponível";
}

export default function ProfessionalPatients() {
  const [location, setLocation] = useLocation();
  const search = useSearch();
  const utils = trpc.useUtils();
  const locationWithSearch = `${location}${search ? `?${search}` : ""}`;
  const filters = useMemo(
    () => filtersFromLocation(locationWithSearch),
    [locationWithSearch]
  );
  const [searchInput, setSearchInput] = useState(filters.search);
  const [showRequest, setShowRequest] = useState(false);
  const [patientContact, setPatientContact] = useState("");
  const [reason, setReason] = useState("");
  const [requestSuccess, setRequestSuccess] = useState<string | null>(null);
  const [openingPatientId, setOpeningPatientId] = useState<number | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);

  const updateFilters = useCallback(
    (patch: Partial<Filters>) => {
      const next = filtersToLocation({ ...filters, ...patch });
      if (next !== locationWithSearch) setLocation(next, { replace: true });
    },
    [filters, locationWithSearch, setLocation]
  );

  useEffect(() => {
    setSearchInput(current =>
      current === filters.search ? current : filters.search
    );
  }, [filters.search]);

  useEffect(() => {
    if (searchInput === filters.search) return;
    const timer = window.setTimeout(() => {
      updateFilters({ search: searchInput, page: 1 });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [filters.search, searchInput, updateFilters]);

  const portfolio = trpc.nutrition.professionals.portfolio.useQuery(filters, {
    retry: false,
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
  });
  const requestAccess = trpc.nutrition.professionals.requestAccess.useMutation({
    onSuccess: async () => {
      setRequestSuccess(
        "Solicitação enviada. Ela ficará pendente até a autorização do paciente."
      );
      setPatientContact("");
      setReason("");
      await Promise.all([
        portfolio.refetch(),
        utils.nutrition.professionals.myAccesses.invalidate(),
      ]);
    },
  });

  const openPatient = async (item: any) => {
    setOpenError(null);
    setOpeningPatientId(item.patientUserId);
    try {
      await utils.nutrition.professionals.patientTimeZone.fetch({
        patientId: item.patientUserId,
        weekOffset: 0,
      });
      setLocation(professionalPatientPath(item.patientUserId));
    } catch {
      setOpenError(
        "O acesso a este paciente não está mais disponível. A carteira foi atualizada."
      );
      await portfolio.refetch();
    } finally {
      setOpeningPatientId(null);
    }
  };

  return (
    <ProfessionalPage>
      <ProfessionalPageHeader
        title="Pacientes"
        description="Localize vínculos, acompanhe autorização e situação do acompanhamento e abra o workspace individual com segurança."
        actions={
          <Button onClick={() => setShowRequest(value => !value)}>
            <UserRoundPlus className="h-4 w-4" />
            Solicitar acesso
          </Button>
        }
      />

      {showRequest ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5" />
              Adicionar paciente
            </CardTitle>
            <CardDescription>
              Informe o e-mail ou celular já cadastrado. A existência e a elegibilidade são validadas com segurança pelo sistema.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] lg:items-end">
            <label className="grid gap-1 text-sm">
              <span className="font-medium">E-mail ou celular</span>
              <Input
                value={patientContact}
                onChange={event => setPatientContact(event.target.value)}
                placeholder="paciente@exemplo.com ou celular"
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Motivo da solicitação</span>
              <Input
                value={reason}
                onChange={event => setReason(event.target.value)}
                placeholder="Ex.: iniciar acompanhamento nutricional"
              />
            </label>
            <Button
              disabled={
                patientContact.trim().length < 3 ||
                reason.trim().length < 3 ||
                requestAccess.isPending
              }
              onClick={() => {
                setRequestSuccess(null);
                requestAccess.reset();
                requestAccess.mutate({
                  patientContact: patientContact.trim(),
                  reason: reason.trim(),
                });
              }}
            >
              {requestAccess.isPending ? "Enviando..." : "Enviar solicitação"}
            </Button>
            {requestSuccess ? (
              <p
                role="status"
                className="text-sm text-emerald-700 lg:col-span-3 dark:text-emerald-300"
              >
                {requestSuccess}
              </p>
            ) : null}
            {requestAccess.isError ? (
              <p role="alert" className="text-sm text-destructive lg:col-span-3">
                {requestAccessErrorMessage(requestAccess.error)}
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <section
        aria-label="Filtros da carteira"
        className="grid min-w-0 gap-3 rounded-2xl border bg-card p-4 md:grid-cols-2 xl:grid-cols-[minmax(260px,1.4fr)_repeat(4,minmax(170px,1fr))]"
      >
        <label className="relative min-w-0">
          <span className="sr-only">Buscar paciente</span>
          <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-9"
            value={searchInput}
            onChange={event => setSearchInput(event.target.value)}
            placeholder="Nome, e-mail ou identificador"
          />
        </label>
        <select
          aria-label="Filtrar autorização"
          className="h-10 min-w-0 rounded-md border bg-background px-3 text-sm"
          value={filters.authorizationStatus}
          onChange={event =>
            updateFilters({
              authorizationStatus: event.target
                .value as Filters["authorizationStatus"],
              page: 1,
            })
          }
        >
          <option value="all">Todas as autorizações</option>
          <option value="pending">Pendentes</option>
          <option value="approved">Aprovadas</option>
          <option value="rejected">Recusadas</option>
          <option value="revoked">Revogadas</option>
        </select>
        <select
          aria-label="Filtrar acompanhamento"
          className="h-10 min-w-0 rounded-md border bg-background px-3 text-sm"
          value={filters.trackingStatus}
          onChange={event =>
            updateFilters({
              trackingStatus: event.target.value as Filters["trackingStatus"],
              page: 1,
            })
          }
        >
          <option value="all">Todos os acompanhamentos</option>
          <option value="not_started">Não iniciados</option>
          <option value="active">Ativos</option>
          <option value="paused">Pausados</option>
          <option value="ended">Encerrados</option>
        </select>
        <select
          aria-label="Filtrar atividade"
          className="h-10 min-w-0 rounded-md border bg-background px-3 text-sm"
          value={filters.activity}
          onChange={event =>
            updateFilters({
              activity: event.target.value as Filters["activity"],
              page: 1,
            })
          }
        >
          <option value="all">Qualquer atividade</option>
          <option value="recent">Atividade recente</option>
          <option value="inactive">Sem atividade recente</option>
          <option value="unavailable">Atividade não informada</option>
        </select>
        <select
          aria-label="Filtrar próxima revisão"
          className="h-10 min-w-0 rounded-md border bg-background px-3 text-sm"
          value={filters.nextReview}
          onChange={event =>
            updateFilters({
              nextReview: event.target.value as Filters["nextReview"],
              page: 1,
            })
          }
        >
          <option value="all">Qualquer revisão</option>
          <option value="scheduled">Revisão agendada</option>
          <option value="due_soon">Próximos 7 dias</option>
          <option value="overdue">Revisão atrasada</option>
          <option value="unavailable">Sem revisão agendada</option>
        </select>
      </section>

      {openError ? (
        <p
          role="alert"
          className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive"
        >
          {openError}
        </p>
      ) : null}
      {portfolio.isLoading ? (
        <ProfessionalLoadingState label="Carregando carteira profissional..." />
      ) : portfolio.isError ? (
        <ProfessionalAsyncState
          title="Não foi possível carregar a carteira"
          description="Nenhum dado de paciente foi exibido."
          onRetry={() => void portfolio.refetch()}
        />
      ) : portfolio.data?.items.length === 0 ? (
        <ProfessionalAsyncState
          icon="empty"
          title="Nenhum paciente encontrado"
          description="Ajuste os filtros ou solicite acesso a um novo paciente."
        />
      ) : (
        <div className="grid gap-3">
          {portfolio.data?.items.map((item: any) => {
            const accessible = item.authorizationStatus === "approved";
            const displayName =
              item.patientName ??
              (accessible ? item.patientEmail : null) ??
              `Paciente ${item.patientUserId}`;
            return (
              <article
                key={item.authorizationId}
                className="grid min-w-0 gap-4 rounded-2xl border bg-card p-4 shadow-sm lg:grid-cols-[minmax(220px,1.4fr)_minmax(150px,.8fr)_minmax(150px,.8fr)_minmax(200px,1fr)_auto] lg:items-center"
              >
                <div className="min-w-0">
                  <h2 className="break-words font-semibold">{displayName}</h2>
                  <p className="mt-1 break-words text-sm text-muted-foreground">
                    {accessible
                      ? item.patientEmail ?? "Identificação não informada"
                      : "Dados pessoais e clínicos disponíveis após autorização"}
                  </p>
                </div>
                <div className="min-w-0">
                  <p className="mb-1 text-xs text-muted-foreground">Autorização</p>
                  <ProfessionalStatusBadge
                    kind="authorization"
                    value={item.authorizationStatus}
                  />
                </div>
                <div className="min-w-0">
                  <p className="mb-1 text-xs text-muted-foreground">Acompanhamento</p>
                  {accessible ? (
                    <ProfessionalStatusBadge
                      kind="tracking"
                      value={item.trackingStatus ?? "not_started"}
                    />
                  ) : (
                    <p className="text-sm font-medium text-muted-foreground">
                      Disponível após autorização
                    </p>
                  )}
                </div>
                <dl className="min-w-0 space-y-2 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground">Última atividade</dt>
                    <dd className="break-words font-medium">
                      {accessible
                        ? formatDate(item.lastFoodActivityAt, "Não informado")
                        : "Disponível após autorização"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Próxima revisão</dt>
                    <dd className="break-words font-medium">
                      {accessible
                        ? formatDate(item.nextReviewAt, "Sem revisão agendada")
                        : "Disponível após autorização"}
                    </dd>
                  </div>
                </dl>
                <Button
                  variant={accessible ? "default" : "outline"}
                  disabled={!accessible || openingPatientId !== null}
                  onClick={() => void openPatient(item)}
                >
                  {openingPatientId === item.patientUserId
                    ? "Validando..."
                    : accessible
                      ? "Abrir paciente"
                      : unavailableActionLabel(item.authorizationStatus)}
                </Button>
              </article>
            );
          })}
        </div>
      )}

      {portfolio.data && portfolio.data.pagination.totalPages > 1 ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            Página {portfolio.data.pagination.page} de {portfolio.data.pagination.totalPages}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={filters.page <= 1}
              onClick={() => updateFilters({ page: filters.page - 1 })}
            >
              <ChevronLeft className="h-4 w-4" />
              Anterior
            </Button>
            <Button
              variant="outline"
              disabled={filters.page >= portfolio.data.pagination.totalPages}
              onClick={() => updateFilters({ page: filters.page + 1 })}
            >
              Próxima
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ) : null}
    </ProfessionalPage>
  );
}
