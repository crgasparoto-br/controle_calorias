import { describe, expect, it, vi } from "vitest";
import { createAdminLogsService } from "./logs";
import type { LogsRepository } from "../../repositories/logsRepository";

function createFakeRepository(overrides: Partial<LogsRepository> = {}): LogsRepository {
  return {
    insert: vi.fn(async () => undefined),
    findRecent: vi.fn(async () => null),
    deleteByUserId: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("admin logs service", () => {
  it("sanitizes details before storing in memory and repository", () => {
    const repository = createFakeRepository();
    const service = createAdminLogsService({ logsRepository: repository });

    const created = service.log({
      userId: 10,
      origin: "web",
      status: "success",
      eventType: "meal.confirmed",
      detail: "Token secreto abc123 e telefone +55 11 99999-9999",
    });

    expect(created.detail).not.toContain("99999-9999");
    expect(service.listMemoryRecent()).toEqual([created]);
    expect(repository.insert).toHaveBeenCalledWith(expect.objectContaining({
      userId: 10,
      origin: "web",
      status: "success",
      eventType: "meal.confirmed",
      detail: created.detail,
    }));
  });

  it("normalizes persisted rows to the public admin log shape", async () => {
    const createdAt = new Date("2026-06-17T12:00:00Z");
    const repository = createFakeRepository({
      findRecent: vi.fn(async () => [{
        id: 42,
        userId: null,
        origin: "admin",
        status: "warning",
        eventType: "professional.access.reconciled",
        detail: "1 vínculo reconciliado.",
        createdAt,
      } as any]),
    });
    const service = createAdminLogsService({ logsRepository: repository });

    await expect(service.listPersistedRecent()).resolves.toEqual([
      {
        id: "42",
        userId: undefined,
        origin: "admin",
        status: "warning",
        eventType: "professional.access.reconciled",
        detail: "1 vínculo reconciliado.",
        createdAt: createdAt.getTime(),
      },
    ]);
  });
});
