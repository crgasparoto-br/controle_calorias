// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cancel: vi.fn(async () => undefined),
  confirm: vi.fn(),
  invalidate: vi.fn(async () => undefined),
  mutate: vi.fn(),
  mutationOptions: null as null | {
    onSuccess: (result: { active: boolean }) => Promise<void>;
  },
  refreshAuth: vi.fn(async () => undefined),
  reset: vi.fn(async () => undefined),
  setLocation: vi.fn(),
  queryData: {
    profile: {
      displayName: "Nutricionista Ana",
      registrationNumber: "CRN 123",
      active: true,
    },
    identity: {
      contactEmail: null,
      contactPhone: null,
      patientFacingBio: null,
    },
    preferences: {
      defaultReviewIntervalDays: null,
      messageTemplates: [],
    },
    operationalAlertCriteria: [],
    entitlements: {
      allowed: true,
      mode: "open_access" as const,
      commercialState: "active",
      planName: "Plano profissional",
      fallbackUsed: false,
      enabledResources: [],
      capacity: {
        limit: null,
        used: null,
        usageAvailable: false,
      },
    },
  },
}));

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ refresh: mocks.refreshAuth }),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/professional/settings", mocks.setLocation] as const,
}));

vi.mock("@/components/ProfessionalLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/professional/ProfessionalUi", () => ({
  ProfessionalAsyncState: ({ title }: { title: string }) => <div>{title}</div>,
  ProfessionalLoadingState: ({ label }: { label: string }) => <div>{label}</div>,
  ProfessionalPage: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
  ProfessionalPageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}));

vi.mock("@/components/professional-settings/ProfessionalIdentitySettingsCard", () => ({
  default: () => <section>Identidade</section>,
}));

vi.mock("@/components/professional-settings/ProfessionalPreferencesSettingsCard", () => ({
  default: () => <section>Preferências</section>,
}));

vi.mock("@/components/professional-settings/ProfessionalAccessSettingsCards", () => ({
  ProfessionalOperationalCriteriaCard: () => <section>Critérios</section>,
  ProfessionalEntitlementSummaryCard: () => <section>Plano</section>,
  ProfessionalAvailabilityCard: ({ onDeactivate }: { onDeactivate: () => void }) => (
    <button onClick={onDeactivate}>Desativar Área Profissional</button>
  ),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      professionalRecord: {
        settings: {
          get: { invalidate: mocks.invalidate },
          entitlements: { invalidate: mocks.invalidate },
        },
        get: { cancel: mocks.cancel, reset: mocks.reset },
        messages: { list: { cancel: mocks.cancel, reset: mocks.reset } },
        operationalAlerts: {
          list: { cancel: mocks.cancel, reset: mocks.reset },
        },
        ai: { priorities: { cancel: mocks.cancel, reset: mocks.reset } },
      },
      nutrition: {
        professionals: {
          profile: { invalidate: mocks.invalidate },
          myAccesses: { invalidate: mocks.invalidate },
          portfolio: { invalidate: mocks.invalidate },
          patientDashboard: { reset: mocks.reset },
          patientPeriodBundle: { reset: mocks.reset },
          patientTimeZone: { reset: mocks.reset },
        },
      },
    }),
    professionalRecord: {
      settings: {
        get: {
          useQuery: () => ({
            data: mocks.queryData,
            isLoading: false,
            isError: false,
            refetch: vi.fn(),
          }),
        },
        updateIdentity: {
          useMutation: () => ({ isPending: false, mutate: vi.fn(), error: null }),
        },
        updatePreferences: {
          useMutation: () => ({ isPending: false, mutate: vi.fn(), error: null }),
        },
        setActive: {
          useMutation: (options: NonNullable<typeof mocks.mutationOptions>) => {
            mocks.mutationOptions = options;
            return { isPending: false, mutate: mocks.mutate, error: null };
          },
        },
      },
    },
  },
}));

import ProfessionalSettingsPage from "./ProfessionalSettingsPage";

describe("ProfessionalSettingsPage deactivation", () => {
  beforeEach(() => {
    mocks.cancel.mockClear();
    mocks.confirm.mockReset();
    mocks.invalidate.mockClear();
    mocks.mutate.mockClear();
    mocks.mutationOptions = null;
    mocks.refreshAuth.mockClear();
    mocks.reset.mockClear();
    mocks.setLocation.mockClear();
    vi.stubGlobal("confirm", mocks.confirm);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("cancela a desativação quando a confirmação é recusada", () => {
    mocks.confirm.mockReturnValue(false);
    render(<ProfessionalSettingsPage />);

    fireEvent.click(
      screen.getByRole("button", { name: "Desativar Área Profissional" })
    );

    expect(mocks.confirm).toHaveBeenCalledWith(
      expect.stringContaining("Vínculos, prontuários, mensagens e histórico serão preservados")
    );
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it("limpa caches, atualiza a sessão e redireciona após desativar", async () => {
    mocks.confirm.mockReturnValue(true);
    render(<ProfessionalSettingsPage />);

    fireEvent.click(
      screen.getByRole("button", { name: "Desativar Área Profissional" })
    );
    expect(mocks.mutate).toHaveBeenCalledWith({ active: false });

    await act(async () => {
      await mocks.mutationOptions?.onSuccess({ active: false });
    });

    expect(mocks.cancel).toHaveBeenCalledTimes(4);
    expect(mocks.reset).toHaveBeenCalledTimes(7);
    expect(mocks.invalidate).toHaveBeenCalledTimes(5);
    expect(mocks.refreshAuth).toHaveBeenCalledTimes(1);
    expect(mocks.setLocation).toHaveBeenCalledWith(
      "/settings?tab=profissional"
    );
  });
});
