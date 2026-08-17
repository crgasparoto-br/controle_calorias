import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import {
  AlertTriangle,
  BadgeCheck,
  Ban,
  BarChart3,
  RefreshCw,
  Search,
  ShieldPlus,
  UsersRound,
} from "lucide-react";
import React, { useMemo, useState } from "react";
import { toast } from "sonner";

const ACCESS_REASON_OPTIONS = [
  { value: "all", label: "Todas as origens" },
  { value: "admin_override", label: "Liberação administrativa" },
  { value: "sponsored_by_professional", label: "Cobertura profissional" },
  { value: "active_subscription", label: "Assinatura ativa" },
  { value: "active_trial", label: "Trial ativo" },
  { value: "transition_access", label: "Período de transição" },
  { value: "read_only_access", label: "Somente leitura" },
  { value: "free_access", label: "Acesso aberto" },
  { value: "no_access", label: "Sem acesso" },
] as const;

type AccessReason = Exclude<
  (typeof ACCESS_REASON_OPTIONS)[number]["value"],
  "all"
>;

const ACCESS_REASON_LABELS = Object.fromEntries(
  ACCESS_REASON_OPTIONS.map(option => [option.value, option.label])
) as Record<string, string>;

function formatDate(value: Date | string | null | undefined) {
  if (!value) return "Sem término";
  return new Date(value).toLocaleString("pt-BR");
}

function formatCurrency(amountMinor: number, currency: string) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency,
  }).format(amountMinor / 100);
}

export default function BillingAdminPanel() {
  const utils = trpc.useUtils();
  const [query, setQuery] = useState("");
  const [accessReason, setAccessReason] = useState<"all" | AccessReason>("all");
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [grantReason, setGrantReason] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [revokeReasons, setRevokeReasons] = useState<Record<string, string>>({});

  const analytics = trpc.billing.adminAnalytics.useQuery(undefined, {
    retry: false,
  });
  const users = trpc.billing.adminSearchUsers.useQuery(
    {
      query,
      limit: 25,
      ...(accessReason === "all" ? {} : { accessReason }),
    },
    { retry: false }
  );
  const overrides = trpc.billing.adminListOverrides.useQuery(
    { userId: selectedUserId ?? 1, limit: 25 },
    { enabled: selectedUserId !== null, retry: false }
  );

  const selectedUser = useMemo(
    () => users.data?.find(user => user.id === selectedUserId) ?? null,
    [selectedUserId, users.data]
  );

  const invalidateBillingAdmin = async () => {
    await Promise.all([
      utils.billing.adminAnalytics.invalidate(),
      utils.billing.adminSearchUsers.invalidate(),
      selectedUserId
        ? utils.billing.adminListOverrides.invalidate({
            userId: selectedUserId,
            limit: 25,
          })
        : Promise.resolve(),
    ]);
  };

  const grantOverride = trpc.billing.adminGrantOverride.useMutation({
    onSuccess: async () => {
      toast.success("Liberação administrativa registrada.");
      setGrantReason("");
      setStartsAt("");
      setEndsAt("");
      await invalidateBillingAdmin();
    },
    onError: error =>
      toast.error(error.message || "Não foi possível conceder a liberação."),
  });

  const revokeOverride = trpc.billing.adminRevokeOverride.useMutation({
    onSuccess: async result => {
      toast.success("Liberação administrativa revogada.");
      setRevokeReasons(current => {
        const next = { ...current };
        delete next[result.id];
        return next;
      });
      await invalidateBillingAdmin();
    },
    onError: error =>
      toast.error(error.message || "Não foi possível revogar a liberação."),
  });

  const canGrant =
    selectedUserId !== null &&
    grantReason.trim().length >= 3 &&
    !grantOverride.isPending;

  const submitGrant = () => {
    if (!selectedUserId || !canGrant) return;
    grantOverride.mutate({
      userId: selectedUserId,
      reason: grantReason.trim(),
      ...(startsAt ? { startsAt: new Date(startsAt) } : {}),
      ...(endsAt ? { endsAt: new Date(endsAt) } : {}),
    });
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Metric
          label="Overrides ativos"
          value={(analytics.data?.activeOverrides ?? 0).toLocaleString("pt-BR")}
          supporting="liberações administrativas vigentes"
        />
        <Metric
          label="Sem acesso comercial"
          value={(analytics.data?.usersWithoutCommercialAccess ?? 0).toLocaleString(
            "pt-BR"
          )}
          supporting="sem nenhuma origem válida"
        />
        <Metric
          label="Planos catalogados"
          value={(analytics.data?.plans.length ?? 0).toLocaleString("pt-BR")}
          supporting="ativos e inativos no backend"
        />
        <Metric
          label="Assinaturas ativas"
          value={(
            analytics.data?.subscriptionStatusTotals.active ?? 0
          ).toLocaleString("pt-BR")}
          supporting="estado normalizado ativo"
        />
      </div>

      {analytics.isError ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
        >
          <span>Não foi possível carregar os indicadores comerciais.</span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void analytics.refetch()}
          >
            <RefreshCw className="h-4 w-4" />
            Tentar novamente
          </Button>
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr),minmax(360px,0.85fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UsersRound className="h-5 w-5" />
              Usuários e origem do acesso
            </CardTitle>
            <CardDescription>
              Pesquise por nome, e-mail ou telefone. A situação exibida é a
              decisão efetiva do serviço central de elegibilidade.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr),220px]">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-9"
                  value={query}
                  onChange={event => setQuery(event.target.value)}
                  placeholder="Buscar usuário..."
                  aria-label="Buscar usuário por nome, e-mail ou telefone"
                />
              </div>
              <select
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                value={accessReason}
                onChange={event =>
                  setAccessReason(event.target.value as "all" | AccessReason)
                }
                aria-label="Filtrar pela origem do acesso"
              >
                {ACCESS_REASON_OPTIONS.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            {users.isLoading ? (
              <div role="status" className="rounded-xl border p-6 text-sm text-muted-foreground">
                Consultando usuários e elegibilidade...
              </div>
            ) : users.isError ? (
              <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-sm text-destructive">
                {users.error.message || "Não foi possível pesquisar os usuários."}
              </div>
            ) : users.data?.length ? (
              <div className="divide-y rounded-xl border">
                {users.data.map(user => {
                  const selected = user.id === selectedUserId;
                  return (
                    <button
                      key={user.id}
                      type="button"
                      className={`flex w-full flex-col gap-3 p-4 text-left transition-colors first:rounded-t-xl last:rounded-b-xl hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex-row sm:items-center sm:justify-between ${selected ? "bg-muted/60" : ""}`}
                      onClick={() => setSelectedUserId(user.id)}
                      aria-pressed={selected}
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium">
                          {user.name || "Usuário sem nome"}
                        </p>
                        <p className="truncate text-sm text-muted-foreground">
                          {user.email || user.phoneNumber || `Usuário #${user.id}`}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={user.access.allowed ? "default" : "secondary"}>
                          {user.access.allowed ? "Liberado" : "Sem acesso"}
                        </Badge>
                        <Badge variant="outline">
                          {ACCESS_REASON_LABELS[user.access.reason] ??
                            user.access.reason}
                        </Badge>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
                Nenhum usuário corresponde à consulta e ao filtro atuais.
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldPlus className="h-5 w-5" />
              Exceção administrativa
            </CardTitle>
            <CardDescription>
              A liberação não cria assinatura, checkout ou evento financeiro.
              Motivo, autoria e vigência ficam auditáveis.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {selectedUser ? (
              <>
                <div className="rounded-xl border bg-muted/20 p-4">
                  <p className="font-medium">
                    {selectedUser.name || "Usuário sem nome"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {selectedUser.email || selectedUser.phoneNumber}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Situação atual: {ACCESS_REASON_LABELS[selectedUser.access.reason]}
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="billing-override-reason">Motivo</Label>
                  <Textarea
                    id="billing-override-reason"
                    rows={3}
                    value={grantReason}
                    onChange={event => setGrantReason(event.target.value)}
                    placeholder="Descreva por que o acesso está sendo liberado."
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="billing-override-start">Início opcional</Label>
                    <Input
                      id="billing-override-start"
                      type="datetime-local"
                      value={startsAt}
                      onChange={event => setStartsAt(event.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="billing-override-end">Término opcional</Label>
                    <Input
                      id="billing-override-end"
                      type="datetime-local"
                      value={endsAt}
                      onChange={event => setEndsAt(event.target.value)}
                    />
                  </div>
                </div>
                <Button className="w-full" disabled={!canGrant} onClick={submitGrant}>
                  <BadgeCheck className="h-4 w-4" />
                  {grantOverride.isPending
                    ? "Registrando liberação..."
                    : "Conceder liberação"}
                </Button>
              </>
            ) : (
              <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
                Selecione um usuário na lista para consultar o histórico ou
                conceder uma liberação.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {selectedUserId !== null ? (
        <Card>
          <CardHeader>
            <CardTitle>Histórico de liberações</CardTitle>
            <CardDescription>
              Registros permanecem visíveis depois da recarga e da revogação.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {overrides.isLoading ? (
              <div role="status" className="text-sm text-muted-foreground">
                Carregando histórico...
              </div>
            ) : overrides.isError ? (
              <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
                <span>{overrides.error.message || "Não foi possível carregar o histórico."}</span>
                <Button size="sm" variant="outline" onClick={() => void overrides.refetch()}>
                  <RefreshCw className="h-4 w-4" />
                  Tentar novamente
                </Button>
              </div>
            ) : overrides.data?.length ? (
              overrides.data.map(override => {
                const active = override.state === "active";
                const revokeReason = revokeReasons[override.id] ?? "";
                return (
                  <div key={override.id} className="grid gap-4 rounded-xl border p-4 lg:grid-cols-[minmax(0,1fr),minmax(280px,0.7fr)]">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={active ? "default" : "secondary"}>
                          {override.state === "active"
                            ? "Ativa"
                            : override.state === "revoked"
                              ? "Revogada"
                              : "Expirada"}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {formatDate(override.startsAt)} até {formatDate(override.endsAt)}
                        </span>
                      </div>
                      <p className="mt-3 text-sm">{override.reason}</p>
                      <p className="mt-2 text-xs text-muted-foreground">
                        Autor: usuário #{override.grantedByUserId ?? "indisponível"}
                        {override.revokedByUserId
                          ? ` · Revogado por #${override.revokedByUserId}`
                          : ""}
                      </p>
                    </div>
                    {active ? (
                      <div className="space-y-2">
                        <Label htmlFor={`revoke-${override.id}`}>
                          Motivo da revogação
                        </Label>
                        <Input
                          id={`revoke-${override.id}`}
                          value={revokeReason}
                          onChange={event =>
                            setRevokeReasons(current => ({
                              ...current,
                              [override.id]: event.target.value,
                            }))
                          }
                          placeholder="Informe o motivo"
                        />
                        <Button
                          variant="destructive"
                          className="w-full"
                          disabled={
                            revokeReason.trim().length < 3 ||
                            revokeOverride.isPending
                          }
                          onClick={() =>
                            revokeOverride.mutate({
                              overrideId: override.id,
                              reason: revokeReason.trim(),
                            })
                          }
                        >
                          <Ban className="h-4 w-4" />
                          Revogar liberação
                        </Button>
                      </div>
                    ) : null}
                  </div>
                );
              })
            ) : (
              <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
                Nenhuma liberação administrativa registrada para este usuário.
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            Planos e receita estimada
          </CardTitle>
          <CardDescription>
            Valores são separados por moeda e tratados como estimativa operacional.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {analytics.data?.estimatedMonthlyRecurringRevenue.map(item => (
            <div key={item.currency} className="flex items-center justify-between rounded-xl border p-4">
              <span className="text-sm text-muted-foreground">
                Receita recorrente mensal estimada · {item.currency}
              </span>
              <span className="font-semibold">
                {formatCurrency(item.amountMinor, item.currency)}
              </span>
            </div>
          ))}
          {analytics.data?.plans.map(plan => (
            <div key={plan.planId} className="grid gap-3 rounded-xl border p-4 md:grid-cols-[minmax(0,1fr),auto]">
              <div className="min-w-0">
                <p className="font-medium">{plan.planName}</p>
                <p className="break-words text-sm text-muted-foreground">
                  {plan.versionCode} · {plan.audience === "professional" ? "Profissional" : "Individual"}
                </p>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                <Badge variant="outline">
                  {formatCurrency(plan.unitAmount, plan.currency)}
                </Badge>
                <Badge variant="outline">
                  {plan.coveredBeneficiaries.toLocaleString("pt-BR")} coberturas
                </Badge>
                <Badge variant="outline">
                  {plan.capacityUsed.toLocaleString("pt-BR")} vagas ocupadas
                </Badge>
              </div>
            </div>
          ))}
          {!analytics.isLoading && !analytics.data?.plans.length ? (
            <div className="flex items-center gap-3 rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
              <AlertTriangle className="h-4 w-4" />
              Nenhum plano provider-neutral foi catalogado neste ambiente.
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({
  label,
  value,
  supporting,
}: {
  label: string;
  value: string;
  supporting: string;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="mt-2 text-2xl font-semibold">{value}</p>
        <p className="mt-1 text-xs text-muted-foreground">{supporting}</p>
      </CardContent>
    </Card>
  );
}
