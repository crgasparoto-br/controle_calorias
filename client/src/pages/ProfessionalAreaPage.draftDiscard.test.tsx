// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
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
    return <div>workspace-{mountId}</div>;
  },
}));

beforeEach(() => {
  location = "/professional/patients/41/assessment";
  mounts = 0;
});

afterEach(cleanup);

describe("ProfessionalPatientRouteGuard draft lifecycle", () => {
  it("remounts only the patient form after confirmed internal navigation", async () => {
    const { default: ProfessionalPatientRouteGuard } = await import(
      "./professional/ProfessionalPatientRouteGuard"
    );
    const view = render(<ProfessionalPatientRouteGuard />);

    expect(screen.getByText("workspace-1")).toBeTruthy();

    location = "/professional/patients/41/notes";
    view.rerender(<ProfessionalPatientRouteGuard />);

    expect(screen.queryByText("workspace-1")).toBeNull();
    expect(screen.getByText("workspace-2")).toBeTruthy();
  });

  it("remounts when changing patients so drafts cannot cross patient boundaries", async () => {
    const { default: ProfessionalPatientRouteGuard } = await import(
      "./professional/ProfessionalPatientRouteGuard"
    );
    const view = render(<ProfessionalPatientRouteGuard />);

    expect(screen.getByText("workspace-1")).toBeTruthy();

    location = "/professional/patients/72/assessment";
    view.rerender(<ProfessionalPatientRouteGuard />);

    expect(screen.queryByText("workspace-1")).toBeNull();
    expect(screen.getByText("workspace-2")).toBeTruthy();
  });
});
