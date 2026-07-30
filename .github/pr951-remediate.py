from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str) -> None:
    file_path = Path(path)
    text = file_path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one anchor, found {count}")
    file_path.write_text(text.replace(old, new, 1), encoding="utf-8")


button_path = "client/src/components/ui/button.tsx"
replace_once(
    button_path,
    "  title,\n  children,\n  ...props\n",
    "  children,\n  ...props\n",
    "button title destructuring",
)
replace_once(
    button_path,
    '''\n  const trackingActionTooltip =\n    variant === "outline" && childText === "Pausar"\n      ? "Suspende temporariamente o acompanhamento. O histórico continua disponível, mas novas intervenções ficam bloqueadas até a retomada."\n      : variant === "destructive" && childText === "Encerrar"\n        ? "Finaliza o acompanhamento. Após o encerramento, somente as mensagens anteriores e o histórico permanecem disponíveis para consulta."\n        : undefined;\n''',
    "",
    "global tracking tooltip inference",
)
replace_once(
    button_path,
    "      title={title ?? trackingActionTooltip}\n      {...props}\n",
    "      {...props}\n",
    "global inferred title",
)

Path("client/src/components/ui/button.test.tsx").write_text(
    '''// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Button } from "./button";

afterEach(cleanup);

describe("Button title contract", () => {
  it("does not infer follow-up semantics from generic button labels", () => {
    render(
      <>
        <Button variant="outline">Pausar</Button>
        <Button variant="destructive">Encerrar</Button>
      </>
    );

    expect(
      screen.getByRole("button", { name: "Pausar" }).getAttribute("title")
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Encerrar" }).getAttribute("title")
    ).toBeNull();
  });

  it("preserves an explicitly provided title", () => {
    render(
      <Button variant="outline" title="Título específico">
        Pausar
      </Button>
    );

    expect(
      screen.getByRole("button", { name: "Pausar" }).getAttribute("title")
    ).toBe("Título específico");
  });
});
''',
    encoding="utf-8",
)

workspace_path = "client/src/pages/professional/ProfessionalPatientWorkspace.tsx"
replace_once(
    workspace_path,
    '''function historyEventLabel(item: { label?: string | null }) {
  return item.label?.trim() || "Evento profissional registrado";
}
''',
    '''function historyEventLabel(item: { label?: string | null }) {
  return item.label?.trim() || "Evento profissional registrado";
}

const PAUSE_TRACKING_TITLE =
  "Suspende temporariamente o acompanhamento. O histórico continua disponível, mas novas intervenções ficam bloqueadas até a retomada.";
const END_TRACKING_TITLE =
  "Finaliza o acompanhamento. Após o encerramento, somente as mensagens anteriores e o histórico permanecem disponíveis para consulta.";
''',
    "workspace tracking title constants",
)
replace_once(
    workspace_path,
    '''                  <Button
                    variant="outline"
                    disabled={transitionTracking.isPending}
                    onClick={() => transition("paused")}
''',
    '''                  <Button
                    variant="outline"
                    title={PAUSE_TRACKING_TITLE}
                    disabled={transitionTracking.isPending}
                    onClick={() => transition("paused")}
''',
    "workspace pause button",
)

workspace = Path(workspace_path)
workspace_text = workspace.read_text(encoding="utf-8")
end_anchor = '''                  <Button
                    variant="destructive"
                    disabled={transitionTracking.isPending}
                    onClick={() => transition("ended")}
'''
end_replacement = '''                  <Button
                    variant="destructive"
                    title={END_TRACKING_TITLE}
                    disabled={transitionTracking.isPending}
                    onClick={() => transition("ended")}
'''
end_count = workspace_text.count(end_anchor)
if end_count != 2:
    raise SystemExit(f"workspace end buttons: expected two anchors, found {end_count}")
workspace.write_text(
    workspace_text.replace(end_anchor, end_replacement), encoding="utf-8"
)

workspace_test_path = (
    "client/src/pages/professional/"
    "ProfessionalPatientWorkspace.auditCorrections.test.tsx"
)
replace_once(
    workspace_test_path,
    '''  it("redirects immediately to history and refreshes canonical context when tracking ends", async () => {
''',
    '''  it("explains pause and end consequences on the follow-up cycle controls", () => {
    location = "/professional/patients/41";
    recordData = recordFixture();
    render(<ProfessionalPatientWorkspace />);

    expect(
      screen.getByRole("button", { name: "Pausar" }).getAttribute("title")
    ).toBe(
      "Suspende temporariamente o acompanhamento. O histórico continua disponível, mas novas intervenções ficam bloqueadas até a retomada."
    );
    expect(
      screen.getByRole("button", { name: "Encerrar" }).getAttribute("title")
    ).toBe(
      "Finaliza o acompanhamento. Após o encerramento, somente as mensagens anteriores e o histórico permanecem disponíveis para consulta."
    );
  });

  it("redirects immediately to history and refreshes canonical context when tracking ends", async () => {
''',
    "workspace tracking tooltip test",
)
