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
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("./professional/ProfessionalPatientRouteGuard", () => ({
  default: () => {
    const [mountId] = React.useState(() => ++mounts);
    return <div>workspace-{mountId}</div>;
  },
}));

vi.mock("./professional/ProfessionalHome", () => ({
  default: () => <div>home</div>,
}));
vi.mock("./professional/ProfessionalPatients", () => ({
  default: () => <div>patients</div>,
}));
vi.mock("@/components/ProfessionalMessagesPanel", () => ({
  default: () => <div>messages</div>,
}));
vi.mock("@/components/ProfessionalReportsWorkspace", () => ({
  default: () => <div>reports</div>,
}));
vi.mock("@/components/professional/ProfessionalUi", () => ({
  ProfessionalPage: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

beforeEach(() => {
  location = "/professional/patients/41/assessment";
  mounts = 0;
});

afterEach(cleanup);

describe("ProfessionalAreaPage draft lifecycle", () => {
  it("remounts the patient workspace after confirmed internal navigation", async () => {
    const { default: ProfessionalAreaPage } = await import("./ProfessionalAreaPage");
    const view = render(<ProfessionalAreaPage />);

    expect(screen.getByText("workspace-1")).toBeTruthy();

    location = "/professional/patients/41/notes";
    view.rerender(<ProfessionalAreaPage />);

    expect(screen.queryByText("workspace-1")).toBeNull();
    expect(screen.getByText("workspace-2")).toBeTruthy();
  });

  it("remounts when changing patients so drafts cannot cross patient boundaries", async () => {
    const { default: ProfessionalAreaPage } = await import("./ProfessionalAreaPage");
    const view = render(<ProfessionalAreaPage />);

    expect(screen.getByText("workspace-1")).toBeTruthy();

    location = "/professional/patients/72/assessment";
    view.rerender(<ProfessionalAreaPage />);

    expect(screen.queryByText("workspace-1")).toBeNull();
    expect(screen.getByText("workspace-2")).toBeTruthy();
  });
});
