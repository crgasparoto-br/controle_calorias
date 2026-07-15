import { describe, expect, it, vi } from "vitest";

function selectChain(result: unknown[]) {
  const chain: any = {
    from: vi.fn(() => chain),
    innerJoin: vi.fn(() => chain),
    where: vi.fn(async () => result),
  };
  return chain;
}

describe("professional canonical history", () => {
  it("combina eventos de autorização e acompanhamento em ordem decrescente", async () => {
    const access = {
      id: "access-history-1",
      professionalUserId: 901,
      patientUserId: 902,
    };
    const accessRows = [{
      event: {
        id: 11,
        actorUserId: 902,
        toStatus: "approved",
        occurredAt: new Date("2026-07-10T10:00:00.000Z"),
      },
      access,
    }];
    const followUpRows = [{
      event: {
        id: 21,
        actorUserId: 901,
        fromStatus: "active",
        toStatus: "paused",
        occurredAt: new Date("2026-07-11T10:00:00.000Z"),
      },
      access,
    }];
    const select = vi.fn()
      .mockReturnValueOnce(selectChain(accessRows))
      .mockReturnValueOnce(selectChain(followUpRows));

    vi.resetModules();
    vi.doMock("../db", () => ({ getDb: vi.fn(async () => ({ select })) }));
    const { listCanonicalProfessionalHistory } = await import("./professionalRepository");

    await expect(listCanonicalProfessionalHistory(901)).resolves.toEqual([
      expect.objectContaining({ id: "follow-up:21", eventType: "follow_up_paused" }),
      expect.objectContaining({ id: "access:11", eventType: "access_approved" }),
    ]);
  });
});
