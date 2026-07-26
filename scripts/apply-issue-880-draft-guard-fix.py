from pathlib import Path

workspace = Path("client/src/pages/professional/ProfessionalPatientWorkspace.tsx")
source = workspace.read_text(encoding="utf-8")

hook_old = "function useUnsavedNavigationGuard(dirty: boolean, currentPath: string) {"
hook_new = "export function useUnsavedNavigationGuard(dirty: boolean, currentPath: string) {"
if source.count(hook_old) != 1:
    raise SystemExit("expected one unsaved navigation hook declaration")
source = source.replace(hook_old, hook_new, 1)

selector_old = (
    "[data-professional-navigation], nav[aria-label='Navegação da Área Profissional'] "
    "button, button[aria-label='Ir para o início da Área Profissional']"
)
selector_new = (
    "[data-professional-navigation], nav[aria-label='Navegação da Área Profissional'] "
    "button, [data-sidebar='footer'] button, "
    "button[aria-label='Ir para o início da Área Profissional']"
)
if source.count(selector_old) != 1:
    raise SystemExit("expected one professional navigation selector")
source = source.replace(selector_old, selector_new, 1)

can_navigate_old = """    canNavigate() {
      if (!dirty || window.confirm(UNSAVED_MESSAGE)) {
        allowNavigationRef.current = true;
        return true;
      }
      return false;
    },"""
can_navigate_new = """    canNavigate() {
      if (allowNavigationRef.current || !dirty) {
        allowNavigationRef.current = true;
        return true;
      }
      if (window.confirm(UNSAVED_MESSAGE)) {
        allowNavigationRef.current = true;
        return true;
      }
      return false;
    },"""
if source.count(can_navigate_old) != 1:
    raise SystemExit("expected one current canNavigate implementation")
workspace.write_text(source.replace(can_navigate_old, can_navigate_new, 1), encoding="utf-8")

test = Path("client/src/pages/ProfessionalPatientWorkspace.unsavedNavigation.test.tsx")
test.write_text(
    r'''// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useUnsavedNavigationGuard } from "./professional/ProfessionalPatientWorkspace";

function NavigationHarness({
  direct = false,
  dirty = true,
  footer = false,
  onNavigate,
}: {
  direct?: boolean;
  dirty?: boolean;
  footer?: boolean;
  onNavigate: () => void;
}) {
  const guard = useUnsavedNavigationGuard(
    dirty,
    "/professional/patients/41/assessment"
  );
  const button = (
    <button
      type="button"
      data-professional-navigation={footer ? undefined : true}
      onClick={() => {
        if (direct || guard.canNavigate()) onNavigate();
      }}
    >
      Navegar
    </button>
  );
  return footer ? <div data-sidebar="footer">{button}</div> : button;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("professional workspace unsaved navigation", () => {
  it("uses exactly one confirmation when discard is accepted", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const onNavigate = vi.fn();
    render(<NavigationHarness onNavigate={onNavigate} />);

    await userEvent.click(screen.getByRole("button", { name: "Navegar" }));

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it("preserves the draft when navigation is cancelled", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const onNavigate = vi.fn();
    render(<NavigationHarness onNavigate={onNavigate} />);

    await userEvent.click(screen.getByRole("button", { name: "Navegar" }));

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("protects the direct Minha alimentação footer exit", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const onNavigate = vi.fn();
    render(<NavigationHarness direct footer onNavigate={onNavigate} />);

    await userEvent.click(screen.getByRole("button", { name: "Navegar" }));

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("allows the direct footer exit after discard is confirmed", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const onNavigate = vi.fn();
    render(<NavigationHarness direct footer onNavigate={onNavigate} />);

    await userEvent.click(screen.getByRole("button", { name: "Navegar" }));

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it("does not ask for confirmation after the draft is clean", async () => {
    const confirm = vi.spyOn(window, "confirm");
    const onNavigate = vi.fn();
    render(<NavigationHarness dirty={false} onNavigate={onNavigate} />);

    await userEvent.click(screen.getByRole("button", { name: "Navegar" }));

    expect(confirm).not.toHaveBeenCalled();
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });
});
''',
    encoding="utf-8",
)

docs = Path("docs/testing/professional-workspace-routing.md")
documentation = docs.read_text(encoding="utf-8")
section = """

## Proteção completa das saídas com rascunho — issue #880

- Toda saída visível do workspace, incluindo **Minha alimentação**, subnavegação, navegação principal, retorno à carteira e troca de paciente, participa do mesmo contrato de proteção de rascunho.
- A confirmação ocorre no máximo uma vez por tentativa de navegação. Uma confirmação já aceita pelo interceptor é reutilizada pelo handler da mesma transição.
- Cancelar preserva rota, paciente e campos montados; confirmar o descarte permite a navegação e o remount da rota de destino; após salvar, não há diálogo.
- O teste comportamental clica nos controles protegidos, verifica o número de chamadas a `window.confirm` e comprova que a navegação foi executada ou bloqueada conforme a decisão.
"""
if "## Proteção completa das saídas com rascunho — issue #880" not in documentation:
    docs.write_text(documentation.rstrip() + section, encoding="utf-8")
