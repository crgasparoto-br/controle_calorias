// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SettingsPageRouter from "./SettingsPageRouter";

vi.mock("./OnboardingPage", () => ({
  default: () => <main>Configurações pessoais integradas</main>,
}));

describe("SettingsPageRouter", () => {
  afterEach(cleanup);

  it("usa a superfície canônica de Configurações para todos os deep links", () => {
    render(<SettingsPageRouter />);

    expect(screen.getByText("Configurações pessoais integradas")).toBeTruthy();
  });
});
