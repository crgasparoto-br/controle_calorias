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
  Check,
  CreditCard,
  QrCode,
  RefreshCw,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

const ACCESS_LABELS: Record<string, string> = {
  admin_override: "Liberação administrativa",
  sponsored_by_professional: "Cobertura do profissional",
  active_subscription: "Assinatura própria ativa",
  active_trial: "Período de avaliação ativo",
  transition_access: "Período de transição",
  read_only_access: "Acesso somente para leitura",
  free_access: "Acesso aberto",
  no_access: "Acesso aguardando ativação",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "Aguardando confirmação",
  active: "Ativa",
  past_due: "Pagamento pendente",
  suspended: "Suspensa",
  canceled: "Cancelada",
  expired: "Expirada",
};

const CYCLE_LABELS: Record<string, string> = {
  monthly: "Mensal",
  yearly: "Anual",
  custom: "Personalizado",
};

const PAYMENT_LABELS: Record<string, string> = {
  credit_card: "Cartão de crédito",
  pix_automatic: "Pix Automático",
};

const ENTITLEMENT_LABELS: Record<string, string> = {
  system_access: "Acesso ao sistema",
  web_access: "Acesso pela web",
  whatsapp_access: "Registro pelo WhatsApp",
  meal_text: "Refeições por texto",
  meal_image: "Refeições por imagem",
  meal_audio: "Refeições por áudio",
  ai_assistance: "Assistência por IA",
  nutrition_goals: "Metas nutricionais",
  reports: "Relatórios",
  weight_tracking: "Acompanhamento de peso",
  water_tracking: "Acompanhamento de água",
  exercise_tracking: "Acompanhamento de exercícios",
  health_integrations: "Integrações de saúde",
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

function entitlementLabel(value: string) {
  return ENTITLEMENT_LABELS[value] ?? "Recurso profissional incluído";
}

function checkoutReturnMessage() {
  if (typeof window === "undefined") return null;
  if (window.location.pathname.endsWith("/return/success")) {
    return {
      tone: "info" as const,
      title: "Retorno do pagamento recebido",
      text: "A contratação continua pendente até a confirmação financeira autoritativa. Atualizaremos esta tela assim que o backend receber a confirmação.",
    };
  }
  if (window.location.pathname.endsWith("/return/cancel")) {
    return {
      tone: "warning" as const,
      title: "Checkout interrompido",
      text: "Nenhum acesso foi ativado por este retorno. Você pode revisar a oferta e tentar novamente.",
    };
  }
  if (window.location.pathname.endsWith("/return/expired")) {
    return {
      tone: "warning" as const,
      title: "Tentativa expirada",
      text: "A tentativa expirou sem ativar acesso. Inicie uma nova tentativa quando estiver pronto.",
    };
  }
  return null;
}

export default function BillingPage() {
  const utils = trpc.useUtils();
  const overview = trpc.billing.webOverview.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: true,
    staleTime: 10_000,
  });
  const [selectedVersionCode, setSelectedVersionCode] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<
    "credit_card" | "pix_automatic"
  >("credit_card");
  const [couponCode, setCouponCode] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [mobilePhone, setMobilePhone] = useState("");
  const [cpfCnpj, setCpfCnpj] = useState("");
  const [cardTrial, setCardTrial] = useState(true);
  const [pixWaiver, setPixWaiver] = useState(false);
  const attemptRef = useRef<{ signature: string; contractKey: string } | null>(
    null
  );
  const returnMessage = useMemo(checkoutReturnMessage, []);

  const catalog = overview.data?.catalog ?? [];
  const selectedPlan =
    catalog.find(item => item.versionCode === selectedVersionCode) ?? catalog[0];

  useEffect(() => {
    if (!selectedVersionCode && catalog[0]) {
      setSelectedVersionCode(catalog[0].versionCode);
    }
  }, [catalog, selectedVersionCode]);

  useEffect(() => {
    if (
      selectedPlan &&
      !selectedPlan.effectivePaymentMethods.includes(paymentMethod)
    ) {
      setPaymentMethod(
        selectedPlan.effectivePaymentMethods[0] ?? "credit_card"
      );
    }
  }, [paymentMethod, selectedPlan]);

  const coupon = trpc.billing.couponEligibility.useQuery(
    {
      code: couponCode.trim() || "__none__",
      versionCode: selectedPlan?.versionCode ?? "__none__",
    },
    {
      enabled: couponCode.trim().length > 0 && !!selectedPlan,
      retry: false,
      staleTime: 5_000,
    }
  );

  const refreshActivation = trpc.billing.refreshOnboardingActivation.useMutation({
    onSuccess: async result => {
      if (result.status === "activated" || result.status === "already_active") {
        toast.success("Situação de acesso atualizada.");
      } else if (result.status === "blocked") {
        toast.info("A ativação ainda aguarda uma origem válida de acesso.");
      } else {
        toast.info("A situação comercial foi reavaliada.");
      }
      await utils.billing.webOverview.invalidate();
    },
    onError: error =>
      toast.error(error.message || "Não foi possível reavaliar o acesso."),
  });

  const checkout = trpc.billing.startCheckout.useMutation({
    onSuccess: async result => {
      await utils.billing.webOverview.invalidate();
      if (result.flow.kind === "hosted_checkout") {
        window.location.assign(result.flow.url);
        return;
      }
      toast.info(
        "Autorização Pix criada. A assinatura continuará pendente até a confirmação financeira."
      );
    },
    onError: error =>
      toast.error(error.message || "Não foi possível iniciar a contratação."),
  });

  const cancelSubscription = trpc.billing.cancelSubscription.useMutation({
    onSuccess: async result => {
      toast.info(result.message);
      await utils.billing.webOverview.invalidate();
    },
    onError: error =>
      toast.error(error.message || "Não foi possível solicitar o cancelamento."),
  });

  if (overview.isLoading) {
    return (
      <DashboardLayout>
        <div
          role="status"
          aria-live="polite"
          className="mx-auto max-w-6xl rounded-2xl border bg-card p-8 text-sm text-muted-foreground"
        >
          Carregando plano, acesso e ofertas disponíveis...
        </div>
      </DashboardLayout>
    );
  }

  if (overview.isError || !overview.data) {
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
            <Button variant="outline" onClick={() => void overview.refetch()}>
              <RefreshCw className="h-4 w-4" />
              Tentar novamente
            </Button>
          </CardContent>
        </Card>
      </DashboardLayout>
    );
  }

  const {
    access,
    subscription,
    professionalSubscription,
    sponsoredCoverage,
    actions,
  } = overview.data;
  const accessLabel = ACCESS_LABELS[access.reason] ?? "Origem de acesso válida";
  const capacityAvailable =
    professionalSubscription?.capacityLimit == null
      ? null
      : Math.max(
          0,
          professionalSubscription.capacityLimit -
            professionalSubscription.capacityUsed
        );

  const startCheckout = () => {
    if (!selectedPlan) return;
    if (!customerName.trim() || !mobilePhone.trim() || !cpfCnpj.trim()) {
      toast.error("Preencha nome, telefone e CPF/CNPJ para continuar.");
      return;
    }
    if (paymentMethod === "pix_automatic" && !pixWaiver) {
      toast.error(
        "Confirme que o Pix Automático inicia a contratação paga sem período de avaliação."
      );
      return;
    }
    if (couponCode.trim() && coupon.data && !coupon.data.eligible) {
      toast.error("Revise ou remova o cupom antes de continuar.");
      return;
    }

    const trialChoice =
      paymentMethod === "credit_card" && cardTrial ? "request" : "waive";
    const signature = [
      selectedPlan.versionCode,
      paymentMethod,
      trialChoice,
      couponCode.trim().toUpperCase(),
    ].join(":");
    const currentAttempt = attemptRef.current;
    const contractKey =
      currentAttempt?.signature === signature
        ? currentAttempt.contractKey
        : `web_${window.crypto.randomUUID().replaceAll("-", "")}`;
    attemptRef.current = { signature, contractKey };

    checkout.mutate({
      contractKey,
      versionCode: selectedPlan.versionCode,
      paymentMethod,
      trialChoice,
      couponCode: couponCode.trim() || null,
      customer: {
        name: customerName.trim(),
        mobilePhone,
        cpfCnpj,
      },
    });
  };

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-6xl space-y-6 pb-12">
        <PageIntro
          eyebrow="Comercial e elegibilidade"
          title="Plano e acesso"
          description="Entenda de onde vem seu acesso, compare as ofertas disponíveis para sua conta e gerencie sua assinatura sem depender do retorno do navegador para confirmar pagamentos."
        />

        {returnMessage ? (
          <div
            role="status"
            aria-live="polite"
            className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4"
          >
            <p className="font-medium">{returnMessage.title}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {returnMessage.text}
            </p>
          </div>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {access.allowed ? (
                  <BadgeCheck className="h-5 w-5 text-emerald-600" />
                ) : (
                  <AlertTriangle className="h-5 w-5 text-amber-600" />
                )}
                Situação atual
              </CardTitle>
              <CardDescription>
                Cobertura, assinatura, trial, transição e liberação administrativa
                permanecem origens separadas no backend.
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
                <Detail label="Origem efetiva" value={accessLabel} />
                <Detail
                  label="Vigência"
                  value={
                    access.validUntil
                      ? `Até ${formatDate(access.validUntil)}`
                      : "Sem término informado"
                  }
                />
              </dl>
              {sponsoredCoverage ? (
                <div className="rounded-xl border p-4 text-sm text-muted-foreground">
                  Seu acesso é coberto por um profissional. Dados financeiros,
                  capacidade contratada e informações comerciais do patrocinador
                  não são exibidos nesta conta.
                </div>
              ) : null}
              {!access.sourceAvailable ? (
                <div role="alert" className="rounded-xl border p-4 text-sm">
                  A fonte comercial está temporariamente indisponível. Nenhuma
                  liberação adicional será presumida por esta tela.
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5" />
                Ações seguras
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm text-muted-foreground">
              <p>
                O retorno do navegador nunca ativa um plano. Somente a confirmação
                financeira processada pelo backend altera seu acesso.
              </p>
              {!access.allowed ? (
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
                  Reavaliar acesso
                </Button>
              ) : null}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CreditCard className="h-5 w-5" />
              Sua assinatura
            </CardTitle>
          </CardHeader>
          <CardContent>
            {subscription ? (
              <div className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <Detail label="Plano" value={subscription.planName} />
                  <Detail
                    label="Situação"
                    value={STATUS_LABELS[subscription.status] ?? "Em análise"}
                    supporting={CYCLE_LABELS[subscription.billingCycle]}
                  />
                  <Detail
                    label="Valor"
                    value={formatMoney(
                      subscription.unitAmount,
                      subscription.currency
                    )}
                    supporting="Valor registrado no contrato atual"
                  />
                  <Detail
                    label="Fim do período atual"
                    value={formatDate(subscription.currentPeriodEnd)}
                    supporting={
                      subscription.cancelAtPeriodEnd
                        ? "Renovação já desativada"
                        : `Início: ${formatDate(subscription.currentPeriodStart)}`
                    }
                  />
                </div>
                {actions.canCancelRenewal ? (
                  <Button
                    variant="outline"
                    disabled={cancelSubscription.isPending}
                    onClick={() =>
                      cancelSubscription.mutate({ subscriptionId: subscription.id })
                    }
                  >
                    {cancelSubscription.isPending
                      ? "Solicitando cancelamento..."
                      : "Cancelar próxima renovação"}
                  </Button>
                ) : null}
                {actions.canRegularize ? (
                  <p className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
                    Há uma pendência financeira. Você mantém apenas as capacidades
                    que o backend informar para esta fase; regularize pelo fluxo de
                    pagamento disponível quando ele for apresentado.
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
                Nenhuma assinatura própria foi localizada.
              </div>
            )}
          </CardContent>
        </Card>

        {!sponsoredCoverage && professionalSubscription ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UsersRound className="h-5 w-5" />
                Capacidade profissional
              </CardTitle>
              <CardDescription>
                Seu uso pessoal não consome uma vaga de paciente.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-3">
                <Detail
                  label="Contratada"
                  value={
                    professionalSubscription.capacityLimit == null
                      ? "Sem limite configurado"
                      : `${professionalSubscription.capacityLimit} pacientes`
                  }
                />
                <Detail
                  label="Ocupada"
                  value={`${professionalSubscription.capacityUsed} pacientes`}
                />
                <Detail
                  label="Disponível"
                  value={
                    capacityAvailable == null
                      ? "Não aplicável"
                      : `${capacityAvailable} pacientes`
                  }
                />
              </div>
            </CardContent>
          </Card>
        ) : null}

        <section aria-labelledby="offers-heading" className="space-y-4">
          <div>
            <h2 id="offers-heading" className="text-xl font-semibold">
              Compare os planos disponíveis
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Preços, ciclos, capacidade e meios de pagamento abaixo vêm do
              catálogo efetivo do backend.
            </p>
          </div>

          {catalog.length ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {catalog.map(plan => {
                const selected = plan.versionCode === selectedPlan?.versionCode;
                return (
                  <button
                    key={plan.versionCode}
                    type="button"
                    onClick={() => setSelectedVersionCode(plan.versionCode)}
                    className={`rounded-2xl border bg-card p-5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      selected ? "ring-2 ring-primary" : "hover:border-primary/50"
                    }`}
                    aria-pressed={selected}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold">{plan.name}</p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {CYCLE_LABELS[plan.billingCycle]}
                        </p>
                      </div>
                      {selected ? <Check className="h-5 w-5" /> : null}
                    </div>
                    <p className="mt-4 text-2xl font-semibold">
                      {formatMoney(plan.unitAmount, plan.currency)}
                    </p>
                    {plan.capacityLimit != null ? (
                      <p className="mt-2 text-sm">
                        Capacidade: {plan.capacityLimit} pacientes
                      </p>
                    ) : null}
                    <ul className="mt-4 space-y-1 text-sm text-muted-foreground">
                      {plan.entitlements.slice(0, 6).map(resource => (
                        <li key={resource} className="flex gap-2">
                          <Check className="mt-0.5 h-4 w-4 shrink-0" />
                          {entitlementLabel(resource)}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-4 text-xs text-muted-foreground">
                      {plan.effectivePaymentMethods.length
                        ? plan.effectivePaymentMethods
                            .map(method => PAYMENT_LABELS[method])
                            .join(" • ")
                        : "Contratação temporariamente indisponível"}
                    </p>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
              Não há ofertas efetivas disponíveis para contratação neste momento.
            </div>
          )}
        </section>

        {selectedPlan && actions.canStartCheckout ? (
          <Card>
            <CardHeader>
              <CardTitle>Confirmar contratação</CardTitle>
              <CardDescription>
                Revise plano, ciclo, valor e forma de pagamento antes de seguir
                para o ambiente seguro do provedor.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-3">
                <Detail label="Plano" value={selectedPlan.name} />
                <Detail
                  label="Ciclo"
                  value={CYCLE_LABELS[selectedPlan.billingCycle]}
                />
                <Detail
                  label="Preço"
                  value={formatMoney(
                    selectedPlan.unitAmount,
                    selectedPlan.currency
                  )}
                />
              </div>

              <fieldset className="space-y-3">
                <legend className="font-medium">Forma de pagamento</legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  {selectedPlan.effectivePaymentMethods.map(method => (
                    <label
                      key={method}
                      className="flex cursor-pointer items-center gap-3 rounded-xl border p-4"
                    >
                      <input
                        type="radio"
                        name="billing-payment-method"
                        value={method}
                        checked={paymentMethod === method}
                        onChange={() =>
                          setPaymentMethod(
                            method as "credit_card" | "pix_automatic"
                          )
                        }
                      />
                      {method === "credit_card" ? (
                        <CreditCard className="h-5 w-5" />
                      ) : (
                        <QrCode className="h-5 w-5" />
                      )}
                      <span>{PAYMENT_LABELS[method]}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              {paymentMethod === "credit_card" ? (
                <label className="flex items-start gap-3 rounded-xl border p-4">
                  <input
                    type="checkbox"
                    checked={cardTrial}
                    onChange={event => setCardTrial(event.target.checked)}
                    className="mt-1"
                  />
                  <span className="text-sm">
                    <strong>Iniciar período de avaliação.</strong>{" "}
                    {selectedPlan.audience === "professional"
                      ? "O trial profissional dura 14 dias e começa com capacidade de 5 pacientes."
                      : "O trial individual dura 7 dias."}{" "}
                    O cartão precisa ser cadastrado antes do início e a primeira
                    cobrança ocorre somente após o período aplicável.
                  </span>
                </label>
              ) : (
                <label className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
                  <input
                    type="checkbox"
                    checked={pixWaiver}
                    onChange={event => setPixWaiver(event.target.checked)}
                    className="mt-1"
                  />
                  <span className="text-sm">
                    <strong>Confirmo a contratação paga sem trial.</strong> O Pix
                    Automático não inicia período de avaliação. A autorização do
                    Pix, sozinha, também não ativa o plano; a confirmação
                    financeira ainda precisa chegar ao backend.
                  </span>
                </label>
              )}

              <div className="grid gap-4 md:grid-cols-3">
                <Field
                  label="Nome do pagador"
                  value={customerName}
                  onChange={setCustomerName}
                  autoComplete="name"
                />
                <Field
                  label="Telefone com DDD"
                  value={mobilePhone}
                  onChange={setMobilePhone}
                  inputMode="tel"
                  autoComplete="tel"
                />
                <Field
                  label="CPF ou CNPJ"
                  value={cpfCnpj}
                  onChange={setCpfCnpj}
                  inputMode="numeric"
                  autoComplete="off"
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="billing-coupon" className="text-sm font-medium">
                  Cupom (opcional)
                </label>
                <div className="flex gap-2">
                  <input
                    id="billing-coupon"
                    value={couponCode}
                    onChange={event => setCouponCode(event.target.value)}
                    className="h-10 flex-1 rounded-md border bg-background px-3 text-sm"
                    placeholder="Digite o código"
                    autoComplete="off"
                  />
                  {couponCode ? (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setCouponCode("")}
                    >
                      Remover
                    </Button>
                  ) : null}
                </div>
                {coupon.isFetching ? (
                  <p className="text-sm text-muted-foreground" role="status">
                    Validando cupom...
                  </p>
                ) : coupon.data?.eligible ? (
                  <p className="text-sm text-emerald-700">
                    Cupom válido: desconto de{" "}
                    {formatMoney(coupon.data.discountAmount, selectedPlan.currency)}.
                    Total da cobrança com desconto:{" "}
                    {formatMoney(coupon.data.finalAmount, selectedPlan.currency)}.
                    {coupon.data.durationCharges > 1
                      ? ` Válido por ${coupon.data.durationCharges} cobranças.`
                      : " Válido para a primeira cobrança aplicável."}
                  </p>
                ) : coupon.data && !coupon.data.eligible ? (
                  <p className="text-sm text-destructive" role="alert">
                    Este cupom não está disponível para esta contratação.
                  </p>
                ) : null}
              </div>

              {checkout.data?.flow.kind === "pix_automatic" ? (
                <div
                  className="rounded-xl border p-4"
                  role="status"
                  aria-live="polite"
                >
                  <p className="font-medium">Autorização Pix iniciada</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Use o código abaixo no fluxo compatível do seu banco. Seu plano
                    permanece pendente até confirmação financeira.
                  </p>
                  <code className="mt-3 block break-all rounded bg-muted p-3 text-xs">
                    {checkout.data.flow.qrCodePayload}
                  </code>
                </div>
              ) : null}

              <Button
                className="w-full sm:w-auto"
                disabled={
                  checkout.isPending ||
                  coupon.isFetching ||
                  (paymentMethod === "pix_automatic" && !pixWaiver)
                }
                onClick={startCheckout}
              >
                {checkout.isPending
                  ? "Preparando contratação..."
                  : paymentMethod === "credit_card"
                    ? "Continuar para pagamento seguro"
                    : "Iniciar autorização Pix Automático"}
              </Button>
            </CardContent>
          </Card>
        ) : null}

        <div className="flex items-start gap-3 rounded-xl border bg-muted/20 p-4 text-sm text-muted-foreground">
          <CalendarClock className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            A tela não presume ativação por callback, não oferece boleto ou Pix
            manual e não cria preços, capacidades ou meios de pagamento fora do
            catálogo retornado pelo backend.
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
  supporting?: string;
}) {
  return (
    <div className="rounded-xl border p-4">
      <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-2 font-semibold">{value}</p>
      {supporting ? (
        <p className="mt-1 text-xs text-muted-foreground">{supporting}</p>
      ) : null}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  inputMode,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  autoComplete?: string;
}) {
  const id = React.useId();
  return (
    <label htmlFor={id} className="space-y-2 text-sm font-medium">
      <span>{label}</span>
      <input
        id={id}
        value={value}
        onChange={event => onChange(event.target.value)}
        inputMode={inputMode}
        autoComplete={autoComplete}
        className="h-10 w-full rounded-md border bg-background px-3 text-sm font-normal"
      />
    </label>
  );
}
