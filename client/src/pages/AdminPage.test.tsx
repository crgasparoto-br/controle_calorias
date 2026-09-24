/** @vitest-environment jsdom */

import React from "react";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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
const activityQueryInputMock = vi.fn();

vi.mock("@/components/DashboardLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", null, children),
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
          whatsappTokenStatus: {
            invalidate: invalidateAdminWhatsappTokenStatusMock,
          },
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
              usage: {
                usersCount: 4,
                mealsCount: 18,
                pendingInferences: 1,
                logsCount: 9,
              },
              users: [
                {
                  id: 7,
                  name: "Administrador de teste",
                  email: "admin@example.com",
                  openId: "admin-open-id",
                  role: "admin",
                  lastSignedIn: "2026-09-05T00:00:00.000Z",
                },
                {
                  id: 8,
                  name: "Maria Profissional",
                  email: "maria@example.com",
                  openId: "maria-open-id",
                  role: "user",
                  profile: "professional",
                  lastSignedIn: new Date().toISOString(),
                },
                {
                  id: 9,
                  name: "Usuário Antigo",
                  email: "antigo@example.com",
                  openId: "old-open-id",
                  role: "user",
                  profile: "user",
                  lastSignedIn: "2025-01-05T00:00:00.000Z",
                },
              ],
              whatsappToken: {
                configured: true,
                source: "database",
                maskedValue: "EAAcmt••••ABCD",
                updatedAt: 1714650000000,
                updatedByUserId: 7,
              },
              recentInferenceLogs: [
                {
                  id: "log-1",
                  userId: 7,
                  origin: "admin",
                  status: "warning",
                  eventType: "ai.inference_call",
                  detail: "Análise concluída com observação operacional.",
                  createdAt: 1788566400000,
                },
              ],
            },
          }),
        },
        activities: {
          useQuery: (input: unknown) => {
            activityQueryInputMock(input);
            return {
              data: {
                items: [
                  {
                    id: "log-1",
                    userId: 7,
                    origin: "admin",
                    status: "warning",
                    eventType: "ai.inference_call",
                    detail: "Análise concluída com observação operacional.",
                    createdAt: 1788566400000,
                  },
                ],
                total: 1,
                availableTotal: 1,
                page: 1,
                pageSize: 20,
                totalPages: 3,
                range: {
                  from: "2026-09-01T00:00:00.000Z",
                  to: "2026-09-08T00:00:00.000Z",
                },
                source: "persisted",
              },
              isLoading: false,
              isError: false,
            };
          },
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
            mutate: mutateUpdateWhatsappTokenMock.mockImplementation(
              async (_input: { accessToken: string }) => {
                await options?.onSuccess?.();
              }
            ),
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
    activityQueryInputMock.mockClear();
  });

  it("permite atualizar a credencial do WhatsApp mantendo apenas o valor mascarado visível", async () => {
    const { default: AdminPage } = await import("./AdminPage");
    const user = userEvent.setup();
    const typedToken = "EAAcmtw0AOqcBRYL_token_novo_super_seguro_1234ABCD";

    render(React.createElement(AdminPage));

    await user.click(screen.getByRole("tab", { name: "Configurações" }));

    const whatsappCardTitle = screen.getByText("Credencial do WhatsApp");
    const whatsappCard = whatsappCardTitle.closest("[data-slot='card']");
    expect(whatsappCard).toBeTruthy();

    const whatsappCardScope = within(whatsappCard as HTMLElement);
    expect(
      whatsappCardScope.getByRole("button", { name: "Substituir credencial" })
    ).toBeTruthy();
    expect(
      whatsappCardScope.queryByLabelText("Nova chave de acesso do WhatsApp")
    ).toBeNull();
    await user.click(
      whatsappCardScope.getByRole("button", { name: "Substituir credencial" })
    );
    const input = whatsappCardScope.getByLabelText(
      "Nova chave de acesso do WhatsApp"
    ) as HTMLInputElement;
    expect(screen.getByText("EAAcmt••••ABCD")).toBeTruthy();
    expect(document.body.textContent).not.toContain(typedToken);

    await user.type(input, typedToken);
    await user.click(
      whatsappCardScope.getByRole("button", { name: /Salvar credencial/i })
    );

    await waitFor(() => {
      expect(mutateUpdateWhatsappTokenMock).toHaveBeenCalledWith({
        accessToken: typedToken,
      });
    });
    await waitFor(() => {
      expect(invalidateAdminOverviewMock).toHaveBeenCalled();
      expect(invalidateAdminWhatsappTokenStatusMock).toHaveBeenCalled();
      expect(invalidateWhatsappStatusMock).toHaveBeenCalled();
      expect(toastSuccessMock).toHaveBeenCalledWith(
        "Credencial do WhatsApp atualizada com sucesso."
      );
    });
    await waitFor(() => {
      expect(
        whatsappCardScope.queryByLabelText("Nova chave de acesso do WhatsApp")
      ).toBeNull();
    });

    expect(document.body.textContent).toContain("EAAcmt••••ABCD");
    expect(document.body.textContent).not.toContain(typedToken);
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it("traduz papéis, estados, origens e eventos internos para linguagem administrativa", async () => {
    const { default: AdminPage } = await import("./AdminPage");
    const user = userEvent.setup();

    render(React.createElement(AdminPage));

    await user.click(screen.getByRole("tab", { name: "Usuários" }));

    expect(screen.getAllByText("Administrador").length).toBeGreaterThan(0);
    await user.click(screen.getByRole("tab", { name: "Atividades" }));

    expect(
      screen.getByText("Análise por inteligência artificial")
    ).toBeTruthy();
    expect(screen.getAllByText("Atenção").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Administração/).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toContain("ai.inference_call");
    expect(document.body.textContent).not.toContain("warning");
    expect(screen.queryByText("Ver detalhes técnicos")).toBeNull();

    await user.click(screen.getByRole("tab", { name: "Base de alimentos" }));
    expect(screen.getByText("Base inicial do Brasil")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Carregar base inicial" })
    ).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\bseed\b/i);
    expect(document.body.textContent).not.toMatch(/\bjob\b/i);
    expect(document.body.textContent).not.toMatch(/\baliases\b/i);
  });

  it("apresenta as cinco áreas administrativas no mesmo nível", async () => {
    const { default: AdminPage } = await import("./AdminPage");
    render(React.createElement(AdminPage));

    expect(screen.getAllByRole("tab")).toHaveLength(5);
    expect(screen.getByRole("tab", { name: "Visão geral" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Usuários" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Atividades" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Base de alimentos" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Configurações" })).toBeTruthy();
  });

  it("combina filtros de atividades, pagina e reinicia a página ao trocar filtros", async () => {
    const { default: AdminPage } = await import("./AdminPage");
    const user = userEvent.setup();
    render(React.createElement(AdminPage));

    await user.click(screen.getByRole("tab", { name: "Atividades" }));
    await user.click(screen.getByRole("button", { name: /Próxima/ }));
    expect(activityQueryInputMock.mock.lastCall?.[0]).toMatchObject({
      page: 2,
    });

    await user.type(screen.getByLabelText("Buscar atividade"), "whatsapp");
    await user.selectOptions(screen.getByLabelText("Status"), "warning");
    await user.selectOptions(screen.getByLabelText("Origem"), "whatsapp");
    await user.selectOptions(
      screen.getByLabelText("Tipo de evento"),
      "whatsapp"
    );

    expect(activityQueryInputMock.mock.lastCall?.[0]).toMatchObject({
      search: "whatsapp",
      status: "warning",
      origin: "whatsapp",
      eventTypeCategory: "whatsapp",
      page: 1,
    });
    await user.click(screen.getByRole("button", { name: /Limpar filtros/ }));
    expect(
      (screen.getByLabelText("Buscar atividade") as HTMLInputElement).value
    ).toBe("");
  });

  it("limpa o valor digitado ao cancelar e reabrir a substituição da credencial", async () => {
    const { default: AdminPage } = await import("./AdminPage");
    const user = userEvent.setup();
    const typedToken = "EAA_token_que_nao_deve_reaparecer_123456789";
    render(React.createElement(AdminPage));

    await user.click(screen.getByRole("tab", { name: "Configurações" }));
    await user.click(
      screen.getByRole("button", { name: "Substituir credencial" })
    );
    await user.type(
      screen.getByLabelText("Nova chave de acesso do WhatsApp"),
      typedToken
    );
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    await user.click(
      screen.getByRole("button", { name: "Substituir credencial" })
    );

    expect(
      (
        screen.getByLabelText(
          "Nova chave de acesso do WhatsApp"
        ) as HTMLInputElement
      ).value
    ).toBe("");
    expect(document.body.textContent).not.toContain(typedToken);
  });

  it("combina busca, perfil e último acesso sobre a coleção completa de usuários", async () => {
    const { default: AdminPage } = await import("./AdminPage");
    const user = userEvent.setup();
    render(React.createElement(AdminPage));

    await user.click(screen.getByRole("tab", { name: "Usuários" }));
    await user.type(
      screen.getByLabelText("Buscar por nome ou e-mail"),
      "maria"
    );
    await user.selectOptions(screen.getByLabelText("Perfil"), "professional");
    await user.selectOptions(screen.getByLabelText("Último acesso"), "today");

    expect(screen.getByText("1 usuários encontrados")).toBeTruthy();
    expect(screen.getByText("Maria Profissional")).toBeTruthy();
    expect(screen.queryByText("Usuário Antigo")).toBeNull();
  });
});
