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

const STATUS_ORDER = [
  "pending",
  "active",
  "past_due",
  "canceled",
  "expired",
] as const;

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
        Carregando distribuição das assinaturas...
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
        Não foi possível carregar a distribuição comercial. As liberações
        administrativas continuam disponíveis abaixo.
      </div>
    );
  }

  const { subscriptionStatusTotals, plans } = analytics.data;

  return (
    <section className="space-y-4" aria-labelledby="billing-status-overview-title">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {STATUS_ORDER.map(status => (
          <div key={status} className="rounded-2xl border bg-card p-4">
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
              {STATUS_LABELS[status]}
            </p>
            <p className="mt-2 text-2xl font-semibold tracking-tight">
              {(subscriptionStatusTotals[status] ?? 0).toLocaleString("pt-BR")}
            </p>
          </div>
        ))}
      </div>

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
            Assinaturas, pacientes cobertos e capacidade são apresentados como
            fatos distintos. Os valores vêm do catálogo e dos contratos do
            backend.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {plans.length ? (
            <div className="grid gap-4 lg:grid-cols-2">
              {plans.map(plan => (
                <article key={plan.planCode} className="rounded-xl border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="font-medium">{plan.planName}</h3>
                      <p className="mt-1 break-words text-sm text-muted-foreground">
                        {plan.planCode} · {plan.billingCycle} · {plan.currency}
                      </p>
                    </div>
                    <Badge variant={plan.active ? "default" : "secondary"}>
                      {plan.active ? "Catálogo ativo" : "Catálogo inativo"}
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
              Nenhum plano comercial foi configurado no backend.
            </div>
          )}

          <div className="mt-4 flex items-start gap-2 rounded-xl bg-muted/30 p-4 text-sm text-muted-foreground">
            <CircleDollarSign className="mt-0.5 h-4 w-4 shrink-0" />
            Estes indicadores não confirmam pagamento nem substituem conciliação
            financeira.
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
