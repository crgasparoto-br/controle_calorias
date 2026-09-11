// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AIChatBox } from "./AIChatBox";

afterEach(() => cleanup());

describe("AIChatBox accessibility", () => {
  it("nomeia o botão de envio no estado normal", () => {
    render(<AIChatBox messages={[]} onSendMessage={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Enviar mensagem" })).toBeTruthy();
  });

  it("reflete o estado de carregamento no nome acessível", () => {
    render(<AIChatBox messages={[]} onSendMessage={vi.fn()} isLoading />);

    const button = screen.getByRole("button", { name: "Enviando mensagem" });
    expect(button).toBeTruthy();
    expect(button.hasAttribute("disabled")).toBe(true);
  });
});
