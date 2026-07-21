import { afterEach, describe, expect, it, vi } from "vitest";
import { deleteProfessionalProfilePersistence } from "./professionalProfileDeletionRepository";

const previousNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previousNodeEnv;
});

describe("professional profile deletion repository", () => {
  it("removes the legacy mirror and the canonical profile in one transaction", async () => {
    const where = vi.fn().mockResolvedValue(undefined);
    const deleteFrom = vi.fn().mockReturnValue({ where });
    const transaction = vi.fn(async callback => callback({ delete: deleteFrom }));

    await expect(
      deleteProfessionalProfilePersistence({
        getDb: async () => ({ transaction }),
        userId: 10,
      })
    ).resolves.toEqual({ persisted: true });

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(deleteFrom).toHaveBeenCalledTimes(2);
    expect(where).toHaveBeenCalledTimes(2);
  });

  it("uses the in-process tombstone path only outside production", async () => {
    process.env.NODE_ENV = "test";

    await expect(
      deleteProfessionalProfilePersistence({
        getDb: async () => null,
        userId: 10,
      })
    ).resolves.toEqual({ persisted: false });
  });

  it("fails closed when production persistence is unavailable", async () => {
    process.env.NODE_ENV = "production";

    await expect(
      deleteProfessionalProfilePersistence({
        getDb: async () => null,
        userId: 10,
      })
    ).rejects.toThrow(
      "A persistência da Área Profissional está temporariamente indisponível."
    );
  });
});
