import { describe, expect, it, vi } from "vitest";
import { createProfessionalAccessRequestReceiptRepository } from "./accessRequestReceiptRepository";
import { professionalRepository as canonicalProfessionalRepository } from "./persistenceService";

function createRepository() {
  const listAuthorizationsByProfessional = vi.fn().mockResolvedValue([]);
  return {
    repository: createProfessionalAccessRequestReceiptRepository({
      getDb: async () => null,
      onWarning: vi.fn(),
      professionalRepository: {
        ...canonicalProfessionalRepository,
        listAuthorizationsByProfessional,
      },
    }),
    listAuthorizationsByProfessional,
  };
}

describe("professional access receipt pagination", () => {
  it("keeps every valid receipt reachable beyond the former fifty-item limit", async () => {
    const { repository } = createRepository();
    const professionalUserId = 879001;
    const baseTime = 1_800_000_000_000;
    for (let index = 0; index < 65; index += 1) {
      await repository.createUnresolvedReceipt(
        professionalUserId,
        baseTime + index
      );
    }

    const pages = await Promise.all(
      [0, 20, 40, 60].map(offset =>
        repository.listActiveReceiptsPage(
          professionalUserId,
          { offset, limit: 20 },
          baseTime + 100
        )
      )
    );

    expect(pages.map(page => page.items.length)).toEqual([20, 20, 20, 5]);
    expect(pages.every(page => page.total === 65)).toBe(true);
    expect(
      new Set(pages.flatMap(page => page.items.map(item => item.id))).size
    ).toBe(65);
  });

  it("excludes expired unresolved receipts before calculating totals", async () => {
    const { repository } = createRepository();
    const professionalUserId = 879002;
    const now = 1_800_000_000_000;
    await repository.createUnresolvedReceipt(
      professionalUserId,
      now - 31 * 24 * 60 * 60 * 1000
    );
    await repository.createUnresolvedReceipt(professionalUserId, now - 1000);
    await repository.createUnresolvedReceipt(professionalUserId, now);

    const page = await repository.listActiveReceiptsPage(
      professionalUserId,
      { offset: 0, limit: 20 },
      now
    );

    expect(page.total).toBe(2);
    expect(page.items).toHaveLength(2);
  });

  it("removes linked receipts once the canonical authorization is no longer pending", async () => {
    const { repository, listAuthorizationsByProfessional } = createRepository();
    const professionalUserId = 879003;
    const authorizationId = "authorization-879003";
    await repository.createLinkedReceipt({
      professionalUserId,
      authorizationId,
      patientUserId: 42,
      requestedAt: 1_800_000_000_000,
    });
    listAuthorizationsByProfessional.mockResolvedValueOnce([
      {
        id: authorizationId,
        patientUserId: 42,
        status: "approved",
      },
    ]);

    const page = await repository.listActiveReceiptsPage(
      professionalUserId,
      { offset: 0, limit: 20 },
      1_800_000_000_100
    );

    expect(page).toEqual({ items: [], total: 0 });
  });
});
