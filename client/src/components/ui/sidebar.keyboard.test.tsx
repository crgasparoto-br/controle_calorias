// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  Sidebar,
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "./sidebar";

vi.mock("@/hooks/useMobile", () => ({ useIsMobile: () => false }));

describe("Sidebar keyboard interaction", () => {
  it("keeps the shell usable when toggled with the documented keyboard shortcut", () => {
    render(
      <SidebarProvider>
        <Sidebar collapsible="icon">
          <SidebarTrigger />
        </Sidebar>
        <SidebarInset>Conteúdo principal</SidebarInset>
      </SidebarProvider>
    );

    const sidebar = document.querySelector<HTMLElement>(
      '[data-slot="sidebar"][data-state]'
    );
    expect(sidebar?.getAttribute("data-state")).toBe("expanded");
    expect(
      screen.getByRole("button", { name: "Toggle Sidebar" })
    ).toBeTruthy();

    fireEvent.keyDown(window, { key: "b", ctrlKey: true });

    expect(sidebar?.getAttribute("data-state")).toBe("collapsed");
    expect(screen.getByText("Conteúdo principal")).toBeTruthy();
  });
});
