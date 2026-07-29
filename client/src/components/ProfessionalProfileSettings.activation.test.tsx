// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invalidate: vi.fn(async () => undefined),
  mutate: vi.fn(),
  mutationOptions: null as null | {
    onSuccess: (profile: {
      displayName?: string;
      registrationNumber?: string;
      active?: boolean;
    }) => Promise<void>;
    onError: (error: Error) => Promise<void>;
  },
  refreshAuth: vi.fn(async () => undefined),
  refetchProfile: vi.fn(async () => ({ data: null })),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: 42, name: "Nutricionista Ana" },
    refresh: mocks.refreshAuth,
  }),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/settings?tab=profissional", vi.fn()] as const,
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
      auth: { me: { invalidate: mocks.invalidate } },
      nutrition: {
        professionals: {
          profile: { invalidate: mocks.invalidate },
          myAccesses: { invalidate: mocks.invalidate },
          patientRequests: { invalidate: mocks.invalidate },
          history: { invalidate: mocks.invalidate },
        },
      },
      professionalRecord: {
        settings: { entitlements: { invalidate: mocks.invalidate } },
      },
    }),
    nutrition: {
      professionals: {
        profile: {
          useQuery: () => ({
            data: null,
            isSuccess: true,
            isLoading: false,
            isError: false,
            refetch: mocks.refetchProfile,
          }),
        },
        upsertProfile: {
          useMutation: (options: NonNullable<typeof mocks.mutationOptions>) => {
            mocks.mutationOptions = options;
            return { isPending: false, mutate: mocks.mutate };
          },
        },
      },
    },
  },
}));

import ProfessionalProfileSettings from "./ProfessionalProfileSettings";

describe("ProfessionalProfileSettings activation", () => {
  beforeEach(() => {
    mocks.invalidate.mockClear();
    mocks.mutate.mockClear();
    mocks.refreshAuth.mockClear();
    mocks.refetchProfile.mockClear();
    mocks.refetchProfile.mockResolvedValue({ data: null });
    mocks.toastError.mockClear();
    mocks.toastSuccess.mockClear();
    mocks.mutationOptions = null;
  });

  afterEach(cleanup);

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

    expect(mocks.mutate).toHaveBeenCalledWith({
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

    expect(mocks.mutate).not.toHaveBeenCalled();
    expect(mocks.toastError).toHaveBeenCalledWith(
      "Informe o nome profissional antes de ativar o perfil."
    );
  });

  it("refaz sessão, perfil e entitlements após sucesso", async () => {
    render(<ProfessionalProfileSettings />);

    await act(async () => {
      await mocks.mutationOptions?.onSuccess({
        displayName: "Nutricionista Ana",
        registrationNumber: "CRN 123",
        active: true,
      });
    });

    expect(mocks.invalidate).toHaveBeenCalledTimes(6);
    expect(mocks.refreshAuth).toHaveBeenCalledTimes(1);
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Perfil profissional salvo.");
  });

  it("reconcilia o estado remoto antes de informar falha temporária", async () => {
    render(<ProfessionalProfileSettings />);

    const activation = screen.getByRole("checkbox", {
      name: /Ativar área Profissional/i,
    });
    fireEvent.click(activation);
    expect(activation.getAttribute("data-state")).toBe("checked");

    await act(async () => {
      await mocks.mutationOptions?.onError(
        new Error("Serviço temporariamente indisponível")
      );
    });

    expect(mocks.invalidate).toHaveBeenCalledTimes(6);
    expect(mocks.refreshAuth).toHaveBeenCalledTimes(1);
    expect(mocks.refetchProfile).toHaveBeenCalledTimes(1);
    expect(activation.getAttribute("data-state")).toBe("unchecked");
    expect(mocks.toastError).toHaveBeenCalledWith(
      "Serviço temporariamente indisponível"
    );
  });
});
