// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const patientContextFetch = vi.fn().mockResolvedValue(undefined);
const invalidate = vi.fn().mockResolvedValue(undefined);

vi.mock("@/components/professional/ProfessionalUi", () => ({
  ProfessionalPage: ({ children }: { children: React.ReactNode }) => (
    <main>{children}</main>
  ),
  ProfessionalPageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
  ProfessionalStatusBadge: ({ value }: { value: string }) => <span>{value}</span>,
  ProfessionalLoadingState: ({ label }: { label: string }) => <p>{label}</p>,
  ProfessionalAsyncState: ({ title }: { title: string }) => <p>{title}</p>,
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      professionalRecord: { context: { fetch: patientContextFetch } },
      nutrition: { professionals: { myAccesses: { invalidate } } },
    }),
    nutrition: {
      professionals: {
        portfolio: {
          useQuery: () => ({
            data: {
              items: [
                {
                  authorizationId: "approved-without-identification",
                  patientUserId: 987654321,
                  patientName: null,
                  patientEmail: null,
                  authorizationStatus: "approved",
                  trackingStatus: "not_started",
                  lastFoodActivityAt: null,
                  nextReviewAt: null,
                },
              ],
              pagination: {
                page: 1,
                pageSize: 20,
                total: 1,
                totalPages: 1,
              },
            },
            isLoading: false,
            isError: false,
            refetch: vi.fn().mockResolvedValue(undefined),
          }),
        },
        requestAccess: {
          useMutation: () => ({
            isPending: false,
            isError: false,
            error: null,
            mutate: vi.fn(),
            reset: vi.fn(),
          }),
        },
      },
    },
  },
}));

import ProfessionalPatients from "./ProfessionalPatients";

afterEach(() => cleanup());

describe("ProfessionalPatients internal identifier privacy", () => {
  it("uses a neutral fallback without exposing the patientUserId", () => {
    window.history.replaceState({}, "", "/professional/patients");

    render(<ProfessionalPatients />);

    expect(screen.getByRole("heading", { name: "Paciente" })).not.toBeNull();
    expect(screen.getByText("Identificação não informada")).not.toBeNull();
    expect(screen.queryByText("Paciente 987654321")).toBeNull();
    expect(document.body.textContent).not.toContain("987654321");
  });
});
