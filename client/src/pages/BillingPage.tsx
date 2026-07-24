import DashboardLayout from "@/components/DashboardLayout";
import PageIntro from "@/components/PageIntro";
import { Badge } from "@/components/ui/badge";
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
  BadgeCheck,
  CalendarClock,
  CreditCard,
  RefreshCw,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import React from "react";
import { toast } from "sonner";

const ACCESS_LABELS: Record<string, string> = {
  active_subscription: "Assinatura própria ativa",
  sponsored_by_professional: "Cobertura do profissional",
  active_trial: "Período de avaliação ativo",
  admin_override: "Liberação administrativa",
  free_access: "Acesso aberto de transição",
  no_access: "Acesso aguardando ativação",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "Pendente",
  active: "Ativa",
  past_due: "Pagamento pendente",
  canceled: "Cancelada",
  expired: "Expirada",
};

const CYCLE_LABELS: Record<string, string> = {
  monthly: "Mensal",
  yearly: "Anual",
  custom: "Personalizado",
};

function formatDate(value: Date | string | null | undefined) {
  if (!value) return "Não informado";
  return new Date(value).toLocaleDateString("pt-BR");
}

function formatMoney(amountMinor: number, currency: string) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency,
  }).format(amountMinor / 100);
}

export default function BillingPage() {
  const status = trpc.billing.subscriptionStatus.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: true,
    staleTime: 15_000,
  });
  const refreshActivation =
    trpc.billing.refreshOnboardingActivation.useMutation({
      onSuccess: async result => {
        if (
          result.status === "activated" ||
          result.status === "already_active"
        ) {
          toast.success("Situação de acesso atualizada.");
        } else if (result.status === "blocked") {
          toast.info("A ativação ainda aguarda uma origem válida de acesso.");
        } else if (result.status === "completion_in_progress") {
          toast.info("A conclusão do cadastro ainda está em processamento.");
        } else {
          toast.info("Não há ativação pendente para esta conta.");
        }
        await status.refetch();
      },
      onError: error =>
        toast.error(error.message || "Não foi possível reavaliar o acesso."),
    });

  if (status.isLoading) {
    return (
      <DashboardLayout>
        <div
          role="status"
          className="mx-auto max-w-5xl rounded-2xl border bg-card p-8 text-sm text-muted-foreground"
        >
          Carregando situação do plano e do acesso...
        </div>
      </DashboardLayout>
    );
  }

  if (status.isError || !status.data) {
    return (
      <DashboardLayout>
        <Card className="mx-auto max-w-xl">
          <CardContent className="space-y-4 py-10 text-center">
            <AlertTriangle className="mx-auto h-10 w-10 text-destructive" />
            <div>
              <h1 className="text-lg font-semibold">
                Não foi possível consultar o acesso
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Nenhuma cobrança ou alteração foi realizada. Tente novamente.
              </p>
            </div>
            <Button variant="outline" onClick={() => void status.refetch()}>
              <RefreshCw className="h-4 w-4" />
              Tentar novamente
            </Button>
          </CardContent>
        </Card>
      </DashboardLayout>
    );
  }

  const { access, subscription, professionalSubscription } = status.data;
  const accessLabel = ACCESS_LABELS[access.reason] ?? access.reason;
  const capacityAvailable =
    professionalSubscription?.capacityLimit == null
      ? null
      : Math.max(
          0,
          professionalSubscription.capacityLimit -
            professionalSubscription.capacityUsed
        );

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-6xl space-y-6">
        <PageIntro
          eyebrow="Comercial e elegibilidade"
          title="Plano e acesso"
          description="Consulte a origem efetiva do seu acesso, a situação normalizada da assinatura e, no perfil profissional, a capacidade contratada. Todas as informações vêm do backend comercial."
        />

        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {access.allowed ? (
                  <BadgeCheck className="h-5 w-5 text-emerald-600" />
                ) : (
                  <AlertTriangle className="h-5 w-5 text-amber-600" />
                )}
                Situação atual do acesso
              </CardTitle>
              <CardDescription>
                A assinatura, a cobertura profissional e uma liberação
                administrativa são origens diferentes e permanecem separadas.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="flex flex-wrap items-center gap-3">
                <Badge variant={access.allowed ? "default" : "secondary"}>
                  {access.allowed ? "Acesso liberado" : "Aguardando ativação"}
                </Badge>
                <span className="text-sm font-medium">{accessLabel}</span>
              </div>

              <dl className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-xl border p-4">
                  <dt className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                    Origem efetiva
                  </dt>
                  <dd className="mt-2 font-semibold">{accessLabel}</dd>
                </div>
                <div className="rounded-xl border p-4">
                  <dt className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                    Vigência
                  </dt>
                  <dd className="mt-2 font-semibold">
                    {access.validUntil
                      ? `Até ${formatDate(access.validUntil)}`
                      : "Sem término informado"}
                  </dd>
                </div>
              </dl>

              {!access.sourceAvailable ? (
                <div
                  role="alert"
                  className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm"
                >
                  A fonte comercial está temporariamente indisponível. O sistema
                  aplicou a política segura configurada para este ambiente.
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5" />
                Próxima etapa
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm text-muted-foreground">
              {access.allowed ? (
                <p>
                  Seu acesso está válido. Você pode continuar usando os recursos
                  liberados normalmente.
                </p>
              ) : (
                <>
                  <p>
                    O cadastro está preservado, mas os recursos protegidos ficam
                    bloqueados até existir uma origem válida de acesso.
                  </p>
                  <Button
                    variant="outline"
                    className="w-full"
                    disabled={refreshActivation.isPending}
                    onClick={() => refreshActivation.mutate()}
                  >
                    <RefreshCw
                      className={`h-4 w-4 ${
                        refreshActivation.isPending ? "animate-spin" : ""
                      }`}
                    />
                    {refreshActivation.isPending
                      ? "Reavaliando acesso..."
                      : "Reavaliar ativação"}
                  </Button>
                </>
              )}
              <p>
                Checkout e alteração de plano serão exibidos somente após a
                aprovação do catálogo comercial e a integração segura do primeiro
                provedor financeiro.
              </p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CreditCard className="h-5 w-5" />
              Assinatura própria
            </CardTitle>
            <CardDescription>
              O retorno do navegador nunca confirma pagamento. Somente o estado
              confiável do backend pode ativar uma assinatura.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {subscription ? (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <Detail
                  label="Plano"
                  value={subscription.planName}
                  supporting={subscription.planCode}
                />
                <Detail
                  label="Situação"
                  value={STATUS_LABELS[subscription.status] ?? subscription.status}
                  supporting={
                    CYCLE_LABELS[subscription.billingCycle] ??
                    subscription.billingCycle
                  }
                />
                <Detail
                  label="Valor de referência"
                  value={formatMoney(
                    subscription.unitAmount,
                    subscription.currency
                  )}
                  supporting="Obtido do catálogo do backend"
                />
                <Detail
                  label="Período vigente"
                  value={formatDate(subscription.currentPeriodEnd)}
                  supporting={
                    subscription.cancelAtPeriodEnd
                      ? "Cancelamento ao fim do período"
                      : `Início: ${formatDate(subscription.currentPeriodStart)}`
                  }
                />
              </div>
            ) : (
              <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
                Nenhuma assinatura própria foi localizada. O acesso pode existir
                por cobertura profissional, liberação administrativa ou modo
                aberto de transição.
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UsersRound className="h-5 w-5" />
              Capacidade profissional
            </CardTitle>
            <CardDescription>
              A capacidade é persistida e reservada de forma concorrente pelo
              backend. A interface apenas apresenta o contrato atual.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {professionalSubscription ? (
              <div className="space-y-5">
                <div className="grid gap-4 sm:grid-cols-3">
                  <Detail
                    label="Contratada"
                    value={
                      professionalSubscription.capacityLimit == null
                        ? "Sem limite configurado"
                        : professionalSubscription.capacityLimit.toLocaleString(
                            "pt-BR"
                          )
                    }
                    supporting={professionalSubscription.planName}
                  />
                  <Detail
                    label="Ocupada"
                    value={professionalSubscription.capacityUsed.toLocaleString(
                      "pt-BR"
                    )}
                    supporting="Pacientes com vaga ativa"
                  />
                  <Detail
                    label="Disponível"
                    value={
                      capacityAvailable == null
                        ? "Não aplicável"
                        : capacityAvailable.toLocaleString("pt-BR")
                    }
                    supporting="Calculada a partir do contrato canônico"
                  />
                </div>
                <div>
                  <p className="mb-2 text-sm font-medium">
                    Recursos profissionais contratados
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {professionalSubscription.entitlements.map(resource => (
                      <Badge key={resource} variant="outline">
                        {resource
                          .replace(/^professional_/, "")
                          .replaceAll("_", " ")}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
                Não há assinatura profissional ativa com capacidade contratada.
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex items-start gap-3 rounded-xl border bg-muted/20 p-4 text-sm text-muted-foreground">
          <CalendarClock className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Esta página é consultiva durante o rollout. Preços definitivos,
            checkout, alteração de plano e políticas de inadimplência só serão
            ativados após decisão comercial aprovada e integração do provedor.
          </p>
        </div>
      </div>
    </DashboardLayout>
  );
}

function Detail({
  label,
  value,
  supporting,
}: {
  label: string;
  value: string;
  supporting: string;
}) {
  return (
    <div className="rounded-xl border p-4">
      <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-2 font-semibold tracking-tight">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{supporting}</p>
    </div>
  );
}
