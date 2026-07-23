// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let route = "/professional/patients/41";
let selectedPatient:
  | {
      patientId: number;
      displayName: string;
      trackingStatus: "active";
    }
  | null = {
  patientId: 41,
  displayName: "Ana",
  trackingStatus: "active",
};

vi.mock("@/components/ProfessionalLayout", () => ({
  useProfessionalWorkspace: () => ({
    selectedPatient,
    clearPatient: vi.fn(),
  }),
}));
vi.mock("wouter", () => ({
  useLocation: () => [route, vi.fn()],
}));
vi.mock("@/components/ProfessionalReportsWorkspace", () => ({
  default: () => <div>Relatório individual</div>,
}));
vi.mock("@/components/ProfessionalMessagesPanel", () => ({
  default: () => <div>Mensagens individuais</div>,
}));
vi.mock("./ProfessionalPatientWorkspace", () => ({
  default: () => <div>Workspace de prontuário</div>,
}));

beforeEach(() => {
  route = "/professional/patients/41";
  selectedPatient = {
    patientId: 41,
    displayName: "Ana",
    trackingStatus: "active",
  };
});

afterEach(cleanup);

describe("ProfessionalPatientRouteGuard", () => {
  it("renders record sections through the professional record workspace", async () => {
    route = "/professional/patients/41/goals";
    const { default: Guard } = await import("./ProfessionalPatientRouteGuard");
    render(<Guard />);

    expect(screen.getByText("Workspace de prontuário")).toBeTruthy();
    expect(screen.queryByText("Relatório individual")).toBeNull();
    expect(screen.queryByText("Mensagens individuais")).toBeNull();
  });

  it("renders reports without loading the professional record workspace", async () => {
    route = "/professional/patients/41/reports";
    const { default: Guard } = await import("./ProfessionalPatientRouteGuard");
    render(<Guard />);

    expect(screen.getByText("Relatório individual")).toBeTruthy();
    expect(screen.queryByText("Workspace de prontuário")).toBeNull();
  });

  it("renders messages without loading the professional record workspace", async () => {
    route = "/professional/patients/41/messages";
    const { default: Guard } = await import("./ProfessionalPatientRouteGuard");
    render(<Guard />);

    expect(screen.getByText("Mensagens individuais")).toBeTruthy();
    expect(screen.queryByText("Workspace de prontuário")).toBeNull();
  });

  it("keeps protected content hidden without a validated patient context", async () => {
    selectedPatient = null;
    const { default: Guard } = await import("./ProfessionalPatientRouteGuard");
    render(<Guard />);

    expect(screen.getByText("Selecione um paciente")).toBeTruthy();
    expect(screen.queryByText("Workspace de prontuário")).toBeNull();
  });
});
