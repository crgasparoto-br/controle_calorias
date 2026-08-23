/** @vitest-environment jsdom */

import React from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invalidateOverview = vi.fn(async () => undefined);
const invalidateNotifications = vi.fn(async () => undefined);
const refetchOverview = vi.fn(async () => undefined);
const refetchNotifications = vi.fn(async () => undefined);
const mutateRefresh = vi.fn();
const mutateCheckout = vi.fn();
const mutateRegularize = vi.fn();
const mutateCancel = vi.fn();
const mutateReactivate = vi.fn();
const mutateEarlyActivation = vi.fn();
const mutateMarkRead = vi.fn();

let overviewData: any;
let couponData: any = null;
let notificationsData: any[] = [];
let checkoutMutationOptions: any = null;
let checkoutMutationData: any = null;
let checkoutMutationVariables: any = undefined;

vi.mock("@/components/DashboardLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <main data-testid="dashboard-layout">{children}</main>
  ),
}));

vi.mock("@/components/PageIntro", () => ({
  default: ({ title, description }: { title: string; description: string }) => (
    <header>
      <h1>{title}</h1>
      <p>{description}</p>
    </header>
  ),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      billing: {
        webOverview: { invalidate: invalidateOverview },
        notifications: { invalidate: invalidateNotifications },
      },
    }),
    billing: {
      webOverview: {
        useQuery: () => ({
          data: overviewData,
          isLoading: false,
          isError: false,
          refetch: refetchOverview,
        }),
      },
      notifications: {
        useQuery: () => ({
          data: notificationsData,
          isLoading: false,
          isError: false,
          refetch: refetchNotifications,
        }),
      },
      markNotificationRead: {
        useMutation: () => ({ isPending: false, mutate: mutateMarkRead }),
      },
      couponEligibility: {
        useQuery: () => ({
          data: couponData,
          isFetching: false,
        }),
      },
      refreshOnboardingActivation: {
        useMutation: () => ({ isPending: false, mutate: mutateRefresh }),
      },
      startCheckout: {
        useMutation: (options: any) => {
          checkoutMutationOptions = options;
          return {
            isPending: false,
            mutate: (variables: any) => {
              checkoutMutationVariables = variables;
              mutateCheckout(variables);
            },
            data: checkoutMutationData,
            variables: checkoutMutationVariables,
          };
        },
      },
      regularizeSubscription: {
        useMutation: () => ({ isPending: false, mutate: mutateRegularize }),
      },
      cancelSubscription: {
        useMutation: () => ({ isPending: false, mutate: mutateCancel }),
      },
      reactivateSubscription: {
        useMutation: () => ({ isPending: false, mutate: mutateReactivate }),
      },
      activateProfessionalTrialNow: {
        useMutation: () => ({ isPending: false, mutate: mutateEarlyActivation }),
      },
    },
  },
}));

const individualPlan = {
  productCode: "individual",
  versionCode: "individual_monthly_v1",
  version: 1,
  audience: "individual" as const,
  name: "Individual",
  description: null,
  billingCycle: "monthly" as const,
  currency: "BRL" as const,
  unitAmount: 1990,
  capacityLimit: null,
  entitlements: ["system_access", "web_access", "whatsapp_access"],
  coveredBeneficiaryEntitlements: [],
  commercialPaymentMethods: ["credit_card" as const, "pix_automatic" as const],
  effectivePaymentMethods: ["credit_card" as const, "pix_automatic" as const],
  effectiveFrom: new Date("2026-08-01T00:00:00.000Z"),
  effectiveUntil: null,
  sortOrder: 1,
};

const professionalPlan = {
  ...individualPlan,
  productCode: "professional",
  versionCode: "professional_monthly_v1",
  audience: "professional" as const,
  name: "Profissional",
  unitAmount: 7990,
  capacityLimit: 30,
  entitlements: [
    "system_access",
    "web_access",
    "whatsapp_access",
    "meal_text",
    "meal_image",
    "meal_audio",
    "ai_assistance",
    "nutrition_goals",
    "reports",
    "weight_tracking",
    "water_tracking",
    "exercise_tracking",
    "health_integrations",
    "professional_dashboard",
    "professional_portfolio",
    "professional_record",
    "professional_goals",
    "professional_operational_alerts",
    "professional_messages",
    "professional_reports",
    "professional_ai_assistance",
    "professional_settings",
  ],
  coveredBeneficiaryEntitlements: [
    "system_access",
    "web_access",
    "whatsapp_access",
    "meal_text",
    "meal_image",
    "meal_audio",
    "ai_assistance",
    "nutrition_goals",
    "reports",
    "weight_tracking",
    "water_tracking",
    "exercise_tracking",
    "health_integrations",
  ],
  sortOrder: 2,
};

const individualSubscription = {
  id: "subscription-1",
  provider: "asaas",
  planCode: "individual",
  planName: "Individual",
  status: "past_due",
  billingCycle: "monthly",
  currency: "BRL",
  unitAmount: 1990,
  currentPeriodStart: new Date("2026-08-01T00:00:00.000Z"),
  currentPeriodEnd: new Date("2026-09-01T00:00:00.000Z"),
  cancelAtPeriodEnd: false,
};

function baseOverview(overrides: Record<string, unknown> = {}) {
  return {
    access: {
      allowed: false,
      reason: "no_access",
      entitlements: [],
      sourceAvailable: true,
      evaluatedAt: new Date(),
    },
    subscription: null,
    professionalSubscription: null,
    professionalCapacity: null,
    sponsoredCoverage: false,
    professionalCoverageIndividualRenewal: null,
    lifecycle: null,
    management: null,
    history: [],
    catalog: [individualPlan, professionalPlan],
    actions: {
      canStartCheckout: true,
      canCancelRenewal: false,
      canReactivateRenewal: false,
      canActivateProfessionalTrialNow: false,
      canRegularize: false,
      canCreateNewSubscription: true,
    },
    ...overrides,
  };
}

describe("BillingPage accessibility and responsive contract", () => {
  beforeEach(() => {
    overviewData = baseOverview();
    couponData = null;
    notificationsData = [];
    checkoutMutationOptions = null;
    checkoutMutationData = null;
    checkoutMutationVariables = undefined;
    window.history.replaceState({}, "", "/billing");
    vi.clearAllMocks();
  });

  afterEach(cleanup);

  it("exposes keyboard/reader semantics and the complete professional matrix for plan selection and checkout", async () => {
    const { default: BillingPage } = await import("./BillingPage");
    render(<BillingPage />);

    expect(screen.getByRole("heading", { name: "Plano e acesso" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Avisos sobre plano e acesso" })).toBeTruthy();
    const offersHeading = screen.getByRole("heading", {
      name: "Compare os planos disponíveis",
    });
    const offersSection = offersHeading.closest("section");
    expect(offersSection?.getAttribute("aria-labelledby")).toBe("offers-heading");

    const individualButton = screen.getByRole("button", { name: /Individual/i });
    const professionalButton = screen.getByRole("button", { name: /Profissional/i });
    expect(individualButton.getAttribute("aria-pressed")).toBe("true");
    expect(professionalButton.getAttribute("aria-pressed")).toBe("false");

    professionalButton.focus();
    expect(document.activeElement).toBe(professionalButton);
    fireEvent.click(professionalButton);
    expect(professionalButton.getAttribute("aria-pressed")).toBe("true");

    const offersGrid = professionalButton.parentElement;
    expect(offersGrid?.className).toContain("md:grid-cols-2");
    expect(offersGrid?.className).toContain("xl:grid-cols-3");
    expect(within(professionalButton).getByText("Capacidade: 30 pacientes")).toBeTruthy();
    expect(
      screen.getByText(/Planos profissionais incluem recursos pessoais e profissionais na mesma assinatura/i)
    ).toBeTruthy();
    expect(within(professionalButton).getByText("Recursos pessoais incluídos")).toBeTruthy();
    expect(within(professionalButton).getByText("Recursos profissionais incluídos")).toBeTruthy();
    expect(within(professionalButton).getByText("Painel profissional")).toBeTruthy();
    expect(within(professionalButton).getByText("Configurações profissionais")).toBeTruthy();
    expect(
      within(professionalButton).getByText(/Seu uso pessoal não consome vaga da carteira/i)
    ).toBeTruthy();

    expect(screen.getByText("Recursos desta contratação")).toBeTruthy();
    expect(screen.getByText(/não existe uma segunda cobrança para o uso pessoal/i)).toBeTruthy();
    expect(screen.getByText("Capacidade", { selector: "p" })).toBeTruthy();
    expect(screen.getByText("Seu uso pessoal não consome uma vaga")).toBeTruthy();

    const paymentGroup = screen.getByRole("group", { name: "Forma de pagamento" });
    expect(within(paymentGroup).getByRole("radio", { name: /Cartão de crédito/i })).toBeTruthy();
    expect(within(paymentGroup).getByRole("radio", { name: /Pix Automático/i })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: /Iniciar período de avaliação/i })).toBeTruthy();

    const checkoutButton = screen.getByRole("button", {
      name: "Continuar para pagamento seguro",
    });
    expect(checkoutButton.className).toContain("w-full");
    expect(checkoutButton.className).toContain("sm:w-auto");
  });

  it("ignores a delayed checkout response after the user changes the commercial context", async () => {
    const { default: BillingPage } = await import("./BillingPage");
    const { toast } = await import("sonner");
    render(<BillingPage />);

    fireEvent.change(screen.getByLabelText("Nome do pagador"), {
      target: { value: "Pessoa" },
    });
    fireEvent.change(screen.getByLabelText("Telefone com DDD"), {
      target: { value: "15999999999" },
    });
    fireEvent.change(screen.getByLabelText("CPF ou CNPJ"), {
      target: { value: "12345678901" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Continuar para pagamento seguro" })
    );

    const submitted = mutateCheckout.mock.calls[0]?.[0];
    expect(submitted?.versionCode).toBe("individual_monthly_v1");
    expect(checkoutMutationOptions).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Profissional/i }));
    await checkoutMutationOptions.onSuccess(
      {
        flow: {
          kind: "hosted_checkout",
          provider: "asaas",
          externalId: "checkout-old",
          url: "https://example.test/old-checkout",
          state: "pending",
        },
        subscriptionId: null,
        pendingAuthoritativeConfirmation: true,
      },
      submitted
    );

    expect(toast.info).toHaveBeenCalledWith(
      "Recebemos uma resposta de uma tentativa anterior. Sua seleção atual foi preservada; revise-a antes de continuar."
    );
    expect(invalidateOverview).toHaveBeenCalled();
  });

  it("does not render stale Pix authorization data for another selected offer", async () => {
    checkoutMutationData = {
      flow: {
        kind: "pix_automatic",
        provider: "asaas",
        externalId: "pix-old",
        qrCodePayload: "stale-pix-payload",
        state: "pending",
      },
      subscriptionId: null,
      pendingAuthoritativeConfirmation: true,
    };
    checkoutMutationVariables = {
      contractKey: "web_old_attempt",
      versionCode: "professional_monthly_v1",
      paymentMethod: "pix_automatic",
      trialChoice: "waive",
      couponCode: null,
    };

    const { default: BillingPage } = await import("./BillingPage");
    render(<BillingPage />);

    expect(screen.queryByText("Autorização Pix iniciada")).toBeNull();
    expect(screen.queryByText("stale-pix-payload")).toBeNull();
  });

  it("renders notification campaign, version, date, situation and distinct read action", async () => {
    notificationsData = [
      {
        notificationId: "fact-1",
        campaign: "Regularização financeira",
        campaignVersion: "v1",
        title: "Pagamento pendente",
        whatOccurred: "O backend confirmou uma pendência financeira na assinatura.",
        effectiveAt: new Date("2026-08-22T08:00:00.000Z"),
        expectedAction: "Regularize a cobrança pelo fluxo seguro disponível em Plano e acesso.",
        consequence: "Sem regularização, a assinatura pode ser suspensa.",
        support: "Use o canal oficial de suporte do aplicativo.",
        actionHref: "/billing",
        readState: "unread",
        readAt: null,
        deliveryState: "failed",
        deliveryChannel: "whatsapp",
        deliveryUpdatedAt: new Date("2026-08-22T08:05:00.000Z"),
        completionState: "open",
        situation: "Ação ou acompanhamento pendente",
      },
    ];
    const { default: BillingPage } = await import("./BillingPage");
    render(<BillingPage />);

    const article = screen.getByRole("article", { name: "Pagamento pendente" });
    expect(within(article).getByText("Regularização financeira", { exact: false })).toBeTruthy();
    expect(within(article).getByText("v1", { exact: false })).toBeTruthy();
    expect(within(article).getByText("Ação ou acompanhamento pendente")).toBeTruthy();
    expect(within(article).getByText(/envio externo por WhatsApp não foi confirmado/i)).toBeTruthy();

    fireEvent.click(
      within(article).getByRole("button", { name: "Marcar como lido: Pagamento pendente" })
    );
    expect(mutateMarkRead).toHaveBeenCalledWith({ notificationId: "fact-1" });
    expect(within(article).getByText(/Regularize a cobrança/i)).toBeTruthy();
  });

  it("shows the canonical seven-day coverage-loss transition and the following read-only state", async () => {
    overviewData = baseOverview({
      access: {
        allowed: true,
        reason: "transition_access",
        validFrom: new Date("2026-08-20T00:00:00.000Z"),
        validUntil: new Date("2026-08-27T00:00:00.000Z"),
        entitlements: ["system_access"],
        sourceAvailable: true,
        evaluatedAt: new Date("2026-08-22T00:00:00.000Z"),
      },
    });
    const { default: BillingPage } = await import("./BillingPage");
    const { unmount } = render(<BillingPage />);
    expect(screen.getByText(/Transição de 7 dias após a perda da cobertura profissional/i)).toBeTruthy();
    unmount();

    overviewData = baseOverview({
      access: {
        allowed: true,
        reason: "read_only_access",
        entitlements: ["system_access", "read_only", "export_data", "manage_account"],
        sourceAvailable: true,
        evaluatedAt: new Date(),
      },
    });
    render(<BillingPage />);
    expect(screen.getByText(/leitura, exportação e gestão da conta/i)).toBeTruthy();
  });

  it("shows the thirty-day existing-user transition without replacing it with a trial", async () => {
    overviewData = baseOverview({
      access: {
        allowed: true,
        reason: "transition_access",
        validFrom: new Date("2026-08-01T00:00:00.000Z"),
        validUntil: new Date("2026-08-31T00:00:00.000Z"),
        entitlements: ["system_access"],
        sourceAvailable: true,
        evaluatedAt: new Date("2026-08-22T00:00:00.000Z"),
      },
    });
    const { default: BillingPage } = await import("./BillingPage");
    render(<BillingPage />);
    expect(screen.getByText(/Transição comercial de 30 dias para usuário existente/i)).toBeTruthy();
    expect(screen.getByText(/nenhum trial adicional é presumido/i)).toBeTruthy();
  });

  it("renders a safe regularization action for past_due without claiming payment", async () => {
    overviewData = baseOverview({
      access: {
        allowed: true,
        reason: "active_subscription",
        entitlements: ["system_access"],
        sourceAvailable: true,
        evaluatedAt: new Date(),
      },
      subscription: individualSubscription,
      lifecycle: {
        state: "past_due",
        currentPeriodStart: new Date("2026-08-01T00:00:00.000Z"),
        currentPeriodEnd: new Date("2026-09-01T00:00:00.000Z"),
        cancelAtPeriodEnd: false,
        graceEndsAt: new Date("2026-08-27T00:00:00.000Z"),
        recoveryEndsAt: null,
        trialEndsAt: null,
        reconciliationRequired: false,
      },
      management: {
        paymentMethod: "credit_card",
        canReactivateRenewal: true,
        canUpdatePaymentMethod: false,
        requiresNewPixAuthorizationForReactivation: false,
      },
      actions: {
        canStartCheckout: false,
        canCancelRenewal: true,
        canReactivateRenewal: false,
        canActivateProfessionalTrialNow: false,
        canRegularize: true,
        canCreateNewSubscription: false,
      },
    });
    const { default: BillingPage } = await import("./BillingPage");
    render(<BillingPage />);

    expect(screen.getByText(/carência de 7 dias preserva o acesso/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Regularizar cobrança" }));
    expect(mutateRegularize).toHaveBeenCalledWith({ subscriptionId: "subscription-1" });
    expect(screen.getByText(/O acesso só muda após confirmação financeira autoritativa/i)).toBeTruthy();
  });

  it("shows capacity horizon, canonical milestones and commercial analysis without threatening patient removal", async () => {
    overviewData = baseOverview({
      access: {
        allowed: true,
        reason: "active_subscription",
        entitlements: ["system_access"],
        sourceAvailable: true,
        evaluatedAt: new Date(),
      },
      professionalSubscription: {
        id: "subscription-pro",
        provider: "asaas",
        planCode: "professional",
        planName: "Profissional",
        status: "active",
        billingCycle: "monthly",
        currency: "BRL",
        unitAmount: 7990,
        currentPeriodStart: new Date("2026-08-01T00:00:00.000Z"),
        currentPeriodEnd: new Date("2026-09-01T00:00:00.000Z"),
        cancelAtPeriodEnd: false,
        planId: "plan-pro",
        capacityLimit: 30,
        capacityUsed: 120,
        entitlements: ["professional_dashboard"],
      },
      professionalCapacity: {
        state: "grandfathered_active",
        contractedLimit: 30,
        occupancy: 120,
        available: 0,
        excess: 90,
        temporaryLimit: 120,
        temporaryEndsAt: new Date("2026-11-20T00:00:00.000Z"),
        temporaryWindowKind: "initial",
        temporaryWindowDays: 90,
        commercialAnalysisRequired: true,
        newCoverageBlocked: true,
        warningMilestones: [
          { key: "started", dueAt: new Date("2026-08-22T00:00:00.000Z"), daysRemaining: 90, reached: true },
          { key: "d60", dueAt: new Date("2026-09-21T00:00:00.000Z"), daysRemaining: 60, reached: false },
          { key: "d30", dueAt: new Date("2026-10-21T00:00:00.000Z"), daysRemaining: 30, reached: false },
          { key: "d15", dueAt: new Date("2026-11-05T00:00:00.000Z"), daysRemaining: 15, reached: false },
          { key: "d7", dueAt: new Date("2026-11-13T00:00:00.000Z"), daysRemaining: 7, reached: false },
          { key: "expired", dueAt: new Date("2026-11-20T00:00:00.000Z"), daysRemaining: 0, reached: false },
        ],
      },
    });
    const { default: BillingPage } = await import("./BillingPage");
    render(<BillingPage />);

    expect(screen.getByText(/Período inicial confirmado de 90 dias/i)).toBeTruthy();
    expect(screen.getByText("60 dias antes")).toBeTruthy();
    expect(screen.getByText("7 dias antes")).toBeTruthy();
    expect(screen.getByText(/Nenhum plano público atual comporta toda a carteira/i)).toBeTruthy();
    expect(screen.getByText(/pacientes existentes, vínculos e dados não são removidos automaticamente/i)).toBeTruthy();
  });

  it("shows the covered user's own renewal choice without sponsor finances", async () => {
    overviewData = baseOverview({
      access: {
        allowed: true,
        reason: "sponsored_by_professional",
        sponsorUserId: 77,
        entitlements: ["system_access"],
        sourceAvailable: true,
        evaluatedAt: new Date(),
      },
      sponsoredCoverage: true,
      subscription: { ...individualSubscription, status: "active", cancelAtPeriodEnd: true },
      professionalCoverageIndividualRenewal: {
        status: "confirmed",
        subscriptionId: "subscription-1",
        cancelAtPeriodEnd: true,
        canKeepRenewal: true,
        requiresNewPixAuthorization: false,
        effectiveAt: new Date(),
      },
      management: {
        paymentMethod: "credit_card",
        canReactivateRenewal: true,
        canUpdatePaymentMethod: false,
        requiresNewPixAuthorizationForReactivation: false,
      },
      catalog: [],
      actions: {
        canStartCheckout: false,
        canCancelRenewal: false,
        canReactivateRenewal: true,
        canActivateProfessionalTrialNow: false,
        canRegularize: false,
        canCreateNewSubscription: false,
      },
    });
    const { default: BillingPage } = await import("./BillingPage");
    render(<BillingPage />);

    expect(screen.getByText(/próxima renovação da sua assinatura individual foi cancelada/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Manter renovação individual" })).toBeTruthy();
    expect(screen.queryByText("Capacidade profissional")).toBeNull();
  });

  it("keeps sponsor finances and capacity absent for a covered patient", async () => {
    overviewData = baseOverview({
      access: {
        allowed: true,
        reason: "sponsored_by_professional",
        sponsorUserId: 77,
        entitlements: ["system_access"],
        sourceAvailable: true,
        evaluatedAt: new Date(),
      },
      sponsoredCoverage: true,
      catalog: [],
      actions: {
        canStartCheckout: false,
        canCancelRenewal: false,
        canReactivateRenewal: false,
        canActivateProfessionalTrialNow: false,
        canRegularize: false,
        canCreateNewSubscription: true,
      },
    });
    const { default: BillingPage } = await import("./BillingPage");
    render(<BillingPage />);

    expect(
      screen.getByText(/Seu acesso é coberto por um profissional/i)
    ).toBeTruthy();
    expect(screen.queryByText("Capacidade profissional")).toBeNull();
    expect(screen.queryByText(/Valor registrado no contrato atual/i)).toBeNull();
  });

  it("fails closed when professional capacity cannot be loaded", async () => {
    overviewData = baseOverview({
      access: {
        allowed: true,
        reason: "active_subscription",
        entitlements: ["system_access"],
        sourceAvailable: true,
        evaluatedAt: new Date(),
      },
      professionalSubscription: {
        id: "subscription-pro",
        provider: "asaas",
        planCode: "professional",
        planName: "Profissional",
        status: "active",
        billingCycle: "monthly",
        currency: "BRL",
        unitAmount: 7990,
        currentPeriodStart: new Date("2026-08-01T00:00:00.000Z"),
        currentPeriodEnd: new Date("2026-09-01T00:00:00.000Z"),
        cancelAtPeriodEnd: false,
        planId: "plan-pro",
        capacityLimit: 30,
        capacityUsed: 12,
        entitlements: ["professional_dashboard"],
      },
      professionalCapacity: null,
    });
    const { default: BillingPage } = await import("./BillingPage");
    render(<BillingPage />);

    expect(screen.getByText("Capacidade profissional")).toBeTruthy();
    expect(
      screen.getByText(/Nenhum limite temporário será inferido pela interface/i)
    ).toBeTruthy();
  });

  it("renders the backend coupon rejection reason instead of a generic failure", async () => {
    couponData = { eligible: false, reason: "total_limit_reached" };
    const { default: BillingPage } = await import("./BillingPage");
    render(<BillingPage />);
    fireEvent.change(screen.getByLabelText("Cupom (opcional)"), {
      target: { value: "PROMO" },
    });
    expect(screen.getByRole("alert").textContent).toContain("esgotou o limite total");
  });

  it("announces a checkout callback as pending instead of confirming access", async () => {
    window.history.replaceState({}, "", "/billing/return/success");
    const { default: BillingPage } = await import("./BillingPage");
    render(<BillingPage />);

    const statuses = screen.getAllByRole("status");
    expect(statuses.some(status => status.textContent?.includes("Retorno do pagamento recebido"))).toBe(true);
    expect(statuses.some(status => status.textContent?.includes("continua pendente"))).toBe(true);
  });
});
