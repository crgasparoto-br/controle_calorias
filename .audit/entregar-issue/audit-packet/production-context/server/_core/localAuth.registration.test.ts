import { beforeEach, describe, expect, it, vi } from "vitest";

const getDbMock = vi.hoisted(() => vi.fn());
const hashPasswordMock = vi.hoisted(() => vi.fn(async () => "hashed-password"));

vi.mock("../db", () => ({
  getDb: getDbMock,
}));

vi.mock("./passwords", () => ({
  hashPassword: hashPasswordMock,
  passwordHashNeedsUpgrade: vi.fn(() => false),
  verifyPassword: vi.fn(async () => false),
}));

vi.mock("../repositories/memoryFallback", () => ({
  canUseMemoryPersistenceFallback: vi.fn(() => false),
}));

const { registerLocalUser } = await import("./localAuth");

function databaseWithFindResults(findResults: unknown[][], insert?: () => Promise<unknown>) {
  const results = [...findResults];
  const insertValues = vi.fn(insert ?? (async () => undefined));
  const database = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => results.shift() ?? []),
        })),
      })),
    })),
    insert: vi.fn(() => ({ values: insertValues })),
  };
  return { database, insertValues };
}

const existingPasswordlessUser = {
  id: 44,
  openId: "oauth:44",
  name: "Conta existente",
  email: "existing@example.com",
  loginMethod: "oauth",
  passwordHash: null,
  role: "user",
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSignedIn: new Date(),
};

describe("registerLocalUser existing-account protection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not adopt a passwordless existing identity through public registration", async () => {
    const { database, insertValues } = databaseWithFindResults([
      [existingPasswordlessUser],
    ]);
    getDbMock.mockResolvedValue(database);

    await expect(
      registerLocalUser({
        name: "Novo nome",
        email: "existing@example.com",
        password: "SenhaForte123",
      })
    ).rejects.toThrow("EMAIL_ALREADY_REGISTERED");
    expect(insertValues).not.toHaveBeenCalled();
  });

  it("normalizes a concurrent duplicate insert to the same safe conflict", async () => {
    const { database, insertValues } = databaseWithFindResults(
      [[], [existingPasswordlessUser]],
      async () => {
        throw new Error("ER_DUP_ENTRY");
      }
    );
    getDbMock.mockResolvedValue(database);

    await expect(
      registerLocalUser({
        name: "Concorrente",
        email: "existing@example.com",
        password: "SenhaForte123",
      })
    ).rejects.toThrow("EMAIL_ALREADY_REGISTERED");
    expect(insertValues).toHaveBeenCalledTimes(1);
  });
});
