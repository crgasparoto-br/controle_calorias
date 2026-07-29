// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SettingsPageRouter from "./SettingsPageRouter";

const state = vi.hoisted(() => ({
  search: "",
  active: false,
}));
const setLocationMock = vi.hoisted(() => vi.fn());

vi.mock("wouter", () => ({
  useLocation: () => ["/settings", setLocationMock] as const,
  useSearch: () => state.search,
}));

vi.mock("@/components/DashboardLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/PageIntro", () => ({
  default: ({
    title,
    actions,
  }: {
    title: string;
    actions?: React.ReactNode;
  }) => (
    <header>
      <h1>{title}</h1>
      {actions}
    </header>
  ),
}));

vi.mock("@/components/ProfessionalProfileSettings", () => ({
  default: () => <section>Formulário de ativação profissional</section>,
  PatientAccessRequestsCard: () => <section>Solicitações recebidas</section>,
}));

vi.mock("./OnboardingPage", () => ({
  default: () => <h1>Configurações gerais</h1>,
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    nutrition: {
      professionals: {
        profile: {
          useQuery: () => ({
            data: { active: state.active },
            isLoading: false,
            isError: false,
          }),
        },
      },
    },
  },
}));

describe("SettingsPageRouter", () => {
  beforeEach(() => {
    state.search = "";
    state.active = false;
    setLocationMock.mockReset();
  });

  afterEach(cleanup);

  it("abre e restaura a aba profissional pelo search param real", () => {
    state.search = "tab=profissional";

    const firstRender = render(<SettingsPageRouter />);

    expect(
      screen.getByRole("heading", { name: "Perfil profissional" })
    ).toBeTruthy();
    expect(screen.getByText("Formulário de ativação profissional")).toBeTruthy();
    expect(
      screen.queryByRole("heading", { name: "Configurações gerais" })
    ).toBeNull();

    firstRender.unmount();
    render(<SettingsPageRouter />);

    expect(
      screen.getByRole("heading", { name: "Perfil profissional" })
    ).toBeTruthy();
  });

  it("não oferece o formulário de ativação para um perfil já ativo", () => {
    state.search = "tab=profissional";
    state.active = true;

    render(<SettingsPageRouter />);

    expect(screen.getByText("Área Profissional ativa")).toBeTruthy();
    expect(
      screen.queryByText("Formulário de ativação profissional")
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Abrir configurações profissionais" })
    ).toBeTruthy();
  });

  it("não confunde parâmetros vizinhos com a aba profissional", () => {
    state.search = "tab=perfil&next=profissional";

    render(<SettingsPageRouter />);

    expect(
      screen.getByRole("heading", { name: "Configurações gerais" })
    ).toBeTruthy();
    expect(
      screen.queryByRole("heading", { name: "Perfil profissional" })
    ).toBeNull();
  });
});

