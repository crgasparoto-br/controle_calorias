from pathlib import Path

BRANCH = "feat/875-professional-context-routes"

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

visual_workflow = Path(".github/workflows/professional-home-visual.yml")
visual_workflow.write_text(
    '''name: Professional workspace visual evidence

on:
  pull_request:
    branches:
      - develop
    paths:
      - "client/src/pages/ProfessionalAreaPage.tsx"
      - "client/src/pages/professional/ProfessionalHome.tsx"
      - "client/src/pages/professional/ProfessionalPatients.tsx"
      - "client/src/pages/professional/ProfessionalPatientWorkspace.tsx"
      - "client/src/components/ProfessionalLayout.tsx"
      - "client/src/components/professional/ProfessionalUi.tsx"
      - "client/src/components/ui/sidebar.tsx"
      - "client/src/lib/professionalRoutes.ts"
      - "client/src/index.css"
      - "visual-tests/professional-home/**"
      - "visual-tests/professional-patient-workspace/**"
      - "scripts/render-professional-home-visual.sh"
      - "scripts/render-professional-patient-workspace-visual.sh"
      - ".github/workflows/professional-home-visual.yml"

permissions:
  contents: read

jobs:
  visual-evidence:
    runs-on: ubuntu-latest
    env:
      NODE_OPTIONS: --max-old-space-size=4096
      GITHUB_HEAD_SHA: ${{ github.event.pull_request.head.sha }}
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
      - name: Setup pnpm
        uses: pnpm/action-setup@v4
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: pnpm
      - name: Install dependencies
        run: pnpm install --frozen-lockfile
      - name: Render professional aggregate evidence
        run: bash scripts/render-professional-home-visual.sh
      - name: Render professional patient workspace evidence
        run: bash scripts/render-professional-patient-workspace-visual.sh
      - name: Upload professional workspace screenshots
        uses: actions/upload-artifact@v4
        with:
          name: professional-workspace-visual-${{ github.event.pull_request.head.sha }}
          path: |
            artifacts/professional-home
            artifacts/professional-patient-workspace
          if-no-files-found: error
          retention-days: 30
''',
    encoding="utf-8",
)

for temporary in (
    Path(".github/workflows/patch-issue-880-single-confirmation.yml"),
    Path(".github/workflows/patch-issue-880-audit-findings.yml"),
):
    if temporary.exists():
        temporary.unlink()

Path(__file__).unlink()
