// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let route = "/professional/patients/41";
const setLocation = vi.fn();
let selectedPatient: {
  patientId: number;
  displayName: string;
  trackingStatus: "active" | "ended";
} | null = {
  patientId: 41,
  displayName: "Ana",
  trackingStatus: "active",
};

vi.mock("@/components/ProfessionalLayout", () => ({
  useProfessionalWorkspace: () => ({ selectedPatient, clearPatient: vi.fn() }),
}));
vi.mock("wouter", () => ({ useLocation: () => [route, setLocation] }));
vi.mock("./ProfessionalPatientWorkspace", () => ({
  default: () => <div>Workspace contextual do paciente</div>,
}));

beforeEach(() => {
  route = "/professional/patients/41";
  setLocation.mockReset();
  selectedPatient = {
    patientId: 41,
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
    expect(screen.getByText("Workspace contextual do paciente")).toBeTruthy();
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
    expect(screen.queryByText("Workspace contextual do paciente")).toBeNull();
    await waitFor(() =>
      expect(setLocation).toHaveBeenCalledWith(
        "/professional/patients/41/history"
      )
    );
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

    expect(screen.getByText("Workspace contextual do paciente")).toBeTruthy();
    expect(setLocation).not.toHaveBeenCalled();
  });

  it("keeps protected content hidden without a validated patient context", async () => {
    selectedPatient = null;
    const { default: Guard } = await import("./ProfessionalPatientRouteGuard");
    render(<Guard />);
    expect(screen.getByText("Selecione um paciente")).toBeTruthy();
    expect(screen.queryByText("Workspace contextual do paciente")).toBeNull();
  });
});
