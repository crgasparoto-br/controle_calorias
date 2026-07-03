import React from "react";
import DashboardLayout from "@/components/DashboardLayout";
import PageIntro from "@/components/PageIntro";
import UXState from "@/components/UXState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { Check, CreditCard, ExternalLink, RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

const STATUS_LABELS: Record<string, string> = {
  none: "Sem assinatura ativa",
  pending: "Pagamento pendente",
  active: "Assinatura ativa",
  past_due: "Pagamento com pendência",
  canceled: "Assinatura cancelada",
  expired: "Assinatura expirada",
};

const STATUS_DESCRIPTIONS: Record<string, string> = {
  none: "Escolha um plano para iniciar o checkout externo. O acesso premium só será liberado depois da confirmação do provedor.",
  pending: "Recebemos o início do checkout e estamos aguardando a confirmação segura do pagamento.",
  active: "Seu acesso premium está liberado enquanto a assinatura estiver dentro do período vigente.",
  past_due: "Há uma pendência de cobrança. Assim que o provedor confirmar a regularização, o acesso volta ao normal.",
  canceled: "A assinatura foi cancelada. Você pode escolher um plano para assinar novamente.",
  expired: "O período pago terminou sem renovação ativa. Escolha um plano para retomar o acesso premium.",
};

function formatMoney(cents: number, currency: string) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency,
  }).format(cents / 100);
}

function cycleLabel(cycle: string) {
  return cycle === "yearly" ? "por ano" : "por mês";
}

function formatDate(value: Date | string | null | undefined) {
  if (!value) return "Não definido";
  return new Date(value).toLocaleDateString("pt-BR");
}

export default function SubscriptionPage() {
  const utils = trpc.useUtils();
  const plans = trpc.billing.plans.useQuery();
  const subscription = trpc.billing.subscription.useQuery();

  const checkout = trpc.billing.checkout.useMutation({
    onSuccess: result => {
      toast.success("Checkout criado. Você será redirecionado para concluir o pagamento.");
      window.location.assign(result.checkoutUrl);
    },
    onError: error => toast.error(error.message || "Não foi possível iniciar a assinatura agora."),
  });

  const cancel = trpc.billing.cancel.useMutation({
    onSuccess: async () => {
      toast.success("Cancelamento solicitado. O status da assinatura foi atualizado.");
      await utils.billing.subscription.invalidate();
    },
    onError: error => toast.error(error.message || "Não foi possível cancelar a assinatura agora."),
  });

  const currentStatus = subscription.data?.status ?? "none";
  const hasActiveSubscription = Boolean(subscription.data?.hasActiveSubscription);
  const currentPlanCode = subscription.data?.plan?.code ?? null;

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-7xl space-y-6">
        <PageIntro
          eyebrow="Assinatura"
          title="Planos premium"
          description="Escolha um plano e conclua o pagamento em checkout externo. A assinatura só fica ativa depois da confirmação segura recebida pelo backend."
          stats={
            <div className="grid gap-3 md:grid-cols-3">
              <StatusTile label="Status" value={STATUS_LABELS[currentStatus] ?? currentStatus} />
              <StatusTile label="Plano atual" value={subscription.data?.plan?.name ?? "Nenhum plano"} />
              <StatusTile label="Vigência" value={formatDate(subscription.data?.subscription?.currentPeriodEnd)} />
            </div>
          }
        />

        <Card className="border-0 shadow-sm">
          <CardHeader className="space-y-2">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2 text-xl">
                  <ShieldCheck className="h-5 w-5 text-primary" />
                  Assinatura atual
                </CardTitle>
                <CardDescription>{STATUS_DESCRIPTIONS[currentStatus] ?? "Revise o estado atual da sua assinatura."}</CardDescription>
              </div>
              <Badge variant={hasActiveSubscription ? "default" : "secondary"} className="rounded-full px-3 py-1">
                {STATUS_LABELS[currentStatus] ?? currentStatus}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm leading-6 text-muted-foreground">
              <p>Checkout pendente não libera recursos premium.</p>
              <p>Webhooks duplicados são tratados sem alterar a assinatura duas vezes.</p>
            </div>
            <Button
              type="button"
              variant="outline"
              className="rounded-full"
              disabled={!subscription.data?.subscription || cancel.isPending || currentStatus === "canceled" || currentStatus === "expired"}
              onClick={() => cancel.mutate({ cancelAtPeriodEnd: true })}
            >
              {cancel.isPending ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : null}
              Cancelar ao fim do período
            </Button>
          </CardContent>
        </Card>

        {plans.isLoading || subscription.isLoading ? (
          <UXState variant="loading" title="Carregando planos" description="Estamos buscando os planos disponíveis e seu status de assinatura." />
        ) : plans.error ? (
          <UXState variant="error" title="Não foi possível carregar os planos" description={plans.error.message || "Tente novamente em instantes para revisar as opções."} />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {(plans.data ?? []).map(plan => {
              const isCurrentPlan = currentPlanCode === plan.code;
              return (
                <Card key={plan.code} className="border-0 shadow-sm">
                  <CardHeader className="space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <CardTitle className="text-xl">{plan.name}</CardTitle>
                        <CardDescription>{plan.description}</CardDescription>
                      </div>
                      {isCurrentPlan ? <Badge className="rounded-full px-3 py-1">Plano atual</Badge> : null}
                    </div>
                    <div className="flex items-end gap-2">
                      <span className="text-3xl font-semibold tracking-tight text-foreground">{formatMoney(plan.priceCents, plan.currency)}</span>
                      <span className="pb-1 text-sm text-muted-foreground">{cycleLabel(plan.billingCycle)}</span>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-5">
                    <div className="grid gap-3">
                      {plan.benefits.map(benefit => (
                        <div key={benefit} className="flex gap-2 text-sm leading-6 text-muted-foreground">
                          <Check className="mt-1 h-4 w-4 shrink-0 text-primary" />
                          <span>{benefit}</span>
                        </div>
                      ))}
                    </div>
                    <Button
                      type="button"
                      className="h-11 w-full rounded-full"
                      disabled={checkout.isPending || (hasActiveSubscription && isCurrentPlan)}
                      onClick={() => checkout.mutate({ planCode: plan.code })}
                    >
                      {checkout.isPending ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <ExternalLink className="mr-2 h-4 w-4" />}
                      {hasActiveSubscription && isCurrentPlan ? "Assinatura ativa" : "Assinar com checkout externo"}
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        <div className="rounded-2xl border bg-muted/20 p-4 text-sm leading-6 text-muted-foreground">
          <div className="flex items-center gap-2 font-medium text-foreground">
            <CreditCard className="h-4 w-4 text-primary" />
            Pagamento seguro fora da aplicação
          </div>
          <p className="mt-2">A aplicação não armazena cartão, CVV ou dados sensíveis. O pagamento acontece no provedor configurado e a liberação premium depende da confirmação por webhook.</p>
        </div>
      </div>
    </DashboardLayout>
  );
}

function StatusTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border bg-background px-4 py-3 shadow-sm">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 font-medium text-foreground">{value}</p>
    </div>
  );
}
