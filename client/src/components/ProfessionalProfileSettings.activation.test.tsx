// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authSetData: vi.fn(),
  authUser: {
    id: 42,
    name: "Nutricionista Ana",
    professionalProfileActive: false,
  } as Record<string, unknown>,
  confirm: vi.fn(),
  cancel: vi.fn(async () => undefined),
  entitlementsData: {
    allowed: true,
    commercialState: "active",
    enabledResources: ["professional_settings"],
  } as {
    allowed: boolean;
    commercialState: string;
    enabledResources: string[];
  },
  entitlementsIsError: false,
  entitlementsIsLoading: false,
  invalidate: vi.fn(async () => undefined),
  profileData: null as null | {
    userId?: number;
    displayName?: string;
    registrationNumber?: string;
    active?: boolean;
    createdAt?: number;
    updatedAt?: number;
  },
  profileSetData: vi.fn(),
  refreshAuth: vi.fn(async () => undefined),
  refetchProfile: vi.fn(async () => ({ data: null })),
  reset: vi.fn(async () => undefined),
  settingsGetSetData: vi.fn(),
  setActiveMutate: vi.fn(),
  setActiveOptions: null as null | {
    onSuccess: (result: { active: boolean }) => Promise<void>;
    onError: (error: Error) => void;
  },
  setLocation: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  upsertMutate: vi.fn(),
  upsertOptions: null as null | {
    onSuccess: (profile: {
      userId?: number;
      displayName?: string;
      registrationNumber?: string;
      active?: boolean;
      createdAt?: number;
      updatedAt?: number;
    }) => Promise<void>;
    onError: (error: Error) => Promise<void>;
  },
}));

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({
    user: mocks.authUser,
    refresh: mocks.refreshAuth,
  }),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/settings?tab=profissional", mocks.setLocation] as const,
}));

vi.mock("sonner", () => ({
  toast: {
    error: mocks.toastError,
    success: mocks.toastSuccess,
  },
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      auth: {
        me: {
          invalidate: mocks.invalidate,
          setData: (input: unknown, updater: unknown) => {
            mocks.authSetData(input, updater);
            mocks.authUser =
              typeof updater === "function"
                ? (
                    updater as (
                      current: typeof mocks.authUser
                    ) => typeof mocks.authUser
                  )(mocks.authUser)
                : (updater as typeof mocks.authUser);
          },
        },
      },
      nutrition: {
        professionals: {
          profile: {
            invalidate: mocks.invalidate,
            setData: (input: unknown, updater: unknown) => {
              mocks.profileSetData(input, updater);
              mocks.profileData =
                typeof updater === "function"
                  ? (
                      updater as (
                        current: typeof mocks.profileData
                      ) => typeof mocks.profileData
                    )(mocks.profileData)
                  : (updater as typeof mocks.profileData);
            },
          },
          myAccesses: { invalidate: mocks.invalidate },
          patientRequests: { invalidate: mocks.invalidate },
          history: { invalidate: mocks.invalidate },
          patientDashboard: { reset: mocks.reset },
          patientPeriodBundle: { reset: mocks.reset },
          patientTimeZone: { reset: mocks.reset },
        },
      },
      professionalRecord: {
        get: { cancel: mocks.cancel, reset: mocks.reset },
        messages: { list: { cancel: mocks.cancel, reset: mocks.reset } },
        operationalAlerts: {
          list: { cancel: mocks.cancel, reset: mocks.reset },
        },
        ai: { priorities: { cancel: mocks.cancel, reset: mocks.reset } },
        settings: {
          get: {
            invalidate: mocks.invalidate,
            setData: (input: unknown, updater: unknown) => {
              mocks.settingsGetSetData(input, updater);
            },
          },
          entitlements: { invalidate: mocks.invalidate },
        },
      },
    }),
    nutrition: {
      professionals: {
        profile: {
          useQuery: () => ({
            data: mocks.profileData,
            isSuccess: true,
            isLoading: false,
            isError: false,
            refetch: mocks.refetchProfile,
          }),
        },
        upsertProfile: {
          useMutation: (options: NonNullable<typeof mocks.upsertOptions>) => {
            mocks.upsertOptions = options;
            return { isPending: false, mutate: mocks.upsertMutate };
          },
        },
      },
    },
    professionalRecord: {
      settings: {
        entitlements: {
          useQuery: () => ({
            data: mocks.entitlementsData,
            isError: mocks.entitlementsIsError,
            isLoading: mocks.entitlementsIsLoading,
          }),
        },
        setActive: {
          useMutation: (options: NonNullable<typeof mocks.setActiveOptions>) => {
            mocks.setActiveOptions = options;
            return { isPending: false, mutate: mocks.setActiveMutate };
          },
        },
      },
    },
  },
}));

import ProfessionalProfileSettings from "./ProfessionalProfileSettings";

describe("ProfessionalProfileSettings activation", () => {
  beforeEach(() => {
    mocks.authSetData.mockClear();
    mocks.authUser = {
      id: 42,
      name: "Nutricionista Ana",
      professionalProfileActive: false,
    };
    mocks.confirm.mockReset();
    mocks.cancel.mockReset();
    mocks.cancel.mockResolvedValue(undefined);
    mocks.entitlementsData = {
      allowed: true,
      commercialState: "active",
      enabledResources: ["professional_settings"],
    };
    mocks.entitlementsIsError = false;
    mocks.entitlementsIsLoading = false;
    mocks.invalidate.mockReset();
    mocks.invalidate.mockResolvedValue(undefined);
    mocks.profileData = null;
    mocks.profileSetData.mockClear();
    mocks.refreshAuth.mockReset();
    mocks.refreshAuth.mockResolvedValue(undefined);
    mocks.refetchProfile.mockClear();
    mocks.refetchProfile.mockResolvedValue({ data: null });
    mocks.reset.mockReset();
    mocks.reset.mockResolvedValue(undefined);
    mocks.settingsGetSetData.mockClear();
    mocks.setActiveMutate.mockClear();
    mocks.setActiveOptions = null;
    mocks.setLocation.mockClear();
    mocks.toastError.mockClear();
    mocks.toastSuccess.mockClear();
    mocks.upsertMutate.mockClear();
    mocks.upsertOptions = null;
    vi.stubGlobal("confirm", mocks.confirm);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("remove o menu profissional obsoleto ao confirmar perfil inativo", () => {
    mocks.authUser = {
      id: 42,
      name: "Nutricionista Ana",
      professionalProfileActive: true,
    };

    render(<ProfessionalProfileSettings />);

    expect(mocks.authUser).toMatchObject({
      professionalProfileActive: false,
    });
    expect(mocks.authSetData).toHaveBeenCalledTimes(1);
  });

  it("associa os rótulos aos campos e envia uma ativação válida", () => {
    render(<ProfessionalProfileSettings />);

    const name = screen.getByRole("textbox", { name: "Nome profissional" });
    const registration = screen.getByRole("textbox", {
      name: "Registro profissional",
    });
    expect(name).toBeTruthy();
    expect(registration).toBeTruthy();

    fireEvent.change(registration, { target: { value: "CRN 123" } });
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Ativar área Profissional/i })
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Salvar perfil profissional" })
    );

    expect(mocks.upsertMutate).toHaveBeenCalledWith({
      displayName: "Nutricionista Ana",
      registrationNumber: "CRN 123",
      active: true,
    });
  });

  it("bloqueia a ativação sem nome profissional válido", () => {
    render(<ProfessionalProfileSettings />);

    fireEvent.change(
      screen.getByRole("textbox", { name: "Nome profissional" }),
      { target: { value: " " } }
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Ativar área Profissional/i })
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Salvar perfil profissional" })
    );

    expect(mocks.upsertMutate).not.toHaveBeenCalled();
    expect(mocks.toastError).toHaveBeenCalledWith(
      "Informe o nome profissional antes de ativar o perfil."
    );
  });

  it("mantém os CTAs de área e configurações quando a reconciliação falha após o sucesso", async () => {
    mocks.invalidate.mockRejectedValueOnce(
      new Error("profile refetch unavailable")
    );
    mocks.refreshAuth.mockRejectedValueOnce(
      new Error("session refetch unavailable")
    );
    const view = render(<ProfessionalProfileSettings />);
    mocks.authSetData.mockClear();

    await act(async () => {
      await mocks.upsertOptions?.onSuccess({
        userId: 42,
        displayName: "Nutricionista Ana",
        registrationNumber: "CRN 123",
        active: true,
        createdAt: 1,
        updatedAt: 2,
      });
    });
    view.rerender(<ProfessionalProfileSettings />);

    expect(mocks.profileData).toMatchObject({ active: true });
    expect(mocks.authUser).toMatchObject({ professionalProfileActive: true });
    expect(mocks.profileSetData).toHaveBeenCalledTimes(1);
    expect(mocks.authSetData).toHaveBeenCalledTimes(1);
    expect(mocks.invalidate).toHaveBeenCalledTimes(7);
    expect(mocks.refreshAuth).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("button", { name: "Abrir Área Profissional" })
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Abrir configurações profissionais" })
    ).toBeTruthy();
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Perfil profissional salvo.");
  });

  it("permite desativar o perfil quando o entitlement de configurações está negado", async () => {
    mocks.authUser = {
      id: 42,
      name: "Nutricionista Ana",
      professionalProfileActive: true,
    };
    mocks.profileData = {
      userId: 42,
      displayName: "Nutricionista Ana",
      registrationNumber: "CRN 123",
      active: true,
      createdAt: 1,
      updatedAt: 2,
    };
    mocks.entitlementsData = {
      allowed: true,
      commercialState: "active",
      enabledResources: ["professional_reports"],
    };
    mocks.confirm.mockReturnValue(true);
    const view = render(<ProfessionalProfileSettings />);

    expect(
      screen.getByRole("button", { name: "Abrir Área Profissional" })
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", {
        name: "Abrir configurações profissionais",
      })
    ).toBeNull();
    expect(
      screen.getByText(
        "Configurações profissionais indisponíveis no acesso atual"
      )
    ).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "Desativar Área Profissional" })
    );
    expect(mocks.confirm).toHaveBeenCalledWith(
      expect.stringContaining(
        "Vínculos, prontuários, mensagens e histórico serão preservados"
      )
    );
    expect(mocks.setActiveMutate).toHaveBeenCalledWith({ active: false });

    await act(async () => {
      await mocks.setActiveOptions?.onSuccess({ active: false });
    });
    view.rerender(<ProfessionalProfileSettings />);

    expect(mocks.profileData).toMatchObject({ active: false });
    expect(mocks.authUser).toMatchObject({ professionalProfileActive: false });
    expect(mocks.cancel).toHaveBeenCalledTimes(4);
    expect(mocks.reset).toHaveBeenCalledTimes(7);
    expect(mocks.invalidate).toHaveBeenCalledTimes(7);
    expect(mocks.settingsGetSetData).toHaveBeenCalledTimes(1);
    expect(mocks.refreshAuth).toHaveBeenCalledTimes(1);
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      "Área Profissional desativada."
    );
  });

  it("reconcilia o estado remoto antes de informar falha temporária", async () => {
    render(<ProfessionalProfileSettings />);

    const activation = screen.getByRole("checkbox", {
      name: /Ativar área Profissional/i,
    });
    fireEvent.click(activation);
    expect(activation.getAttribute("data-state")).toBe("checked");

    await act(async () => {
      await mocks.upsertOptions?.onError(
        new Error("Serviço temporariamente indisponível")
      );
    });

    expect(mocks.invalidate).toHaveBeenCalledTimes(7);
    expect(mocks.refreshAuth).toHaveBeenCalledTimes(1);
    expect(mocks.refetchProfile).toHaveBeenCalledTimes(1);
    expect(activation.getAttribute("data-state")).toBe("unchecked");
    expect(mocks.toastError).toHaveBeenCalledWith(
      "Serviço temporariamente indisponível"
    );
  });
});
