import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MockConnectionOptions = {
  missingTables?: string[];
  missingColumns?: string[];
  weekdayMetadata?: { isNullable: string; columnDefault: string | number | null } | null;
};

const mysqlMock = vi.hoisted(() => {
  let connection: {
    execute: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
    statements: string[];
  };

  function createConnectionMock(options: MockConnectionOptions = {}) {
    const missingTables = new Set(options.missingTables ?? []);
    const missingColumns = new Set(options.missingColumns ?? []);
    const weekdayMetadata = options.weekdayMetadata ?? { isNullable: "NO", columnDefault: "-1" };
    const statements: string[] = [];

    connection = {
      statements,
      execute: vi.fn(async (query: string, params?: unknown[]) => {
        statements.push(query);

        if (query.includes("information_schema.tables")) {
          const tableName = String(params?.[0]);
          return [[{ total: missingTables.has(tableName) ? 0 : 1 }]];
        }

        if (query.includes("COUNT(*) AS total FROM information_schema.columns")) {
          const tableName = String(params?.[0]);
          const columnName = String(params?.[1]);
          return [[{ total: missingColumns.has(`${tableName}.${columnName}`) ? 0 : 1 }]];
        }

        if (query.includes("IS_NULLABLE AS isNullable")) {
          return [weekdayMetadata ? [weekdayMetadata] : []];
        }

        return [[]];
      }),
      end: vi.fn(async () => undefined),
    };

    return connection;
  }

  return {
    createConnectionMock,
    getConnection: () => connection,
    createConnection: vi.fn(async () => connection),
  };
});

vi.mock("mysql2/promise", () => ({
  default: {
    createConnection: mysqlMock.createConnection,
  },
}));

const originalEnv = process.env;

async function loadSchemaCompatibility() {
  vi.resetModules();
  return import("./schemaCompatibility");
}

beforeEach(() => {
  process.env = { ...originalEnv, DATABASE_URL: "mysql://user:pass@localhost:3306/app" };
  mysqlMock.createConnection.mockClear();
});

afterEach(() => {
  process.env = originalEnv;
  vi.clearAllMocks();
});

describe("ensureRuntimeSchemaCompatibility", () => {
  it("only verifies an up-to-date production database", async () => {
    process.env.NODE_ENV = "production";
    mysqlMock.createConnectionMock();
    const { ensureRuntimeSchemaCompatibility } = await loadSchemaCompatibility();

    const result = await ensureRuntimeSchemaCompatibility();

    expect(result).toEqual({ mode: "verify", added: [], updated: [], pending: [] });
    expect(mysqlMock.getConnection().statements.join("\n")).not.toMatch(/ALTER TABLE|CREATE TABLE|UPDATE `/);
  });

  it("fails production startup when a structural compatibility change is pending", async () => {
    process.env.NODE_ENV = "production";
    mysqlMock.createConnectionMock({ missingColumns: ["users.passwordHash"] });
    const { RuntimeSchemaCompatibilityError, ensureRuntimeSchemaCompatibility } = await loadSchemaCompatibility();

    await expect(ensureRuntimeSchemaCompatibility()).rejects.toBeInstanceOf(RuntimeSchemaCompatibilityError);
    await expect(ensureRuntimeSchemaCompatibility()).rejects.toThrow("users.passwordHash");
    expect(mysqlMock.getConnection().statements.join("\n")).not.toMatch(/ALTER TABLE|CREATE TABLE|UPDATE `/);
  });

  it("repairs known local schema gaps outside production", async () => {
    process.env.NODE_ENV = "development";
    mysqlMock.createConnectionMock({
      missingTables: ["whatsapp_onboarding_leads", "quickEditTokens"],
      missingColumns: ["users.passwordHash"],
      weekdayMetadata: { isNullable: "YES", columnDefault: null },
    });
    const { ensureRuntimeSchemaCompatibility } = await loadSchemaCompatibility();

    const result = await ensureRuntimeSchemaCompatibility();

    expect(result.added).toEqual(["users.passwordHash", "whatsapp_onboarding_leads", "quickEditTokens"]);
    expect(result.updated).toEqual(["nutritionGoals.weekday"]);
    expect(result.pending).toEqual([]);
    expect(mysqlMock.getConnection().statements.join("\n")).toMatch(/ALTER TABLE `users` ADD COLUMN/);
    expect(mysqlMock.getConnection().statements.join("\n")).toMatch(/CREATE TABLE `whatsapp_onboarding_leads`/);
    expect(mysqlMock.getConnection().statements.join("\n")).toMatch(/CREATE TABLE `quickEditTokens`/);
    expect(mysqlMock.getConnection().statements.join("\n")).toMatch(/UPDATE `nutritionGoals` SET `weekday` = -1/);
  });

  it("returns an empty result when no database is configured", async () => {
    delete process.env.DATABASE_URL;
    process.env.NODE_ENV = "production";
    const { ensureRuntimeSchemaCompatibility } = await loadSchemaCompatibility();

    await expect(ensureRuntimeSchemaCompatibility()).resolves.toEqual({
      mode: "verify",
      added: [],
      updated: [],
      pending: [],
    });
  });
});
