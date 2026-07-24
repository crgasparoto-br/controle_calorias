import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  getDb: vi.fn(),
  getProfessionalEntitlements: vi.fn(),
  getProfessionalProfile: vi.fn(),
}));

vi.mock("../../db", async importOriginal => {
  const actual = await importOriginal<typeof import("../../db")>();
  return { ...actual, getDb: mocks.getDb };
});
vi.mock("./service", async importOriginal => {
  const actual = await importOriginal<typeof import("./service")>();
  return {
    ...actual,
    getProfessionalProfile: mocks.getProfessionalProfile,
  };
});
vi.mock("./entitlementService", async importOriginal => {
  const actual = await importOriginal<typeof import("./entitlementService")>();
  return {
    ...actual,
    getProfessionalEntitlements: mocks.getProfessionalEntitlements,
  };
});

import { professionalRecordRouter } from "./recordRouter";

function contextRow(patientId: number, name: string) {
  return {
    authorizationId: `authorization-${patientId}`,
    patientUserId: patientId,
    patientName: name,
    patientEmail: `${name.toLowerCase()}@example.com`,
    trackingStatus: "active",
  };
}

function createCaller() {
  return professionalRecordRouter.createCaller({
    req: {} as never,
    res: {} as never,
    user: { id: 7 } as never,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getProfessionalProfile.mockResolvedValue({ active: true });
  mocks.getProfessionalEntitlements.mockResolvedValue({
    allowed: true,
    commercialState: "active",
    enabledResources: [
      "professional_record",
      "professional_reports",
      "professional_messages",
    ],
  });
  mocks.getDb.mockResolvedValue({ execute: mocks.execute });
  mocks.execute.mockResolvedValue([[contextRow(41, "Ana")]]);
});

describe("professionalRecord.context integration", () => {
  it("revalidates the URL-derived patient on independent callers", async () => {
    const firstTab = createCaller();
    const reloadedTab = createCaller();

    await expect(
      firstTab.context({ patientId: 41, resource: "professional_reports" })
    ).resolves.toMatchObject({ patientId: 41, displayName: "Ana" });
    await expect(
      reloadedTab.context({ patientId: 41, resource: "professional_reports" })
    ).resolves.toMatchObject({ patientId: 41, displayName: "Ana" });

    expect(mocks.execute).toHaveBeenCalledTimes(2);
    expect(mocks.getProfessionalEntitlements).toHaveBeenCalledTimes(2);
  });

  it("resolves each navigation target independently without retaining the previous patient", async () => {
    mocks.execute
      .mockResolvedValueOnce([[contextRow(41, "Ana")]])
      .mockResolvedValueOnce([[contextRow(72, "Bruno")]])
      .mockResolvedValueOnce([[contextRow(41, "Ana")]]);
    const caller = createCaller();

    await expect(
      caller.context({ patientId: 41, resource: "professional_reports" })
    ).resolves.toMatchObject({ patientId: 41, displayName: "Ana" });
    await expect(
      caller.context({ patientId: 72, resource: "professional_messages" })
    ).resolves.toMatchObject({ patientId: 72, displayName: "Bruno" });
    await expect(
      caller.context({ patientId: 41, resource: "professional_reports" })
    ).resolves.toMatchObject({ patientId: 41, displayName: "Ana" });
  });

  it("rejects malformed identifiers before querying persistence", async () => {
    await expect(
      createCaller().context({
        patientId: 0,
        resource: "professional_record",
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("returns FORBIDDEN when the exact route entitlement is absent", async () => {
    mocks.getProfessionalEntitlements.mockResolvedValue({
      allowed: true,
      commercialState: "active",
      enabledResources: ["professional_record"],
    });

    await expect(
      createCaller().context({
        patientId: 41,
        resource: "professional_reports",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("keeps entitlement-provider outages recoverable", async () => {
    mocks.getProfessionalEntitlements.mockResolvedValue({
      allowed: false,
      commercialState: "unavailable",
      enabledResources: [],
    });

    await expect(
      createCaller().context({
        patientId: 41,
        resource: "professional_reports",
      })
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});
