import React from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({
    loading: false,
    user: { id: 1, name: "Gaspa", role: "user" },
    logout: vi.fn(),
  }),
}));

vi.mock("@/hooks/useMobile", () => ({
  useIsMobile: () => false,
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/synced-health-data", vi.fn()],
}));

describe("DashboardLayout integrations navigation", () => {
  it("exibe Integrações e Dados sincronizados no menu sem o rótulo antigo", async () => {
    const { default: DashboardLayout } = await import("./DashboardLayout");
    const html = renderToString(React.createElement(DashboardLayout, null, React.createElement("main", null, "conteúdo")));

    expect(html).toContain("Integrações");
    expect(html).toContain("Dados sincronizados");
    expect(html).not.toContain("Saúde externa");
  });
});
