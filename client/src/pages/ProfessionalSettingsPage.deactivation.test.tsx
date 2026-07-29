// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authSetData: vi.fn(),
  cancel: vi.fn(async () => undefined),
  confirm: vi.fn(),
  invalidate: vi.fn(async () => undefined),
  mutate: vi.fn(),
  mutationOptions: null as null | {
    onSuccess: (result: { active: boolean }) => Promise<void>;
  },
  profileSetData: vi.fn(),
  refreshAuth: vi.fn(async () => undefined),
  reset: vi.fn(async () => undefined),
  settingsSetData: vi.fn(),
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
  useAuth: () => ({
    refresh: mocks.refreshAuth,
    user: { id: 42, professionalProfileActive: true },
  }),
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
      auth: { me: { setData: mocks.authSetData } },
      professionalRecord: {
        settings: {
          get: {
            invalidate: mocks.invalidate,
            setData: mocks.settingsSetData,
          },
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
          profile: {
            invalidate: mocks.invalidate,
            setData: mocks.profileSetData,
          },
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
    mocks.authSetData.mockClear();
    mocks.cancel.mockReset();
    mocks.cancel.mockResolvedValue(undefined);
    mocks.confirm.mockReset();
    mocks.invalidate.mockReset();
    mocks.invalidate.mockResolvedValue(undefined);
    mocks.mutate.mockClear();
    mocks.mutationOptions = null;
    mocks.profileSetData.mockClear();
    mocks.refreshAuth.mockReset();
    mocks.refreshAuth.mockResolvedValue(undefined);
    mocks.reset.mockReset();
    mocks.reset.mockResolvedValue(undefined);
    mocks.settingsSetData.mockClear();
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

  it("redireciona e fixa os caches como inativos mesmo se a reconciliação falhar", async () => {
    mocks.confirm.mockReturnValue(true);
    mocks.cancel.mockRejectedValueOnce(new Error("cancel unavailable"));
    mocks.invalidate.mockRejectedValueOnce(new Error("invalidate unavailable"));
    mocks.refreshAuth.mockRejectedValueOnce(new Error("session unavailable"));
    render(<ProfessionalSettingsPage />);

    fireEvent.click(
      screen.getByRole("button", { name: "Desativar Área Profissional" })
    );

    await act(async () => {
      await mocks.mutationOptions?.onSuccess({ active: false });
    });

    expect(mocks.authSetData).toHaveBeenCalledTimes(1);
    expect(mocks.profileSetData).toHaveBeenCalledTimes(1);
    expect(mocks.settingsSetData).toHaveBeenCalledTimes(1);

    const authUpdater = mocks.authSetData.mock.calls[0]?.[1] as (
      current: { professionalProfileActive: boolean }
    ) => { professionalProfileActive: boolean };
    const profileUpdater = mocks.profileSetData.mock.calls[0]?.[1] as (
      current: { active: boolean }
    ) => { active: boolean };
    const settingsUpdater = mocks.settingsSetData.mock.calls[0]?.[1] as (
      current: typeof mocks.queryData
    ) => typeof mocks.queryData;
    expect(authUpdater({ professionalProfileActive: true })).toMatchObject({
      professionalProfileActive: false,
    });
    expect(profileUpdater({ active: true })).toMatchObject({ active: false });
    expect(settingsUpdater(mocks.queryData).profile).toMatchObject({
      active: false,
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
