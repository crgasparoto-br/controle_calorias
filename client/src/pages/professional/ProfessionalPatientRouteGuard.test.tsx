// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const setLocation = vi.fn();
let trackingStatus = "active";
let route = "/professional/patients/41/reports";

vi.mock("@/components/ProfessionalLayout", () => ({
  useProfessionalWorkspace: () => ({
    selectedPatient: { patientId: 41, displayName: "Ana" },
    clearPatient: vi.fn(),
  }),
}));
vi.mock("wouter", () => ({
  useLocation: () => [route, setLocation],
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    professionalRecord: {
      get: {
        useQuery: () => ({
          data: { patient: { trackingStatus } },
          isLoading: false,
          isError: false,
          refetch: vi.fn(),
        }),
      },
    },
  },
}));
vi.mock("./ProfessionalPatientWorkspace", () => ({
  default: () => <div>Workspace editável</div>,
}));

afterEach(cleanup);

beforeEach(() => {
  setLocation.mockReset();
  trackingStatus = "active";
  route = "/professional/patients/41/reports";
});

describe("ProfessionalPatientRouteGuard", () => {
  it("redirects ended follow-ups to the audit history", async () => {
    trackingStatus = "ended";
    const { default: Guard } = await import("./ProfessionalPatientRouteGuard");
    render(<Guard />);

    await waitFor(() =>
      expect(setLocation).toHaveBeenCalledWith(
        "/professional/patients/41/history"
      )
    );
    expect(screen.queryByText("Workspace editável")).toBeNull();
    expect(
      screen.getByText("Abrindo o histórico do acompanhamento encerrado...")
    ).toBeTruthy();
  });

  it("keeps active follow-ups in the requested patient route", async () => {
    const { default: Guard } = await import("./ProfessionalPatientRouteGuard");
    render(<Guard />);

    expect(screen.getByText("Workspace editável")).toBeTruthy();
    expect(setLocation).not.toHaveBeenCalled();
  });
});
