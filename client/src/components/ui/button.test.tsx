// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Button } from "./button";

afterEach(cleanup);

function renderTrackingButtons() {
  render(
    <>
      <Button variant="outline">Pausar</Button>
      <Button variant="destructive">Encerrar</Button>
    </>
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

  it("does not add a cycle tooltip to unrelated buttons", () => {
    render(<Button variant="outline">Voltar</Button>);

    expect(
      screen.getByRole("button", { name: "Voltar" }).getAttribute("title")
    ).toBeNull();
  });
});
