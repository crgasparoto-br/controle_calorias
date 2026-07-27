// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let location = "/professional/patients/41/assessment";
let mounts = 0;

vi.mock("wouter", () => ({
  useLocation: () => [location, vi.fn()],
}));

vi.mock("@/components/ProfessionalLayout", () => ({
  useProfessionalWorkspace: () => ({
    selectedPatient: {
      patientId: Number(location.split("/")[3]),
      displayName: "Paciente autorizado",
    },
  }),
}));

vi.mock("@/components/professional/ProfessionalUi", () => ({
  ProfessionalAsyncState: ({ title }: { title: string }) => <div>{title}</div>,
}));

vi.mock("./professional/ProfessionalPatientWorkspace", () => ({
  default: () => {
    const [mountId] = React.useState(() => ++mounts);
    const [page, setPage] = React.useState(1);
    return (
      <div>
        <span>{`workspace-${mountId}-page-${page}`}</span>
        <button type="button" onClick={() => setPage(2)}>
          Ir para página 2
        </button>
      </div>
    );
  },
}));

beforeEach(() => {
  location = "/professional/patients/41/assessment";
  mounts = 0;
});

afterEach(cleanup);

describe("ProfessionalPatientRouteGuard draft lifecycle", () => {
  it("keeps the patient workspace and collection state across internal sections", async () => {
    const user = userEvent.setup();
    const { default: ProfessionalPatientRouteGuard } = await import(
      "./professional/ProfessionalPatientRouteGuard"
    );
    const view = render(<ProfessionalPatientRouteGuard />);

    expect(screen.getByText("workspace-1-page-1")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Ir para página 2" }));
    expect(screen.getByText("workspace-1-page-2")).toBeTruthy();

    location = "/professional/patients/41/notes";
    view.rerender(<ProfessionalPatientRouteGuard />);

    expect(screen.getByText("workspace-1-page-2")).toBeTruthy();
    expect(screen.queryByText("workspace-2-page-1")).toBeNull();
  });

  it("remounts when changing patients so drafts cannot cross patient boundaries", async () => {
    const { default: ProfessionalPatientRouteGuard } = await import(
      "./professional/ProfessionalPatientRouteGuard"
    );
    const view = render(<ProfessionalPatientRouteGuard />);

    expect(screen.getByText("workspace-1-page-1")).toBeTruthy();

    location = "/professional/patients/72/assessment";
    view.rerender(<ProfessionalPatientRouteGuard />);

    expect(screen.queryByText("workspace-1-page-1")).toBeNull();
    expect(screen.getByText("workspace-2-page-1")).toBeTruthy();
  });
});
