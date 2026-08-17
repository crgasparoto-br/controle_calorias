// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let route = "/professional/patients/41";
let mounts = 0;
const setLocation = vi.fn();
let selectedPatient: {
  patientId: number;
  authorizationId?: string;
  displayName: string;
  trackingStatus: "active" | "ended";
} | null = {
  patientId: 41,
  authorizationId: "authorization-41",
  displayName: "Ana",
  trackingStatus: "active",
};

vi.mock("@/components/ProfessionalLayout", () => ({
  useProfessionalWorkspace: () => ({ selectedPatient, clearPatient: vi.fn() }),
}));
vi.mock("wouter", () => ({ useLocation: () => [route, setLocation] }));
vi.mock("./ProfessionalPatientWorkspace", () => ({
  default: () => {
    const [mountId] = React.useState(() => ++mounts);
    return <div>{`Workspace contextual do paciente ${mountId}`}</div>;
  },
}));

beforeEach(() => {
  route = "/professional/patients/41";
  mounts = 0;
  setLocation.mockReset();
  selectedPatient = {
    patientId: 41,
    authorizationId: "authorization-41",
    displayName: "Ana",
    trackingStatus: "active",
  };
});

afterEach(cleanup);

describe("ProfessionalPatientRouteGuard", () => {
  it.each([
    "/professional/patients/41",
    "/professional/patients/41/assessment",
    "/professional/patients/41/goals",
    "/professional/patients/41/guidance",
    "/professional/patients/41/notes",
    "/professional/patients/41/reports",
    "/professional/patients/41/messages",
    "/professional/patients/41/history",
  ])("keeps %s inside the shared patient workspace", async patientRoute => {
    route = patientRoute;
    const { default: Guard } = await import("./ProfessionalPatientRouteGuard");
    render(<Guard />);
    expect(screen.getByText("Workspace contextual do paciente 1")).toBeTruthy();
  });

  it("keeps the same workspace mounted while the section changes", async () => {
    const { default: Guard } = await import("./ProfessionalPatientRouteGuard");
    const view = render(<Guard />);

    expect(screen.getByText("Workspace contextual do paciente 1")).toBeTruthy();

    route = "/professional/patients/41/notes";
    view.rerender(<Guard />);

    expect(screen.getByText("Workspace contextual do paciente 1")).toBeTruthy();
    expect(screen.queryByText("Workspace contextual do paciente 2")).toBeNull();
  });

  it("remounts when the authorization lifecycle changes for the same patient", async () => {
    const { default: Guard } = await import("./ProfessionalPatientRouteGuard");
    const view = render(<Guard />);

    expect(screen.getByText("Workspace contextual do paciente 1")).toBeTruthy();

    selectedPatient = {
      patientId: 41,
      authorizationId: "authorization-41-renewed",
      displayName: "Ana",
      trackingStatus: "active",
    };
    view.rerender(<Guard />);

    expect(screen.queryByText("Workspace contextual do paciente 1")).toBeNull();
    expect(screen.getByText("Workspace contextual do paciente 2")).toBeTruthy();
  });

  it("redirects ended tracking to the audit history surface", async () => {
    route = "/professional/patients/41/assessment";
    selectedPatient = {
      patientId: 41,
      displayName: "Ana",
      trackingStatus: "ended",
    };
    const { default: Guard } = await import("./ProfessionalPatientRouteGuard");
    render(<Guard />);

    expect(screen.getByText("Acompanhamento encerrado")).toBeTruthy();
    expect(
      screen.queryByText("Workspace contextual do paciente 1")
    ).toBeNull();
    await waitFor(() =>
      expect(setLocation).toHaveBeenCalledWith(
        "/professional/patients/41/history"
      )
    );
  });

  it("keeps ended tracking inside the read-only messages route", async () => {
    route = "/professional/patients/41/messages";
    selectedPatient = {
      patientId: 41,
      displayName: "Ana",
      trackingStatus: "ended",
    };
    const { default: Guard } = await import("./ProfessionalPatientRouteGuard");
    render(<Guard />);

    expect(screen.getByText("Workspace contextual do paciente 1")).toBeTruthy();
    expect(setLocation).not.toHaveBeenCalled();
  });

  it("keeps ended tracking inside the audit history route", async () => {
    route = "/professional/patients/41/history";
    selectedPatient = {
      patientId: 41,
      displayName: "Ana",
      trackingStatus: "ended",
    };
    const { default: Guard } = await import("./ProfessionalPatientRouteGuard");
    render(<Guard />);

    expect(screen.getByText("Workspace contextual do paciente 1")).toBeTruthy();
    expect(setLocation).not.toHaveBeenCalled();
  });

  it("keeps protected content hidden without a validated patient context", async () => {
    selectedPatient = null;
    const { default: Guard } = await import("./ProfessionalPatientRouteGuard");
    render(<Guard />);
    expect(screen.getByText("Selecione um paciente")).toBeTruthy();
    expect(
      screen.queryByText("Workspace contextual do paciente 1")
    ).toBeNull();
  });
});
