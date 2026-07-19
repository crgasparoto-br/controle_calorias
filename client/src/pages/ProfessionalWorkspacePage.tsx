import ProfessionalLayout, {
  useProfessionalWorkspace,
} from "@/components/ProfessionalLayout";
import PageIntro from "@/components/PageIntro";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import {
  AlertCircle,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Search,
  UsersRound,
} from "lucide-react";
import React, { useState } from "react";
import { useLocation } from "wouter";

const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
});
const authorizationLabels: Record<string, string> = {
  pending: "Pendente",
  approved: "Aprovada",
  rejected: "Recusada",
  revoked: "Revogada",
};
const trackingLabels: Record<string, string> = {
  active: "Ativo",
  paused: "Pausado",
  ended: "Encerrado",
  not_started: "Não iniciado",
};

type Filters = {
  search: string;
  authorizationStatus: "all" | "pending" | "approved" | "rejected" | "revoked";
  trackingStatus: "all" | "not_started" | "active" | "paused" | "ended";
  activity: "all" | "recent" | "inactive" | "unavailable";
  page: number;
  pageSize: number;
};

const initialFilters: Filters = {
  search: "",
  authorizationStatus: "all",
  trackingStatus: "all",
  activity: "all",
  page: 1,
  pageSize: 20,
};

function formatDate(value: number | null) {
  return value ? dateFormatter.format(new Date(value)) : "Não informado";
}

function PortfolioState({
  filters,
  setFilters,
  compact = false,
}: {
  filters: Filters;
  setFilters: React.Dispatch<React.SetStateAction<Filters>>;
  compact?: boolean;
}) {
  const [, setLocation] = useLocation();
  const { selectPatient } = useProfessionalWorkspace();
  const query = trpc.nutrition.professionals.portfolio.useQuery(filters, {
    retry: false,
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
  });

  if (query.isLoading)
    return (
      <div
        role="status"
        className="rounded-2xl border bg-card p-8 text-sm text-muted-foreground"
      >
        Carregando carteira profissional...
      </div>
    );
  if (query.isError)
    return (
      <div role="alert" className="rounded-2xl border bg-card p-8">
        <AlertCircle className="h-8 w-8 text-destructive" />
        <h2 className="mt-3 font-semibold">
          Não foi possível carregar a carteira
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Tente novamente. Nenhum dado anterior será reutilizado.
        </p>
        <Button
          className="mt-4"
          variant="outline"
          onClick={() => void query.refetch()}
        >
          <RefreshCw className="h-4 w-4" />
          Tentar novamente
        </Button>
      </div>
    );

  const data = query.data;
  if (!data) return null;
  return (
    <>
      {!compact && (
        <div className="grid gap-3 md:grid-cols-4">
          <label className="relative md:col-span-1">
            <span className="sr-only">Buscar paciente</span>
            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-9"
              value={filters.search}
              onChange={event =>
                setFilters(current => ({
                  ...current,
                  search: event.target.value,
                  page: 1,
                }))
              }
              placeholder="Nome, e-mail ou identificador"
            />
          </label>
          <select
            aria-label="Filtrar autorização"
            className="h-10 rounded-md border bg-background px-3 text-sm"
            value={filters.authorizationStatus}
            onChange={event =>
              setFilters(current => ({
                ...current,
                authorizationStatus: event.target
                  .value as Filters["authorizationStatus"],
                page: 1,
              }))
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
            className="h-10 rounded-md border bg-background px-3 text-sm"
            value={filters.trackingStatus}
            onChange={event =>
              setFilters(current => ({
                ...current,
                trackingStatus: event.target.value as Filters["trackingStatus"],
                page: 1,
              }))
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
            className="h-10 rounded-md border bg-background px-3 text-sm"
            value={filters.activity}
            onChange={event =>
              setFilters(current => ({
                ...current,
                activity: event.target.value as Filters["activity"],
                page: 1,
              }))
            }
          >
            <option value="all">Qualquer atividade</option>
            <option value="recent">Atividade recente</option>
            <option value="inactive">Sem atividade recente</option>
            <option value="unavailable">Atividade indisponível</option>
          </select>
        </div>
      )}

      {data.items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-12 text-center">
            <UsersRound className="h-10 w-10 text-muted-foreground" />
            <h2 className="mt-4 font-semibold">Nenhum paciente encontrado</h2>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">
              Ajuste os filtros ou use a experiência legada para enviar uma nova
              solicitação de acompanhamento.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {data.items.map(item => {
            const accessible = item.authorizationStatus === "approved";
            const displayName =
              item.patientName ??
              item.patientEmail ??
              `Paciente ${item.patientUserId}`;
            return (
              <Card key={item.authorizationId}>
                <CardContent className="grid gap-4 p-5 lg:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))_auto] lg:items-center">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{displayName}</p>
                    <p className="truncate text-sm text-muted-foreground">
                      {item.patientEmail ??
                        `Identificador ${item.patientUserId}`}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Autorização</p>
                    <p className="text-sm font-medium">
                      {authorizationLabels[item.authorizationStatus]}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">
                      Acompanhamento
                    </p>
                    <p className="text-sm font-medium">
                      {item.trackingStatus
                        ? trackingLabels[item.trackingStatus]
                        : "Não iniciado"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">
                      Última atividade
                    </p>
                    <p className="text-sm font-medium">
                      {formatDate(item.lastFoodActivityAt)}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Interação:{" "}
                      {formatDate(item.lastProfessionalInteractionAt)}
                    </p>
                  </div>
                  <Button
                    disabled={!accessible}
                    onClick={() => {
                      selectPatient({
                        patientId: item.patientUserId,
                        displayName,
                      });
                      setLocation("/professional/follow-up");
                    }}
                  >
                    {accessible ? "Abrir paciente" : "Aguardando acesso"}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {!compact && data.pagination.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Página {data.pagination.page} de {data.pagination.totalPages} ·{" "}
            {data.pagination.total} vínculos
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={filters.page <= 1}
              onClick={() =>
                setFilters(current => ({ ...current, page: current.page - 1 }))
              }
            >
              <ChevronLeft className="h-4 w-4" />
              Anterior
            </Button>
            <Button
              variant="outline"
              disabled={filters.page >= data.pagination.totalPages}
              onClick={() =>
                setFilters(current => ({ ...current, page: current.page + 1 }))
              }
            >
              Próxima
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

function ProfessionalHome() {
  const [, setLocation] = useLocation();
  const [filters, setFilters] = useState<Filters>({
    ...initialFilters,
    pageSize: 10,
  });
  const query = trpc.nutrition.professionals.portfolio.useQuery(filters, {
    retry: false,
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
  });
  const summary = query.data?.summary;
  const cards = [
    ["Acompanhamentos ativos", summary?.active ?? 0],
    ["Pausados", summary?.paused ?? 0],
    ["Encerrados", summary?.ended ?? 0],
    ["Ainda não iniciados", summary?.notStarted ?? 0],
    ["Solicitações pendentes", summary?.pendingRequests ?? 0],
    ["Sem registros há 3 dias", summary?.withoutRecentActivity ?? 0],
  ];
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageIntro
        title="Início profissional"
        description="Acompanhe a situação da carteira e abra rapidamente o contexto de cada paciente."
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map(([label, value]) => (
          <Card key={String(label)}>
            <CardHeader className="pb-2">
              <CardDescription>{label}</CardDescription>
              <CardTitle className="text-3xl">{value}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Pacientes e solicitações</h2>
          <p className="text-sm text-muted-foreground">
            Ordenação estável por identificação do paciente.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => setLocation("/professional/patients")}
        >
          Ver carteira completa
        </Button>
      </div>
      <PortfolioState filters={filters} setFilters={setFilters} compact />
    </div>
  );
}

function PatientsPage() {
  const [filters, setFilters] = useState<Filters>(initialFilters);
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageIntro
        title="Pacientes"
        description="Localize vínculos, acompanhe autorizações e filtre a carteira por situação operacional."
      />
      <PortfolioState filters={filters} setFilters={setFilters} />
    </div>
  );
}

const remainingContent: Record<string, { title: string; description: string }> =
  {
    "/professional/follow-up": {
      title: "Acompanhamento",
      description:
        "O prontuário e o ciclo de acompanhamento serão incorporados aqui sem misturar dados pessoais do profissional.",
    },
    "/professional/messages": {
      title: "Mensagens",
      description:
        "A comunicação profissional persistente será centralizada neste espaço.",
    },
    "/professional/reports": {
      title: "Relatórios profissionais",
      description:
        "Os relatórios individuais e da carteira serão adicionados reutilizando os cálculos canônicos.",
    },
    "/professional/settings": {
      title: "Configurações profissionais",
      description:
        "Gerencie identificação e preferências próprias do contexto profissional.",
    },
  };

function Placeholder({ location }: { location: string }) {
  const content =
    remainingContent[location] ?? remainingContent["/professional/follow-up"];
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageIntro title={content.title} description={content.description} />
      <Card>
        <CardHeader>
          <CardTitle>Contexto do acompanhamento</CardTitle>
          <CardDescription>
            Esta etapa será entregue incrementalmente, preservando a experiência
            profissional legada.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center gap-2 text-sm text-muted-foreground">
          <CalendarClock className="h-4 w-4" />O paciente selecionado permanece
          identificado no cabeçalho profissional.
        </CardContent>
      </Card>
    </div>
  );
}

export default function ProfessionalWorkspacePage() {
  const [location] = useLocation();
  return (
    <ProfessionalLayout>
      {location === "/professional" ? (
        <ProfessionalHome />
      ) : location === "/professional/patients" ? (
        <PatientsPage />
      ) : (
        <Placeholder location={location} />
      )}
    </ProfessionalLayout>
  );
}
