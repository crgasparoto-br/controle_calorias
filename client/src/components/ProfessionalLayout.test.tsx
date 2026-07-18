// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProfessionalLayout from "./ProfessionalLayout";

const setLocation = vi.fn();
const refresh = vi.fn().mockResolvedValue(undefined);
let authState: {
  loading: boolean;
  user: null | { professionalProfileActive?: boolean };
};

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ ...authState, refresh }),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/professional", setLocation],
}));

vi.mock("@/hooks/useMobile", () => ({ useIsMobile: () => false }));

afterEach(cleanup);

beforeEach(() => {
  setLocation.mockReset();
  refresh.mockClear();
  authState = { loading: false, user: { professionalProfileActive: true } };
});

describe("ProfessionalLayout", () => {
  it("blocks users without an active professional profile", () => {
    authState = { loading: false, user: { professionalProfileActive: false } };
    render(<ProfessionalLayout>conteúdo sensível</ProfessionalLayout>);

    expect(screen.getByText("Área Profissional indisponível")).toBeTruthy();
    expect(screen.queryByText("conteúdo sensível")).toBeNull();
  });

  it("removes visible professional data when access is lost", () => {
    const { rerender } = render(
      <ProfessionalLayout>conteúdo sensível</ProfessionalLayout>
    );
    expect(screen.getByText("conteúdo sensível")).toBeTruthy();

    authState = { loading: false, user: { professionalProfileActive: false } };
    rerender(<ProfessionalLayout>conteúdo sensível</ProfessionalLayout>);

    expect(screen.queryByText("conteúdo sensível")).toBeNull();
    expect(screen.getByText("Área Profissional indisponível")).toBeTruthy();
  });

  it("revalidates access when the window regains focus", () => {
    render(<ProfessionalLayout>conteúdo profissional</ProfessionalLayout>);
    window.dispatchEvent(new Event("focus"));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("renders a separate professional navigation for active profiles", () => {
    render(<ProfessionalLayout>conteúdo profissional</ProfessionalLayout>);

    expect(screen.getByText("Área Profissional")).toBeTruthy();
    expect(screen.getByText("Pacientes")).toBeTruthy();
    expect(screen.getByText("Nenhum paciente selecionado")).toBeTruthy();
    expect(screen.getByText("conteúdo profissional")).toBeTruthy();
  });

  it("returns to the personal experience without a new session", async () => {
    render(<ProfessionalLayout>conteúdo profissional</ProfessionalLayout>);

    await userEvent.click(
      screen.getByRole("button", { name: "Minha alimentação" })
    );
    expect(setLocation).toHaveBeenCalledWith("/today");
  });

  it("keeps the legacy experience reachable during migration", async () => {
    render(<ProfessionalLayout>conteúdo profissional</ProfessionalLayout>);

    await userEvent.click(
      screen.getByRole("button", { name: "Experiência legada" })
    );
    expect(setLocation).toHaveBeenCalledWith("/professional/legacy");
  });
});
