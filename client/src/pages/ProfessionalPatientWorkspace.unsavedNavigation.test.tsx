// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useUnsavedNavigationGuard } from "./professional/ProfessionalPatientWorkspace";

function SaveThenEditHarness({ onNavigate }: { onNavigate: () => void }) {
  const [dirty, setDirty] = React.useState(true);
  const guard = useUnsavedNavigationGuard(
    dirty,
    "/professional/patients/41/assessment"
  );
  return (
    <>
      <button
        type="button"
        onClick={() => {
          guard.markSaved();
          setDirty(false);
        }}
      >
        Salvar
      </button>
      <button type="button" onClick={() => setDirty(true)}>
        Editar novamente
      </button>
      <button
        type="button"
        data-professional-navigation
        onClick={() => {
          if (guard.canNavigate()) onNavigate();
        }}
      >
        Navegar após nova edição
      </button>
    </>
  );
}

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

  it("protects a new draft created after a successful save", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const onNavigate = vi.fn();
    render(<SaveThenEditHarness onNavigate={onNavigate} />);

    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Editar novamente" })
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Navegar após nova edição" })
    );

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(onNavigate).not.toHaveBeenCalled();
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
