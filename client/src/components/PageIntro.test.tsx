// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import PageIntro from "./PageIntro";

afterEach(cleanup);

describe("PageIntro", () => {
  it("uses its own container width before placing actions beside the title", () => {
    render(
      <PageIntro
        title="Título principal"
        actions={<button type="button">Ação</button>}
      />
    );

    const heading = screen.getByRole("heading", { name: "Título principal" });
    const section = heading.closest("section");
    const layout = section?.querySelector(":scope > div");

    expect(section?.classList.contains("@container/page-intro")).toBe(true);
    expect(layout?.classList.contains("@5xl/page-intro:flex-row")).toBe(true);
    expect(layout?.classList.contains("xl:flex-row")).toBe(false);
  });

  it("allows long headings to wrap inside constrained layouts", () => {
    render(
      <PageIntro
        title="Diagnóstico nutricional do período"
        actions={<button type="button">Selecionar período</button>}
      />
    );

    const heading = screen.getByRole("heading", {
      name: "Diagnóstico nutricional do período",
    });

    expect(heading.classList.contains("break-words")).toBe(true);
    expect(heading.parentElement?.parentElement?.classList.contains("min-w-0")).toBe(
      true
    );
    expect(
      screen.getByRole("button", { name: "Selecionar período" })
    ).toBeTruthy();
  });
});
