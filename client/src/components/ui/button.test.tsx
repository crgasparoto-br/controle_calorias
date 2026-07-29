import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "./button";
import { TooltipProvider } from "./tooltip";

function renderTrackingButtons() {
  render(
    <TooltipProvider delayDuration={0}>
      <Button variant="outline">Pausar</Button>
      <Button variant="destructive">Encerrar</Button>
    </TooltipProvider>
  );
}

describe("Button tracking action tooltips", () => {
  it("explains what pausing and ending the follow-up cycle do", () => {
    renderTrackingButtons();

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

  it("does not add a cycle tooltip to unrelated buttons", () => {
    render(
      <TooltipProvider delayDuration={0}>
        <Button variant="outline">Voltar</Button>
      </TooltipProvider>
    );

    expect(
      screen.getByRole("button", { name: "Voltar" }).getAttribute("title")
    ).toBeNull();
  });
});
