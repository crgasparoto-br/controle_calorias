// @vitest-environment jsdom
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
