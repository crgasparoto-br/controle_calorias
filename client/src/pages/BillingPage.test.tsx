/** @vitest-environment jsdom */

import React from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invalidateOverview = vi.fn(async () => undefined);
const refetchOverview = vi.fn(async () => undefined);
const mutateRefresh = vi.fn();
const mutateCheckout = vi.fn();
const mutateCancel = vi.fn();
const mutateReactivate = vi.fn();
const mutateEarlyActivation = vi.fn();

let overviewData: any;
let couponData: any = null;

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
    useUtils: () => ({ billing: { webOverview: { invalidate: invalidateOverview } } }),
    billing: {
      webOverview: {
        useQuery: () => ({
          data: overviewData,
          isLoading: false,
          isError: false,
          refetch: refetchOverview,
        }),
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
        useMutation: () => ({ isPending: false, mutate: mutateCheckout, data: null }),
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
    "professional_patients",
  ],
  coveredBeneficiaryEntitlements: ["system_access", "web_access"],
  sortOrder: 2,
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
    window.history.replaceState({}, "", "/billing");
    vi.clearAllMocks();
  });

  afterEach(cleanup);

  it("exposes keyboard/reader semantics and responsive layout classes for plan selection and checkout", async () => {
    const { default: BillingPage } = await import("./BillingPage");
    render(<BillingPage />);

    expect(screen.getByRole("heading", { name: "Plano e acesso" })).toBeTruthy();
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
    expect(screen.getByText("Capacidade: 30 pacientes")).toBeTruthy();
    expect(
      screen.getByText(/Planos profissionais incluem recursos pessoais e profissionais na mesma assinatura/i)
    ).toBeTruthy();

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
        entitlements: ["professional_patients"],
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

  it("announces a checkout callback as pending instead of confirming access", async () => {
    window.history.replaceState({}, "", "/billing/return/success");
    const { default: BillingPage } = await import("./BillingPage");
    render(<BillingPage />);

    const status = screen.getByRole("status", { name: "" });
    expect(status.textContent).toContain("Retorno do pagamento recebido");
    expect(status.textContent).toContain("continua pendente");
  });
});
