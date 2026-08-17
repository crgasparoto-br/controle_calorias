// @vitest-environment jsdom
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
