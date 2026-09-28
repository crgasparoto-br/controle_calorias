import type { Connection } from "mysql2/promise";
import { describe, expect, it } from "vitest";

import {
  FoodImportValidationError,
  ImportPreviewMismatchError,
  SourceContentConflictError,
  importFoods,
  previewFoods,
} from "./run_food_import.ts";
import { createSourceContentHash } from "./sourceFingerprint.ts";
import type { ImportPayload } from "./types.ts";

function food(code: string, calories = 128) {
  return {
    sourceFoodCode: code,
    name: `Alimento ${code}`,
    caloriesKcalPer100g: calories,
    proteinGramsPer100g: 2,
    carbsGramsPer100g: 20,
    fatGramsPer100g: 1,
  };
}

function payload(...foods: Array<ReturnType<typeof food>>): ImportPayload {
  return {
    source: {
      slug: "fixture",
      name: "Fonte de teste",
      version: "2026.1",
      countryCode: "BR",
      sourceReference: "fixture controlada",
    },
    foods,
  };
}

type FakeOptions = {
  sourceHash?: string | null;
  failOnFoodUpsert?: number;
  shared?: { sourceHash: string | null; importId: number; foodUpserts: number };
};

class FakeConnection {
  readonly statements: string[] = [];
  readonly statuses: string[] = [];
  beginCount = 0;
  commitCount = 0;
  rollbackCount = 0;
  ended = false;
  foodUpserts = 0;
  private sourceHashAtBegin: string | null = null;
  private readonly state: {
    sourceHash: string | null;
    importId: number;
    foodUpserts: number;
  };

  constructor(private readonly options: FakeOptions = {}) {
    this.state = options.shared ?? {
      sourceHash: options.sourceHash ?? null,
      importId: 0,
      foodUpserts: 0,
    };
  }

  get sourceContentHash() {
    return this.state.sourceHash;
  }

  async execute<T = unknown>(
    sql: string,
    params: unknown[] = []
  ): Promise<[T, unknown]> {
    const normalized = sql.replace(/\s+/g, " ").trim().toLowerCase();
    this.statements.push(normalized);

    if (
      normalized.startsWith(
        "select id, content_hash as contenthash from food_sources where slug"
      )
    ) {
      return [[{ id: 7, contentHash: this.state.sourceHash }] as T, {}];
    }
    if (
      normalized.startsWith(
        "select id, content_hash as contenthash from food_sources where id"
      )
    ) {
      return [[{ id: 7, contentHash: this.state.sourceHash }] as T, {}];
    }
    if (normalized.startsWith("update food_sources set name")) {
      this.state.sourceHash = String(params[4]);
      return [{ affectedRows: 1 } as T, {}];
    }
    if (normalized.startsWith("insert into food_source_imports")) {
      this.state.importId += 1;
      return [{ insertId: this.state.importId, affectedRows: 1 } as T, {}];
    }
    if (normalized.startsWith("update food_source_imports set status")) {
      this.statuses.push(String(params[0]));
      return [{ affectedRows: 1 } as T, {}];
    }
    if (normalized.startsWith("select id from foods where owner_user_id")) {
      return [[] as T, {}];
    }
    if (normalized.startsWith("insert into foods")) {
      this.state.foodUpserts += 1;
      this.foodUpserts = this.state.foodUpserts;
      if (this.options.failOnFoodUpsert === this.state.foodUpserts) {
        throw new Error("simulated persistence failure");
      }
      return [{ affectedRows: this.state.foodUpserts === 1 ? 1 : 2 } as T, {}];
    }
    if (normalized.startsWith("select id from foods where source_id")) {
      return [[{ id: 99 }] as T, {}];
    }
    if (
      normalized.startsWith("insert into food_aliases") ||
      normalized.startsWith("insert into food_portions")
    ) {
      return [{ affectedRows: 1 } as T, {}];
    }

    return [{ affectedRows: 1 } as T, {}];
  }

  async beginTransaction() {
    this.beginCount += 1;
    this.sourceHashAtBegin = this.state.sourceHash;
  }

  async commit() {
    this.commitCount += 1;
  }

  async rollback() {
    this.rollbackCount += 1;
    this.state.sourceHash = this.sourceHashAtBegin;
  }

  async end() {
    this.ended = true;
  }
}

function connectionFactory(connection: FakeConnection) {
  return async () => connection as unknown as Connection;
}

describe("importFoods governance", () => {
  it("gera prévia sem criar fonte, carga ou alimento", async () => {
    const connection = new FakeConnection();
    const report = await previewFoods(payload(food("preview")), {
      connectionFactory: connectionFactory(connection),
    });
    expect(report).toMatchObject({
      phase: "preview",
      totalRows: 1,
      validRows: 1,
      invalidRows: 0,
      canPublish: true,
    });
    expect(connection.beginCount).toBe(0);
    expect(connection.statuses).toEqual([]);
    expect(connection.sourceContentHash).toBeNull();
    expect(connection.statements.some(statement => statement.includes("insert"))).toBe(false);
    expect(connection.ended).toBe(true);
  });

  it("bloqueia publicação quando a prévia não corresponde ao conteúdo confirmado", async () => {
    const connection = new FakeConnection();
    await expect(
      importFoods(payload(food("hash")), {
        connectionFactory: connectionFactory(connection),
        expectedPreviewHash: "0".repeat(64),
      })
    ).rejects.toBeInstanceOf(ImportPreviewMismatchError);
    expect(connection.ended).toBe(false);
    expect(connection.statements).toEqual([]);
  });

  it("rejeita linha inválida antes de abrir a transação e registra falha sem publicar alimento", async () => {
    const connection = new FakeConnection();
    const invalid = payload(food("bad", -1));

    await expect(
      importFoods(invalid, { connectionFactory: connectionFactory(connection) })
    ).rejects.toBeInstanceOf(FoodImportValidationError);

    expect(connection.beginCount).toBe(0);
    expect(connection.commitCount).toBe(0);
    expect(
      connection.statements.some(statement =>
        statement.startsWith("insert into foods")
      )
    ).toBe(false);
    expect(connection.statuses).toEqual(["failed"]);
    expect(connection.sourceContentHash).toBeNull();
    expect(connection.ended).toBe(true);
  });

  it("rejeita porção inválida em vez de descartá-la silenciosamente", async () => {
    const connection = new FakeConnection();
    const invalid = payload({
      ...food("portion"),
      portions: [{ label: "", unit: "g", grams: 0 }],
    });

    await expect(
      importFoods(invalid, { connectionFactory: connectionFactory(connection) })
    ).rejects.toBeInstanceOf(FoodImportValidationError);

    expect(connection.beginCount).toBe(0);
    expect(connection.statuses).toEqual(["failed"]);
    expect(connection.sourceContentHash).toBeNull();
  });

  it("fecha a mesma fonte/versão para outra identidade material", async () => {
    const oldPayload = payload(food("001", 100));
    const connection = new FakeConnection({
      sourceHash: createSourceContentHash(oldPayload),
    });
    const changedPayload = payload(food("001", 101));

    await expect(
      importFoods(changedPayload, {
        connectionFactory: connectionFactory(connection),
      })
    ).rejects.toBeInstanceOf(SourceContentConflictError);

    expect(
      connection.statements.some(statement =>
        statement.startsWith("insert into food_source_imports")
      )
    ).toBe(true);
    expect(connection.statuses).toEqual(["failed"]);
    expect(connection.beginCount).toBe(0);
    expect(connection.ended).toBe(true);
  });

  it("faz rollback da carga inteira quando um lote posterior falha", async () => {
    const connection = new FakeConnection({ failOnFoodUpsert: 2 });

    await expect(
      importFoods(payload(food("001"), food("002")), {
        connectionFactory: connectionFactory(connection),
        transactionBatchSize: 1,
      })
    ).rejects.toThrow("simulated persistence failure");

    expect(connection.beginCount).toBe(1);
    expect(connection.commitCount).toBe(0);
    expect(connection.rollbackCount).toBe(1);
    expect(connection.statuses).toEqual(["failed"]);
    expect(connection.ended).toBe(true);
  });

  it("permite retry do mesmo conteúdo sem duplicar a identidade do alimento", async () => {
    const shared = {
      sourceHash: null as string | null,
      importId: 0,
      foodUpserts: 0,
    };
    const firstConnection = new FakeConnection({ shared });
    const secondConnection = new FakeConnection({ shared });
    const firstPayload = payload(food("001"));
    const equivalentPayload: ImportPayload = {
      ...firstPayload,
      source: { ...firstPayload.source, slug: " FIXTURE " },
      foods: [{ ...food(" 001 "), name: "Alimento 001" }],
    };
    const first = await importFoods(firstPayload, {
      connectionFactory: connectionFactory(firstConnection),
    });
    const second = await importFoods(equivalentPayload, {
      connectionFactory: connectionFactory(secondConnection),
    });

    expect(first.importId).toBe(1);
    expect(second.importId).toBe(2);
    expect(first.inserted).toBe(1);
    expect(second.updated).toBe(1);
    expect(shared.foodUpserts).toBe(2);
    expect(firstConnection.statuses).toEqual(["succeeded"]);
    expect(secondConnection.statuses).toEqual(["succeeded"]);
  });

  it("não emite escrita em meals ou meal_items durante a publicação do catálogo", async () => {
    const connection = new FakeConnection();

    await importFoods(payload(food("001")), {
      connectionFactory: connectionFactory(connection),
    });

    expect(
      connection.statements.some(statement =>
        /\b(meals|meal_items)\b/.test(statement)
      )
    ).toBe(false);
  });
});
