/** @vitest-environment jsdom */

import React from "react";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invalidateAdminOverviewMock = vi.fn(async () => undefined);
const invalidateAdminWhatsappTokenStatusMock = vi.fn(async () => undefined);
const invalidateWhatsappStatusMock = vi.fn(async () => undefined);
const refetchFoodCatalogMock = vi.fn(async () => undefined);
const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();
const mutateUpdateWhatsappTokenMock = vi.fn();
const mutateRunFoodImportJobMock = vi.fn();

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
      foods: {
        catalogSearch: {
          useQuery: () => ({
            data: [],
            isLoading: false,
            isError: false,
            error: null,
            refetch: refetchFoodCatalogMock,
          }),
        },
      },
      admin: {
        overview: {
          useQuery: () => ({
            data: {
              usage: { usersCount: 4, mealsCount: 18, pendingInferences: 1, logsCount: 9 },
              users: [{
                id: 7,
                name: "Administrador de teste",
                email: "admin@example.com",
                openId: "admin-open-id",
                role: "admin",
                lastSignedIn: "2026-09-05T00:00:00.000Z",
              }],
              whatsappToken: {
                configured: true,
                source: "database",
                maskedValue: "EAAcmt••••ABCD",
                updatedAt: 1714650000000,
                updatedByUserId: 7,
              },
              recentInferenceLogs: [{
                id: "log-1",
                userId: 7,
                origin: "admin",
                status: "warning",
                eventType: "ai.inference_call",
                detail: "Análise concluída com observação operacional.",
                createdAt: 1788566400000,
              }],
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
        runFoodImportJob: {
          useMutation: (options?: {
            onSuccess?: (report: unknown) => Promise<void> | void;
            onError?: (error: Error) => void;
          }) => ({
            isPending: false,
            mutate: mutateRunFoodImportJobMock.mockImplementation(async () => {
              await options?.onSuccess?.({
                sourceSlug: "taco",
                sourceVersion: "test",
                inserted: 1,
                updated: 0,
                ignored: 0,
                aliasesInserted: 1,
                portionsInserted: 1,
                possibleDuplicates: [],
                errors: [],
              });
            }),
          }),
        },
      },
    },
  },
}));

describe("AdminPage", () => {
  afterEach(cleanup);

  beforeEach(() => {
    mutateUpdateWhatsappTokenMock.mockReset();
    mutateRunFoodImportJobMock.mockReset();
    refetchFoodCatalogMock.mockClear();
    invalidateAdminOverviewMock.mockClear();
    invalidateAdminWhatsappTokenStatusMock.mockClear();
    invalidateWhatsappStatusMock.mockClear();
    toastSuccessMock.mockClear();
    toastErrorMock.mockClear();
  });

  it("permite atualizar a credencial do WhatsApp mantendo apenas o valor mascarado visível", async () => {
    const { default: AdminPage } = await import("./AdminPage");
    const user = userEvent.setup();
    const typedToken = "EAAcmtw0AOqcBRYL_token_novo_super_seguro_1234ABCD";

    render(React.createElement(AdminPage));

    const whatsappCardTitle = screen.getByText("Credencial do WhatsApp");
    const whatsappCard = whatsappCardTitle.closest("[data-slot='card']");
    expect(whatsappCard).toBeTruthy();

    const whatsappCardScope = within(whatsappCard as HTMLElement);
    const input = whatsappCardScope.getByLabelText("Chave de acesso do WhatsApp") as HTMLInputElement;
    expect(screen.getByText("EAAcmt••••ABCD")).toBeTruthy();
    expect(document.body.textContent).not.toContain(typedToken);

    await user.type(input, typedToken);
    await user.click(whatsappCardScope.getByRole("button", { name: /Salvar credencial/i }));

    await waitFor(() => {
      expect(mutateUpdateWhatsappTokenMock).toHaveBeenCalledWith({ accessToken: typedToken });
    });
    await waitFor(() => {
      expect(invalidateAdminOverviewMock).toHaveBeenCalled();
      expect(invalidateAdminWhatsappTokenStatusMock).toHaveBeenCalled();
      expect(invalidateWhatsappStatusMock).toHaveBeenCalled();
      expect(toastSuccessMock).toHaveBeenCalledWith("Credencial do WhatsApp atualizada com sucesso.");
    });
    await waitFor(() => {
      expect(input.value).toBe("");
    });

    expect(document.body.textContent).toContain("EAAcmt••••ABCD");
    expect(document.body.textContent).not.toContain(typedToken);
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it("traduz papéis, estados, origens e eventos internos para linguagem administrativa", async () => {
    const { default: AdminPage } = await import("./AdminPage");
    const user = userEvent.setup();

    render(React.createElement(AdminPage));

    expect(screen.getByText("Administrador")).toBeTruthy();
    expect(screen.getByText("Análise por inteligência artificial")).toBeTruthy();
    expect(screen.getByText("Atenção")).toBeTruthy();
    expect(screen.getByText(/Administração ·/)).toBeTruthy();
    expect(document.body.textContent).not.toContain("ai.inference_call");
    expect(document.body.textContent).not.toContain("warning");

    await user.click(screen.getByRole("tab", { name: "Base de alimentos" }));
    expect(screen.getByText("Base inicial do Brasil")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Carregar base inicial" })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\bseed\b/i);
    expect(document.body.textContent).not.toMatch(/\bjob\b/i);
    expect(document.body.textContent).not.toMatch(/\baliases\b/i);
  });
});
