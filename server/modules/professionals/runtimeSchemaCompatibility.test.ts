import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MockConnectionOptions = {
  missingTables?: string[];
  missingColumns?: string[];
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
    const statements: string[] = [];

    connection = {
      statements,
      execute: vi.fn(async (query: string, params?: unknown[]) => {
        statements.push(query);

        if (query.includes("information_schema.tables")) {
          const tableName = String(params?.[0]);
          return [[{ total: missingTables.has(tableName) ? 0 : 1 }]];
        }

        if (query.includes("information_schema.columns")) {
          const tableName = String(params?.[0]);
          const columnName = String(params?.[1]);
          return [
            [
              {
                total: missingColumns.has(`${tableName}.${columnName}`) ? 0 : 1,
              },
            ],
          ];
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

async function loadCompatibility() {
  vi.resetModules();
  return import("./runtimeSchemaCompatibility");
}

beforeEach(() => {
  process.env = {
    ...originalEnv,
    DATABASE_URL: "mysql://user:pass@localhost:3306/app",
  };
  mysqlMock.createConnection.mockClear();
});

afterEach(() => {
  process.env = originalEnv;
  vi.clearAllMocks();
});

describe("ensureProfessionalRuntimeSchemaCompatibility", () => {
  it("only verifies an up-to-date production schema", async () => {
    process.env.NODE_ENV = "production";
    mysqlMock.createConnectionMock();
    const { ensureProfessionalRuntimeSchemaCompatibility } =
      await loadCompatibility();

    await expect(
      ensureProfessionalRuntimeSchemaCompatibility()
    ).resolves.toEqual({ mode: "verify", added: [], pending: [] });
    expect(mysqlMock.getConnection().statements.join("\n")).not.toMatch(
      /ALTER TABLE|CREATE TABLE|CREATE INDEX/
    );
  });

  it("repairs the local schema required by patients and operational alerts", async () => {
    process.env.NODE_ENV = "development";
    mysqlMock.createConnectionMock({
      missingTables: [
        "professionalOperationalRequests",
        "professionalReviewSignals",
        "professionalOperationalAlerts",
      ],
      missingColumns: [
        "professionalPatientTrackings.nextReviewAt",
        "professionalPatientTrackings.nextWeighingAt",
      ],
    });
    const { ensureProfessionalRuntimeSchemaCompatibility } =
      await loadCompatibility();

    const result = await ensureProfessionalRuntimeSchemaCompatibility();

    expect(result).toEqual({
      mode: "repair",
      added: [
        "professionalPatientTrackings.nextReviewAt",
        "professionalPatientTrackings.nextWeighingAt",
        "professionalOperationalRequests",
        "professionalReviewSignals",
        "professionalOperationalAlerts",
      ],
      pending: [],
    });
    const statements = mysqlMock.getConnection().statements.join("\n");
    expect(statements).toMatch(
      /ALTER TABLE `professionalPatientTrackings` ADD COLUMN `nextReviewAt`/
    );
    expect(statements).toMatch(
      /ALTER TABLE `professionalPatientTrackings` ADD COLUMN `nextWeighingAt`/
    );
    expect(statements).toMatch(
      /CREATE TABLE `professionalOperationalRequests`/
    );
    expect(statements).toMatch(/CREATE TABLE `professionalReviewSignals`/);
    expect(statements).toMatch(
      /CREATE TABLE `professionalOperationalAlerts`/
    );
    expect(statements).toMatch(
      /CREATE INDEX `professionalOperationalAlerts_patient_state_idx`/
    );
  });

  it("fails production before serving a partially migrated workspace", async () => {
    process.env.NODE_ENV = "production";
    mysqlMock.createConnectionMock({
      missingTables: ["professionalOperationalAlerts"],
      missingColumns: ["professionalPatientTrackings.nextReviewAt"],
    });
    const {
      ProfessionalRuntimeSchemaCompatibilityError,
      ensureProfessionalRuntimeSchemaCompatibility,
    } = await loadCompatibility();

    await expect(
      ensureProfessionalRuntimeSchemaCompatibility()
    ).rejects.toBeInstanceOf(ProfessionalRuntimeSchemaCompatibilityError);
    expect(mysqlMock.getConnection().statements.join("\n")).not.toMatch(
      /ALTER TABLE|CREATE TABLE|CREATE INDEX/
    );
  });

  it("fails fast when the professional foundation is absent", async () => {
    process.env.NODE_ENV = "development";
    mysqlMock.createConnectionMock({
      missingTables: ["professionalPatientAuthorizations"],
    });
    const {
      ProfessionalRuntimeSchemaCompatibilityError,
      ensureProfessionalRuntimeSchemaCompatibility,
    } = await loadCompatibility();

    await expect(
      ensureProfessionalRuntimeSchemaCompatibility()
    ).rejects.toBeInstanceOf(ProfessionalRuntimeSchemaCompatibilityError);
    expect(mysqlMock.getConnection().statements.join("\n")).not.toMatch(
      /ALTER TABLE|CREATE TABLE|CREATE INDEX/
    );
  });

  it("returns an empty result without a configured database", async () => {
    delete process.env.DATABASE_URL;
    process.env.NODE_ENV = "development";
    const { ensureProfessionalRuntimeSchemaCompatibility } =
      await loadCompatibility();

    await expect(
      ensureProfessionalRuntimeSchemaCompatibility()
    ).resolves.toEqual({ mode: "repair", added: [], pending: [] });
    expect(mysqlMock.createConnection).not.toHaveBeenCalled();
  });
});
