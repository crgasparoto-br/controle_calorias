import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { AlertTriangle, CircleDollarSign, Layers3 } from "lucide-react";
import React from "react";

const STATUS_LABELS: Record<string, string> = {
  pending: "Pendentes",
  active: "Ativas",
  past_due: "Inadimplentes",
  canceled: "Canceladas",
  expired: "Expiradas",
};

const CYCLE_LABELS: Record<string, string> = {
  monthly: "Mensal",
  yearly: "Anual",
  custom: "Personalizado",
};

const STATUS_ORDER = [
  "pending",
  "active",
  "past_due",
  "canceled",
  "expired",
] as const;

function formatCurrency(amountMinor: number, currency: string) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency,
  }).format(amountMinor / 100);
}

export default function BillingAdminStatusOverview() {
  const analytics = trpc.billing.adminAnalytics.useQuery(undefined, {
    retry: false,
  });

  if (analytics.isLoading) {
    return (
      <div
        role="status"
        className="rounded-2xl border bg-card p-6 text-sm text-muted-foreground"
      >
        Carregando visão geral comercial...
      </div>
    );
  }

  if (analytics.isError || !analytics.data) {
    return (
      <div
        role="alert"
        className="flex items-start gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 p-5 text-sm text-destructive"
      >
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        Não foi possível carregar a visão geral comercial. Tente novamente em alguns instantes.
      </div>
    );
  }

  const { estimatedMonthlyRecurringRevenue, plans } = analytics.data;

  return (
    <section className="space-y-6" aria-labelledby="billing-status-overview-title">
      <Card>
        <CardHeader>
          <CardTitle
            id="billing-status-overview-title"
            className="flex items-center gap-2"
          >
            <Layers3 className="h-5 w-5" />
            Distribuição por plano e ciclo
          </CardTitle>
          <CardDescription>
            Compare situação das assinaturas, cobertura e capacidade dos planos comerciais.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {plans.length ? (
            <div className="grid gap-4 lg:grid-cols-2">
              {plans.map(plan => (
                <article key={plan.planId} className="rounded-xl border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="font-medium">{plan.planName}</h3>
                      <p className="mt-1 break-words text-sm text-muted-foreground">
                        {plan.versionCode} · {CYCLE_LABELS[plan.billingCycle] ?? plan.billingCycle} · {plan.currency}
                      </p>
                    </div>
                    <Badge variant={plan.active ? "default" : "secondary"}>
                      {plan.active ? "Disponível para contratação" : "Indisponível para contratação"}
                    </Badge>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    {STATUS_ORDER.map(status => (
                      <Badge key={status} variant="outline">
                        {STATUS_LABELS[status]}: {plan.subscriptionsByStatus[status] ?? 0}
                      </Badge>
                    ))}
                  </div>

                  <dl className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-lg bg-muted/30 p-3">
                      <dt className="text-xs text-muted-foreground">
                        Beneficiários cobertos
                      </dt>
                      <dd className="mt-1 font-semibold">
                        {plan.coveredBeneficiaries.toLocaleString("pt-BR")}
                      </dd>
                    </div>
                    <div className="rounded-lg bg-muted/30 p-3">
                      <dt className="text-xs text-muted-foreground">
                        Capacidade ocupada
                      </dt>
                      <dd className="mt-1 font-semibold">
                        {plan.capacityUsed.toLocaleString("pt-BR")}
                      </dd>
                    </div>
                  </dl>
                </article>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
              Nenhum plano comercial foi configurado.
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CircleDollarSign className="h-5 w-5" />
            Receita recorrente estimada
          </CardTitle>
          <CardDescription>
            Valores operacionais separados por moeda para acompanhamento administrativo.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {estimatedMonthlyRecurringRevenue.length ? (
            estimatedMonthlyRecurringRevenue.map(item => (
              <div
                key={item.currency}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4"
              >
                <span className="text-sm text-muted-foreground">Estimativa mensal · {item.currency}</span>
                <span className="font-semibold">{formatCurrency(item.amountMinor, item.currency)}</span>
              </div>
            ))
          ) : (
            <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
              Ainda não há estimativa de receita disponível.
            </div>
          )}
          <p className="text-xs leading-5 text-muted-foreground">
            Estes indicadores apoiam a operação e não substituem o fechamento e a conferência financeira.
          </p>
        </CardContent>
      </Card>
    </section>
  );
}
