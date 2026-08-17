// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { setLocationMock } = vi.hoisted(() => ({ setLocationMock: vi.fn() }));

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({
    loading: false,
    user: { id: 1, name: "Gaspa", role: "user" },
    logout: vi.fn(),
  }),
}));

vi.mock("@/hooks/useMobile", () => ({ useIsMobile: () => false }));
vi.mock("wouter", () => ({ useLocation: () => ["/goals", setLocationMock] }));

describe("DashboardLayout navigation from Goals", () => {
  beforeEach(() => setLocationMock.mockClear());

  it.each([
    ["Hoje", "/today"],
    ["Registrar", "/registrar"],
    ["Registros", "/meals"],
    ["Relatórios", "/reports"],
  ])(
    "navega para %s uma única vez sem recarregar a página",
    async (label, path) => {
      const { default: DashboardLayout } = await import("./DashboardLayout");
      render(
        <DashboardLayout>
          <div>Tela de metas</div>
        </DashboardLayout>
      );

      const menuLabel = screen
        .getAllByText(label)
        .find(element => element.closest("[data-sidebar='menu-button']"));
      expect(menuLabel).toBeDefined();
      fireEvent.click(menuLabel!.closest("button")!);

      expect(setLocationMock).toHaveBeenCalledOnce();
      expect(setLocationMock).toHaveBeenCalledWith(path);
    }
  );
});
