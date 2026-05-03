/** @vitest-environment jsdom */

import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const invalidateAdminOverviewMock = vi.fn(async () => undefined);
const invalidateAdminWhatsappTokenStatusMock = vi.fn(async () => undefined);
const invalidateWhatsappStatusMock = vi.fn(async () => undefined);
const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();
const mutateUpdateWhatsappTokenMock = vi.fn();

vi.mock("@/components/DashboardLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => React.createElement("div", null, children),
}));

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      nutrition: {
        admin: {
          overview: { invalidate: invalidateAdminOverviewMock },
          whatsappTokenStatus: { invalidate: invalidateAdminWhatsappTokenStatusMock },
        },
        whatsapp: {
          status: { invalidate: invalidateWhatsappStatusMock },
        },
      },
    }),
    nutrition: {
      admin: {
        overview: {
          useQuery: () => ({
            data: {
              usage: { usersCount: 4, mealsCount: 18, pendingInferences: 1, logsCount: 9 },
              users: [],
              whatsappToken: {
                configured: true,
                source: "database",
                maskedValue: "EAAcmt••••ABCD",
                updatedAt: 1714650000000,
                updatedByUserId: 7,
              },
              recentInferenceLogs: [],
            },
          }),
        },
        whatsappTokenStatus: {
          useQuery: () => ({
            data: {
              configured: true,
              source: "database",
              maskedValue: "EAAcmt••••ABCD",
              updatedAt: 1714650000000,
              updatedByUserId: 7,
            },
          }),
        },
        updateWhatsappToken: {
          useMutation: (options?: {
            onSuccess?: () => Promise<void> | void;
            onError?: (error: Error) => void;
          }) => ({
            isPending: false,
            mutate: mutateUpdateWhatsappTokenMock.mockImplementation(async (_input: { accessToken: string }) => {
              await options?.onSuccess?.();
            }),
          }),
        },
      },
    },
  },
}));

describe("AdminPage", () => {
  beforeEach(() => {
    mutateUpdateWhatsappTokenMock.mockReset();
    invalidateAdminOverviewMock.mockClear();
    invalidateAdminWhatsappTokenStatusMock.mockClear();
    invalidateWhatsappStatusMock.mockClear();
    toastSuccessMock.mockClear();
    toastErrorMock.mockClear();
  });

  it("permite digitar um novo token, salvar pela mutation e manter apenas o valor mascarado visível na interface", async () => {
    const { default: AdminPage } = await import("./AdminPage");
    const user = userEvent.setup();
    const typedToken = "EAAcmtw0AOqcBRYL_token_novo_super_seguro_1234ABCD";

    render(React.createElement(AdminPage));

    const input = screen.getByLabelText("Token de acesso do WhatsApp") as HTMLInputElement;
    expect(screen.getByText("EAAcmt••••ABCD")).toBeTruthy();
    expect(document.body.textContent).not.toContain(typedToken);

    await user.type(input, typedToken);
    await user.click(screen.getByRole("button", { name: "Salvar token" }));

    await waitFor(() => {
      expect(mutateUpdateWhatsappTokenMock).toHaveBeenCalledWith({ accessToken: typedToken });
    });
    await waitFor(() => {
      expect(invalidateAdminOverviewMock).toHaveBeenCalled();
      expect(invalidateAdminWhatsappTokenStatusMock).toHaveBeenCalled();
      expect(invalidateWhatsappStatusMock).toHaveBeenCalled();
      expect(toastSuccessMock).toHaveBeenCalledWith("Token do WhatsApp atualizado com sucesso.");
    });
    await waitFor(() => {
      expect(input.value).toBe("");
    });

    expect(document.body.textContent).toContain("EAAcmt••••ABCD");
    expect(document.body.textContent).not.toContain(typedToken);
    expect(toastErrorMock).not.toHaveBeenCalled();
  });
});
