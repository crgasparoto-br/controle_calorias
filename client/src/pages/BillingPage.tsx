import BillingNotificationCenter from "@/components/BillingNotificationCenter";
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
  History,
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

const CAPACITY_LABELS: Record<string, string> = {
  within_capacity: "Dentro da capacidade",
  grandfathered_active: "Capacidade temporária ativa",
  grandfathered_expiring: "Capacidade temporária perto do fim",
  grandfathered_expired: "Capacidade temporária encerrada",
  grandfathered_resolved: "Capacidade regularizada",
};

const CAPACITY_MILESTONE_LABELS: Record<string, string> = {
  started: "Início",
  d60: "60 dias antes",
  d30: "30 dias antes",
  d15: "15 dias antes",
  d7: "7 dias antes",
  expired: "Vencimento",
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
  professional_dashboard: "Painel profissional",
  professional_portfolio: "Carteira de pacientes",
  professional_record: "Prontuário profissional",
  professional_goals: "Metas dos pacientes",
  professional_operational_alerts: "Alertas operacionais",
  professional_messages: "Mensagens profissionais",
  professional_reports: "Relatórios profissionais",
  professional_ai_assistance: "Assistência por IA profissional",
  professional_settings: "Configurações profissionais",
};

const COUPON_ERROR_LABELS: Record<string, string> = {
  inactive: "Cupom inválido ou inativo.",
  outside_validity: "Cupom expirado ou ainda fora do período de validade.",
  product_not_eligible: "Cupom não elegível para este produto.",
  version_not_eligible: "Cupom não elegível para esta versão do plano.",
  cycle_not_eligible: "Cupom não elegível para este ciclo de cobrança.",
  total_limit_reached: "Este cupom esgotou o limite total de utilizações.",
  user_limit_reached: "Este cupom já atingiu o limite de uso para esta conta.",
  first_contract_required: "Este cupom é exclusivo para a primeira contratação elegível.",
  currency_mismatch: "Este cupom não pode ser aplicado à moeda desta contratação.",
  invalid_discount:
    "O desconto deste cupom não pode ser aplicado com segurança; gratuidade integral depende de isenção administrativa.",
};

type CheckoutSignatureInput = {
  versionCode: string;
  paymentMethod: "credit_card" | "pix_automatic";
  trialChoice: "request" | "waive";
  couponCode?: string | null;
};

type CheckoutRequestInput = CheckoutSignatureInput & { contractKey: string };

function buildCheckoutSignature(input: CheckoutSignatureInput) {
  return [
    input.versionCode,
    input.paymentMethod,
    input.trialChoice,
    (input.couponCode ?? "").trim().toUpperCase(),
  ].join(":");
}

function formatDate(value: Date | string | null | undefined) {
  if (!value) return "Não informado";
  return new Date(value).toLocaleDateString("pt-BR");
}

function formatDateTime(value: Date | string | null | undefined) {
  if (!value) return "Não informado";
  return new Date(value).toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function formatMoney(amountMinor: number, currency: string) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency,
  }).format(amountMinor / 100);
}

function entitlementLabel(value: string) {
  return ENTITLEMENT_LABELS[value] ?? "Recurso incluído";
}

function transitionDays(
  validFrom: Date | string | null | undefined,
  validUntil: Date | string | null | undefined
) {
  if (!validFrom || !validUntil) return null;
  const start = new Date(validFrom).getTime();
  const end = new Date(validUntil).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return Math.round((end - start) / 86_400_000);
}

function estimatedTrialFirstChargeDate(audience: "individual" | "professional") {
  const days = audience === "professional" ? 14 : 7;
  return formatDate(new Date(Date.now() + days * 86_400_000));
}

function trialEligibilityMessage(reason: string | undefined) {
  if (reason === "trial_already_used") {
    return "O período de avaliação já foi utilizado por esta conta. Você ainda pode contratar o plano por cartão sem um novo período de avaliação.";
  }
  if (reason === "transition_history") {
    return "Esta conta já passou por uma transição comercial, que substitui um novo período de avaliação. Você ainda pode contratar o plano por cartão normalmente.";
  }
  return "Não foi possível confirmar a disponibilidade de um novo período de avaliação. Você ainda pode contratar o plano por cartão normalmente.";
}

function checkoutReturnMessage() {
  if (typeof window === "undefined") return null;
  if (window.location.pathname.endsWith("/return/success")) {
    return {
      title: "Pagamento enviado para confirmação",
      text: "A contratação continua aguardando a confirmação do pagamento. Esta tela será atualizada assim que a confirmação for recebida.",
    };
  }
  if (window.location.pathname.endsWith("/return/cancel")) {
    return {
      title: "Pagamento interrompido",
      text: "Nenhum acesso foi ativado. Você pode revisar a contratação e tentar novamente.",
    };
  }
  if (window.location.pathname.endsWith("/return/expired")) {
    return {
      title: "Tentativa expirada",
      text: "A tentativa expirou sem ativar o plano. Inicie uma nova contratação quando quiser continuar.",
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
  const attemptRef = useRef<{ signature: string; contractKey: string } | null>(null);
  const checkoutContextRef = useRef("");
  const returnMessage = useMemo(checkoutReturnMessage, []);

  const catalog = overview.data?.catalog ?? [];
  const selectedPlan =
    catalog.find(item => item.versionCode === selectedVersionCode) ?? catalog[0];
  const selectedTrialEligibility = selectedPlan
    ? overview.data?.trialEligibility?.[selectedPlan.audience]
    : null;
  const canRequestTrial = selectedTrialEligibility?.eligible === true;
  const selectedTrialChoice: "request" | "waive" =
    paymentMethod === "credit_card" && cardTrial && canRequestTrial
      ? "request"
      : "waive";
  const selectedCheckoutSignature = selectedPlan
    ? buildCheckoutSignature({
        versionCode: selectedPlan.versionCode,
        paymentMethod,
        trialChoice: selectedTrialChoice,
        couponCode,
      })
    : "";
  checkoutContextRef.current = selectedCheckoutSignature;

  useEffect(() => {
    if (!selectedVersionCode && catalog[0]) {
      setSelectedVersionCode(catalog[0].versionCode);
    }
  }, [catalog, selectedVersionCode]);

  useEffect(() => {
    if (selectedPlan && !selectedPlan.effectivePaymentMethods.includes(paymentMethod)) {
      setPaymentMethod(selectedPlan.effectivePaymentMethods[0] ?? "credit_card");
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

  const isCurrentCheckoutResponse = (variables: CheckoutRequestInput | undefined) => {
    if (!variables) return false;
    const signature = buildCheckoutSignature(variables);
    return (
      checkoutContextRef.current === signature &&
      attemptRef.current?.signature === signature &&
      attemptRef.current.contractKey === variables.contractKey
    );
  };

  const refreshActivation = trpc.billing.refreshOnboardingActivation.useMutation({
    onSuccess: async result => {
      if (result.status === "activated" || result.status === "already_active") {
        toast.success("Situação de acesso atualizada.");
      } else if (result.status === "blocked") {
        toast.info("A ativação ainda aguarda a confirmação do plano ou da forma de acesso.");
      } else {
        toast.info("Situação do acesso atualizada.");
      }
      await utils.billing.webOverview.invalidate();
    },
    onError: error =>
      toast.error(error.message || "Não foi possível reavaliar o acesso."),
  });

  const checkout = trpc.billing.startCheckout.useMutation({
    onSuccess: async (result, variables) => {
      await utils.billing.webOverview.invalidate();
      if (!isCurrentCheckoutResponse(variables)) {
        toast.info(
          "Recebemos uma resposta de uma tentativa anterior. Sua seleção atual foi preservada; revise-a antes de continuar."
        );
        return;
      }
      if (result.flow.kind === "hosted_checkout") {
        window.location.assign(result.flow.url);
        return;
      }
      toast.info(
        "Autorização Pix criada. Seu plano será ativado quando o pagamento for confirmado."
      );
    },
    onError: (error, variables) => {
      if (!isCurrentCheckoutResponse(variables)) {
        toast.info(
          "Uma tentativa anterior terminou sem alterar sua seleção atual. Revise os dados antes de tentar novamente."
        );
        return;
      }
      toast.error(error.message || "Não foi possível iniciar a contratação.");
    },
  });

  const regularizeSubscription = trpc.billing.regularizeSubscription.useMutation({
    onSuccess: result => {
      toast.info(result.message);
      window.location.assign(result.flow.url);
    },
    onError: error =>
      toast.error(error.message || "Não foi possível abrir a cobrança para regularização."),
  });

  const cancelSubscription = trpc.billing.cancelSubscription.useMutation({
    onSuccess: async result => {
      toast.info(result.message);
      await utils.billing.webOverview.invalidate();
    },
    onError: error =>
      toast.error(error.message || "Não foi possível solicitar o cancelamento."),
  });

  const reactivateSubscription = trpc.billing.reactivateSubscription.useMutation({
    onSuccess: async result => {
      toast.info(result.message);
      await utils.billing.webOverview.invalidate();
    },
    onError: error =>
      toast.error(error.message || "Não foi possível reativar a renovação."),
  });

  const activateProfessionalTrial =
    trpc.billing.activateProfessionalTrialNow.useMutation({
      onSuccess: async result => {
        toast.info(result.message);
        await utils.billing.webOverview.invalidate();
      },
      onError: error =>
        toast.error(error.message || "Não foi possível antecipar a ativação."),
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
              <h1 className="text-lg font-semibold">Não foi possível consultar o acesso</h1>
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
    professionalCapacity,
    sponsoredCoverage,
    professionalCoverageIndividualRenewal,
    lifecycle,
    management,
    history,
    actions,
  } = overview.data;
  const accessLabel = ACCESS_LABELS[access.reason] ?? "Acesso válido";
  const accessTransitionDays = transitionDays(access.validFrom, access.validUntil);
  const ownRenewalUnderCoverage =
    sponsoredCoverage &&
    subscription &&
    professionalCoverageIndividualRenewal?.subscriptionId === subscription.id
      ? professionalCoverageIndividualRenewal
      : null;
  const checkoutResultIsCurrent = isCurrentCheckoutResponse(
    checkout.variables as CheckoutRequestInput | undefined
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

    const signature = buildCheckoutSignature({
      versionCode: selectedPlan.versionCode,
      paymentMethod,
      trialChoice: selectedTrialChoice,
      couponCode,
    });
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
      trialChoice: selectedTrialChoice,
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
          eyebrow="Plano, pagamento e acesso"
          title="Plano e acesso"
          description="Veja como seu acesso está liberado, acompanhe sua assinatura, compare os planos disponíveis e gerencie pagamentos e renovação."
        />

        {returnMessage ? (
          <div
            role="status"
            aria-live="polite"
            className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4"
          >
            <p className="font-medium">{returnMessage.title}</p>
            <p className="mt-1 text-sm text-muted-foreground">{returnMessage.text}</p>
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
                Seu acesso pode vir de uma assinatura, de um período de avaliação, da cobertura
                de um profissional ou de uma liberação administrativa.
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
                <Detail label="Como seu acesso está liberado" value={accessLabel} />
                <Detail
                  label="Vigência"
                  value={
                    access.validUntil
                      ? `Até ${formatDate(access.validUntil)}`
                      : "Sem término informado"
                  }
                  supporting={
                    access.validFrom ? `Início: ${formatDate(access.validFrom)}` : undefined
                  }
                />
              </dl>
              {access.entitlements.length ? (
                <div className="rounded-xl border p-4">
                  <h3 className="font-medium">Recursos disponíveis no seu acesso</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    A lista abaixo mostra os recursos que você pode usar neste momento.
                  </p>
                  <EntitlementMatrix
                    className="mt-4"
                    entitlements={access.entitlements}
                    professional={access.entitlements.some(resource =>
                      resource.startsWith("professional_")
                    )}
                  />
                </div>
              ) : null}
              {access.reason === "transition_access" ? (
                <Notice>
                  {accessTransitionDays === 7
                    ? "Transição de 7 dias após a perda da cobertura profissional."
                    : accessTransitionDays === 30
                      ? "Transição comercial de 30 dias para usuário existente."
                      : "Período de transição em andamento."}{" "}
                  O acesso segue válido até <strong>{formatDate(access.validUntil)}</strong>. Ao
                  final, a situação do acesso será atualizada; um novo período de avaliação não é iniciado automaticamente.
                </Notice>
              ) : null}
              {access.reason === "read_only_access" ? (
                <Notice>
                  O período de transição terminou. Você ainda pode consultar e exportar seus dados
                  e gerenciar a conta. Novos registros e outros recursos pagos ficam bloqueados até
                  que exista uma nova forma válida de acesso.
                </Notice>
              ) : null}
              {sponsoredCoverage ? (
                <div className="rounded-xl border p-4 text-sm text-muted-foreground">
                  Seu acesso é coberto por um profissional. Dados financeiros,
                  capacidade contratada e informações comerciais do patrocinador
                  não são exibidos nesta conta.
                </div>
              ) : null}
              {ownRenewalUnderCoverage ? (
                <Notice>
                  {ownRenewalUnderCoverage.status === "requested" ||
                  ownRenewalUnderCoverage.status === "pending"
                    ? "A cobertura profissional está processando o cancelamento da próxima renovação da sua assinatura individual. O período individual já pago permanece válido até o vencimento."
                    : ownRenewalUnderCoverage.status === "confirmed"
                      ? "A próxima renovação da sua assinatura individual foi cancelada após a confirmação da cobertura profissional. Se quiser manter a renovação individual, use a ação abaixo quando ela estiver disponível."
                      : "Sua escolha de manter a renovação individual foi registrada; a cobertura profissional continua sendo a forma principal de acesso enquanto estiver válida."}
                  {ownRenewalUnderCoverage.requiresNewPixAuthorization
                    ? " Para Pix Automático, manter a renovação exige uma nova autorização."
                    : ""}
                </Notice>
              ) : null}
              {!access.sourceAvailable ? (
                <div role="alert" className="rounded-xl border p-4 text-sm">
                  Não foi possível confirmar as informações comerciais agora. Nenhum acesso
                  adicional será liberado até que a situação seja atualizada.
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
                Voltar para esta tela após o pagamento não confirma sozinho a contratação.
                Seu acesso é atualizado somente quando o pagamento é confirmado.
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

        <BillingNotificationCenter />

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
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
                  <Detail label="Plano" value={subscription.planName} />
                  <Detail
                    label="Versão"
                    value={subscription.planVersion ? `Versão ${subscription.planVersion}` : "Não informada"}
                  />
                  <Detail
                    label="Situação"
                    value={STATUS_LABELS[lifecycle?.state ?? subscription.status] ?? "Em análise"}
                    supporting={CYCLE_LABELS[subscription.billingCycle]}
                  />
                  <Detail
                    label="Valor"
                    value={formatMoney(subscription.unitAmount, subscription.currency)}
                    supporting="Valor registrado no contrato atual"
                  />
                  <Detail
                    label="Pagamento"
                    value={PAYMENT_LABELS[management?.paymentMethod ?? ""] ?? "Não informado"}
                  />
                  <Detail
                    label={
                      lifecycle?.cancelAtPeriodEnd || subscription.cancelAtPeriodEnd
                        ? "Fim do período atual"
                        : "Próxima renovação"
                    }
                    value={formatDate(lifecycle?.currentPeriodEnd ?? subscription.currentPeriodEnd)}
                    supporting={
                      lifecycle?.cancelAtPeriodEnd || subscription.cancelAtPeriodEnd
                        ? "Renovação desativada ao fim do período"
                        : `Início: ${formatDate(
                            lifecycle?.currentPeriodStart ?? subscription.currentPeriodStart
                          )}`
                    }
                  />
                </div>

                {lifecycle?.trialEndsAt ? (
                  <Notice>
                    Período de avaliação até <strong>{formatDate(lifecycle.trialEndsAt)}</strong>.
                    {lifecycle.firstChargeAt
                      ? ` Primeira cobrança prevista para ${formatDate(lifecycle.firstChargeAt)}.`
                      : ""}
                    {lifecycle.trialCapacityLimit != null
                      ? ` Durante esse período, a capacidade profissional é de ${lifecycle.trialCapacityLimit} pacientes.`
                      : ""}
                  </Notice>
                ) : null}
                {actions.canActivateProfessionalTrialNow && lifecycle ? (
                  <Notice>
                    <p>
                      Você pode encerrar o período de avaliação antecipadamente. A versão, o ciclo
                      e o preço atuais serão preservados; a capacidade integral será liberada depois
                      que o pagamento for confirmado.
                    </p>
                    <Button
                      className="mt-3"
                      disabled={activateProfessionalTrial.isPending}
                      onClick={() =>
                        activateProfessionalTrial.mutate({
                          subscriptionId: subscription.id,
                          confirmed: true,
                        })
                      }
                    >
                      {activateProfessionalTrial.isPending
                        ? "Solicitando ativação..."
                        : "Ativar plano agora e liberar todos os pacientes"}
                    </Button>
                  </Notice>
                ) : null}
                {lifecycle?.state === "past_due" ? (
                  <Notice alert>
                    <p>
                      Pagamento pendente. A carência de 7 dias preserva o acesso até{" "}
                      <strong>{formatDate(lifecycle.graceEndsAt)}</strong>.
                    </p>
                  </Notice>
                ) : null}
                {lifecycle?.state === "suspended" ? (
                  <Notice alert>
                    Assinatura suspensa. Quando aplicável, o prazo de recuperação de 30 dias
                    termina em <strong>{formatDate(lifecycle.recoveryEndsAt)}</strong>. Algumas
                    funções de consulta e gestão continuam disponíveis; os recursos pagos ficam
                    bloqueados até a regularização ser confirmada.
                  </Notice>
                ) : null}
                {actions.canRegularize &&
                (lifecycle?.state === "past_due" || lifecycle?.state === "suspended") ? (
                  <div>
                    <Button
                      disabled={regularizeSubscription.isPending}
                      onClick={() =>
                        regularizeSubscription.mutate({ subscriptionId: subscription.id })
                      }
                    >
                      {regularizeSubscription.isPending
                        ? "Abrindo cobrança..."
                        : "Regularizar cobrança"}
                    </Button>
                    <p className="mt-2 text-xs text-muted-foreground">
                      A ação abre a cobrança já existente no ambiente seguro de pagamento. Seu
                      acesso será atualizado após a confirmação do pagamento.
                    </p>
                  </div>
                ) : null}
                {lifecycle?.state === "expired" ? (
                  <Notice>
                    Esta assinatura encerrou. Para voltar a ter acesso, escolha um dos planos
                    disponíveis abaixo. Um pagamento feito após o encerramento não reativa
                    automaticamente a assinatura.
                  </Notice>
                ) : null}
                {lifecycle?.reconciliationRequired ? (
                  <Notice alert>
                    Estamos confirmando um pagamento. O acesso será atualizado assim que essa
                    confirmação for concluída; não é necessário repetir o pagamento.
                  </Notice>
                ) : null}

                <div className="flex flex-wrap gap-2">
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
                  {actions.canReactivateRenewal ? (
                    <Button
                      variant="outline"
                      disabled={reactivateSubscription.isPending}
                      onClick={() =>
                        reactivateSubscription.mutate({ subscriptionId: subscription.id })
                      }
                    >
                      {reactivateSubscription.isPending
                        ? "Reativando renovação..."
                        : ownRenewalUnderCoverage?.canKeepRenewal
                          ? "Manter renovação individual"
                          : "Reativar renovação"}
                    </Button>
                  ) : null}
                </div>
                {subscription.cancelAtPeriodEnd &&
                management?.requiresNewPixAuthorizationForReactivation ? (
                  <Notice>
                    Para voltar a renovar com Pix Automático, você precisará fazer uma nova
                    autorização do Pix.
                  </Notice>
                ) : null}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
                Nenhuma assinatura própria foi localizada.
              </div>
            )}
          </CardContent>
        </Card>

        {history.length ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <History className="h-5 w-5" />
                Histórico da assinatura
              </CardTitle>
              <CardDescription>
                Aqui você acompanha as principais alterações da sua assinatura. Dados sensíveis
                de pagamento não são exibidos.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ol className="space-y-3">
                {history.map((entry, index) => (
                  <li key={`${entry.title}-${index}`} className="rounded-xl border p-4">
                    <p className="font-medium">{entry.title}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {formatDateTime(entry.occurredAt)}
                    </p>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        ) : null}

        {!sponsoredCoverage && professionalSubscription ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UsersRound className="h-5 w-5" />
                Capacidade profissional
              </CardTitle>
              <CardDescription>
                Seu uso pessoal não consome uma vaga de paciente. A capacidade abaixo mostra o
                limite e a ocupação atuais da sua carteira.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {professionalCapacity ? (
                <>
                  <div className="grid gap-4 sm:grid-cols-4">
                    <Detail
                      label="Situação"
                      value={CAPACITY_LABELS[professionalCapacity.state] ?? "Em análise"}
                    />
                    <Detail
                      label="Contratada"
                      value={`${professionalCapacity.contractedLimit} pacientes`}
                    />
                    <Detail
                      label="Ocupada"
                      value={`${professionalCapacity.occupancy} pacientes`}
                    />
                    <Detail
                      label="Disponível"
                      value={`${professionalCapacity.available} pacientes`}
                    />
                  </div>
                  {professionalCapacity.temporaryLimit != null ? (
                    <Notice alert={professionalCapacity.state === "grandfathered_expired"}>
                      <p>
                        {professionalCapacity.temporaryWindowKind === "extension"
                          ? `Extensão administrativa confirmada de ${professionalCapacity.temporaryWindowDays ?? 30} dias.`
                          : `Período inicial confirmado de ${professionalCapacity.temporaryWindowDays ?? 90} dias de capacidade temporária.`}{" "}
                        Capacidade temporária:{" "}
                        <strong>{professionalCapacity.temporaryLimit} pacientes</strong>.
                        {professionalCapacity.temporaryEndsAt
                          ? ` Prazo final: ${formatDate(professionalCapacity.temporaryEndsAt)}.`
                          : ""}
                        {professionalCapacity.excess > 0
                          ? ` Excesso atual: ${professionalCapacity.excess} pacientes.`
                          : " A ocupação já voltou ao limite contratado."}
                      </p>
                      {professionalCapacity.newCoverageBlocked ? (
                        <p className="mt-2">
                          Novas aprovações, inclusões e reativações permanecem bloqueadas;
                          pacientes existentes, vínculos e dados não são removidos automaticamente.
                        </p>
                      ) : null}
                      {professionalCapacity.excess > 0 ? (
                        <p className="mt-2">
                          As alternativas são reduzir naturalmente a carteira, mudar para um plano
                          com maior capacidade ou falar com o atendimento administrativo/comercial.
                          Uma extensão só aparece aqui depois de aprovada.
                        </p>
                      ) : null}
                    </Notice>
                  ) : null}
                  {professionalCapacity.warningMilestones.length ? (
                    <div className="rounded-xl border p-4">
                      <h3 className="font-medium">Datas importantes da capacidade temporária</h3>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Acompanhe abaixo as principais datas desse período.
                      </p>
                      <ol className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                        {professionalCapacity.warningMilestones.map(milestone => (
                          <li key={milestone.key} className="rounded-lg bg-muted/30 p-3 text-sm">
                            <span className="font-medium">
                              {CAPACITY_MILESTONE_LABELS[milestone.key] ?? milestone.key}
                            </span>
                            <span className="block text-muted-foreground">
                              {formatDate(milestone.dueAt)} ·{" "}
                              {milestone.reached ? "data atingida" : "data futura"}
                            </span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  ) : null}
                  {professionalCapacity.commercialAnalysisRequired ? (
                    <Notice alert>
                      Nenhum plano disponível atualmente comporta toda a carteira. O caso está em
                      análise administrativa/comercial. A análise não altera automaticamente o plano,
                      o preço ou os pacientes da carteira.
                    </Notice>
                  ) : null}
                </>
              ) : (
                <div className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">
                  Não foi possível confirmar a capacidade da sua carteira agora. Até a atualização,
                  novas inclusões ficam temporariamente indisponíveis.
                </div>
              )}
            </CardContent>
          </Card>
        ) : null}

        <section aria-labelledby="offers-heading" className="space-y-4">
          <div>
            <h2 id="offers-heading" className="text-xl font-semibold">
              Compare os planos disponíveis
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Os planos abaixo mostram os preços, formas de pagamento e limites disponíveis para
              sua conta. Planos profissionais incluem recursos pessoais e profissionais na mesma
              assinatura; a capacidade varia conforme o plano escolhido.
            </p>
          </div>

          {catalog.length ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {catalog.map(plan => {
                const selected = plan.versionCode === selectedPlan?.versionCode;
                const professional = plan.audience === "professional";
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
                          Versão {plan.version} · {CYCLE_LABELS[plan.billingCycle]}
                        </p>
                      </div>
                      {selected ? <Check className="h-5 w-5" aria-hidden="true" /> : null}
                    </div>
                    <p className="mt-4 text-2xl font-semibold">
                      {formatMoney(plan.unitAmount, plan.currency)}
                    </p>
                    {plan.capacityLimit != null ? (
                      <p className="mt-2 text-sm">Capacidade: {plan.capacityLimit} pacientes</p>
                    ) : null}
                    {professional ? (
                      <p className="mt-3 text-sm text-muted-foreground">
                        Recursos pessoais e profissionais fazem parte desta única assinatura.
                        Seu uso pessoal não consome vaga da carteira.
                      </p>
                    ) : null}
                    <EntitlementMatrix
                      className="mt-4"
                      entitlements={plan.entitlements}
                      professional={professional}
                    />
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
              Não há planos disponíveis para contratação neste momento.
            </div>
          )}
        </section>

        {selectedPlan && actions.canStartCheckout ? (
          <Card>
            <CardHeader>
              <CardTitle>Confirmar contratação</CardTitle>
              <CardDescription>
                Revise plano, versão, ciclo, valor, recursos e forma de pagamento antes de seguir
                para o ambiente seguro de pagamento.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div
                className={`grid gap-4 sm:grid-cols-2 ${
                  selectedPlan.capacityLimit != null ? "xl:grid-cols-5" : "xl:grid-cols-4"
                }`}
              >
                <Detail label="Plano" value={selectedPlan.name} />
                <Detail label="Versão" value={`Versão ${selectedPlan.version}`} />
                <Detail label="Ciclo" value={CYCLE_LABELS[selectedPlan.billingCycle]} />
                <Detail
                  label="Preço"
                  value={formatMoney(selectedPlan.unitAmount, selectedPlan.currency)}
                />
                {selectedPlan.capacityLimit != null ? (
                  <Detail
                    label="Capacidade"
                    value={`${selectedPlan.capacityLimit} pacientes`}
                    supporting="Seu uso pessoal não consome uma vaga"
                  />
                ) : null}
              </div>

              <div className="rounded-xl border p-4">
                <h3 className="font-medium">Recursos desta contratação</h3>
                {selectedPlan.audience === "professional" ? (
                  <p className="mt-1 text-sm text-muted-foreground">
                    Os recursos pessoais e profissionais abaixo pertencem à mesma assinatura;
                    não existe uma segunda cobrança para o uso pessoal do profissional.
                  </p>
                ) : null}
                <EntitlementMatrix
                  className="mt-4"
                  entitlements={selectedPlan.entitlements}
                  professional={selectedPlan.audience === "professional"}
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
                          setPaymentMethod(method as "credit_card" | "pix_automatic")
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
                selectedTrialEligibility?.eligible ? (
                  <label className="flex items-start gap-3 rounded-xl border p-4">
                    <input
                      type="checkbox"
                      checked={cardTrial}
                      onChange={event => setCardTrial(event.target.checked)}
                      className="mt-1"
                    />
                    <span className="text-sm">
                      <strong>Solicitar período de avaliação.</strong>{" "}
                      {selectedPlan.audience === "professional"
                        ? "O período de avaliação profissional dura 14 dias e começa com capacidade de 5 pacientes."
                        : "O período de avaliação individual dura 7 dias."}{" "}
                      Se o cadastro do cartão e o início do período de avaliação forem concluídos hoje,
                      a primeira cobrança é estimada para {estimatedTrialFirstChargeDate(selectedPlan.audience)}.
                      A data exata será confirmada ao concluir o cadastro do pagamento. Você pode cancelar
                      a próxima renovação durante o período de avaliação, antes da primeira cobrança, sem
                      cobrança do plano. Se houver cupom, o desconto começa na primeira cobrança aplicável.
                      A disponibilidade final do período de avaliação também depende da validação dos dados
                      informados no ambiente seguro de pagamento.
                    </span>
                  </label>
                ) : (
                  <Notice>
                    <strong>Período de avaliação indisponível.</strong>{" "}
                    {trialEligibilityMessage(selectedTrialEligibility?.reason)}
                  </Notice>
                )
              ) : (
                <label className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
                  <input
                    type="checkbox"
                    checked={pixWaiver}
                    onChange={event => setPixWaiver(event.target.checked)}
                    className="mt-1"
                  />
                  <span className="text-sm">
                    <strong>Confirmo a contratação paga sem período de avaliação.</strong> O Pix Automático
                    não inicia período de avaliação. A autorização do Pix, sozinha, também não ativa o plano;
                    o acesso será liberado após a confirmação do pagamento.
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
                    <Button type="button" variant="outline" onClick={() => setCouponCode("")}>
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
                    Cupom válido: preço original {formatMoney(selectedPlan.unitAmount, selectedPlan.currency)},
                    desconto de {formatMoney(coupon.data.discountAmount, selectedPlan.currency)} e preço final{" "}
                    {formatMoney(coupon.data.finalAmount, selectedPlan.currency)}.
                    {coupon.data.durationCharges > 1
                      ? ` Válido por ${coupon.data.durationCharges} cobranças.`
                      : " Válido para a primeira cobrança aplicável."}
                  </p>
                ) : coupon.data && !coupon.data.eligible ? (
                  <p className="text-sm text-destructive" role="alert">
                    {COUPON_ERROR_LABELS[coupon.data.reason] ??
                      "Este cupom não está disponível para esta contratação."}{" "}
                    Revise o código ou continue sem cupom.
                  </p>
                ) : null}
              </div>

              {checkoutResultIsCurrent && checkout.data?.flow.kind === "pix_automatic" ? (
                <div className="rounded-xl border p-4" role="status" aria-live="polite">
                  <p className="font-medium">Autorização Pix iniciada</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Use o código abaixo no aplicativo do seu banco. Seu plano será ativado após a
                    confirmação do pagamento.
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
            O plano só é ativado após a confirmação do pagamento. As opções mostradas nesta página
            são as disponíveis para sua conta neste momento. Boleto e Pix manual não estão disponíveis
            nesta contratação.
          </p>
        </div>
      </div>
    </DashboardLayout>
  );
}

function EntitlementMatrix({
  entitlements,
  professional,
  className = "",
}: {
  entitlements: readonly string[];
  professional: boolean;
  className?: string;
}) {
  if (!entitlements.length) return null;
  const personalResources = entitlements.filter(
    resource => !resource.startsWith("professional_")
  );
  const professionalResources = entitlements.filter(resource =>
    resource.startsWith("professional_")
  );

  const renderResources = (resources: readonly string[]) => (
    <ul className="mt-2 grid gap-1 text-sm text-muted-foreground sm:grid-cols-2">
      {resources.map(resource => (
        <li key={resource} className="flex gap-2">
          <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{entitlementLabel(resource)}</span>
        </li>
      ))}
    </ul>
  );

  return (
    <div className={`space-y-4 ${className}`.trim()}>
      {personalResources.length ? (
        <div>
          <p className="text-sm font-medium">
            {professional ? "Recursos pessoais incluídos" : "Recursos incluídos"}
          </p>
          {renderResources(personalResources)}
        </div>
      ) : null}
      {professionalResources.length ? (
        <div>
          <p className="text-sm font-medium">Recursos profissionais incluídos</p>
          {renderResources(professionalResources)}
        </div>
      ) : null}
    </div>
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
      <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <p className="mt-2 font-semibold">{value}</p>
      {supporting ? (
        <p className="mt-1 text-xs text-muted-foreground">{supporting}</p>
      ) : null}
    </div>
  );
}

function Notice({ children, alert = false }: { children: React.ReactNode; alert?: boolean }) {
  return (
    <div
      role={alert ? "alert" : "status"}
      className={`rounded-xl border p-4 text-sm ${
        alert ? "border-amber-500/30 bg-amber-500/5" : "bg-muted/20"
      }`}
    >
      {children}
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
