import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDrizzleWhatsAppPendingOperationRepository } from "./whatsappPendingOperationRepository";

const originalEnv = { ...process.env };

function createUnavailableRepository(options?: { throws?: boolean }) {
  const getDb = options?.throws
    ? vi.fn(async () => {
        throw new Error("database offline");
      })
    : vi.fn(async () => null);
  const onWarning = vi.fn();
  const repository = createDrizzleWhatsAppPendingOperationRepository({
    getDb,
    onWarning,
  });
  return { getDb, onWarning, repository };
}

describe("WhatsApp pending operation production persistence policy", () => {
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      NODE_ENV: "production",
      ALLOW_MEMORY_PERSISTENCE: "true",
    };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it("fails closed for every repository operation when the database is unavailable", async () => {
    const { getDb, onWarning, repository } = createUnavailableRepository();
    const input = {
      userId: 903,
      type: "food_registration_clarification",
      target: { kind: "food_registration_clarification" },
      origin: "foodClarification",
      ttlMs: 60_000,
    };

    await expect(repository.createPendingOperation(input)).resolves.toBeNull();
    await expect(repository.getActivePendingOperation(903)).resolves.toBeNull();
    await expect(repository.getLatestPendingOperation(903)).resolves.toBeNull();
    await expect(repository.getPendingOperationById(1)).resolves.toBeNull();
    await expect(
      repository.claimPendingOperation({ id: 1, expectedVersion: 1 })
    ).resolves.toEqual({ claimed: false });
    await expect(repository.cancelPendingOperation(1)).resolves.toEqual({
      cancelled: false,
    });
    await expect(repository.supersedePendingOperation(1)).resolves.toEqual({
      superseded: false,
    });
    await expect(repository.purgeInactiveOperations(30)).resolves.toBe(0);

    expect(getDb).toHaveBeenCalledTimes(8);
    expect(onWarning).toHaveBeenCalledTimes(8);
    for (const [scope, error] of onWarning.mock.calls) {
      expect(scope).toContain("WhatsApp pending operation");
      expect(String((error as Error).message)).toContain(
        "memory persistence fallback is disabled"
      );
      expect(`${scope} ${(error as Error).message}`).not.toContain(
        "food_registration_clarification"
      );
    }
  });

  it("does not create volatile state that another production instance can observe", async () => {
    const first = createUnavailableRepository();
    const second = createUnavailableRepository();

    const created = await first.repository.createPendingOperation({
      userId: 1903,
      type: "food_registration_clarification",
      target: { kind: "food_registration_clarification" },
      origin: "foodClarification",
      ttlMs: 60_000,
    });
    const observedAfterRestart =
      await second.repository.getActivePendingOperation(1903);

    expect(created).toBeNull();
    expect(observedAfterRestart).toBeNull();
  });

  it("fails closed when the database provider throws instead of returning null", async () => {
    const { onWarning, repository } = createUnavailableRepository({ throws: true });

    await expect(
      repository.createPendingOperation({
        userId: 2903,
        type: "food_registration_clarification",
        target: { kind: "food_registration_clarification" },
        origin: "foodClarification",
        ttlMs: 60_000,
      })
    ).resolves.toBeNull();

    expect(onWarning).toHaveBeenCalledWith(
      "WhatsApp pending operation create skipped",
      expect.objectContaining({ message: "database offline" })
    );
  });

  it("keeps the process-local fallback available in tests only", async () => {
    process.env.NODE_ENV = "test";
    delete process.env.ALLOW_MEMORY_PERSISTENCE;
    const first = createUnavailableRepository();
    const second = createUnavailableRepository();

    const created = await first.repository.createPendingOperation({
      userId: 3903,
      type: "food_registration_clarification",
      target: { kind: "food_registration_clarification" },
      origin: "foodClarification",
      ttlMs: 60_000,
    });
    const restored = await second.repository.getActivePendingOperation(3903);

    expect(created).not.toBeNull();
    expect(restored?.id).toBe(created?.id);
    await second.repository.claimPendingOperation({
      id: created!.id,
      expectedVersion: created!.version,
    });
  });
});
