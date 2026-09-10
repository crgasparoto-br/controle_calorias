import { beforeEach, describe, expect, it, vi } from "vitest";

const getDb = vi.fn();
const logPersistenceWarning = vi.fn();
vi.mock("../../db", () => ({ getDb, logPersistenceWarning }));

type Row = { id: number; userId: number; preferenceKey: string; preferenceValue: string };
const rows: Row[] = [];
let nextId = 1;

function queryResult(result: Row[]) {
  return {
    limit: async (count: number) => result.slice(0, count),
    then: (resolve: (value: Row[]) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
}

const fakeDb = {
  insert: () => ({
    values: (values: Omit<Row, "id">) => ({
      onDuplicateKeyUpdate: async ({ set }: { set: Partial<Row> }) => {
        const existing = rows.find(row => row.userId === values.userId && row.preferenceKey === values.preferenceKey);
        if (existing) Object.assign(existing, set, { preferenceValue: values.preferenceValue });
        else rows.push({ id: nextId++, ...values });
      },
    }),
  }),
  select: () => ({
    from: () => ({
      where: () => queryResult([...rows]),
    }),
  }),
};

const { recordWhatsappContextMemory, __resetWhatsappContextMemoryForTests } = await import("./contextMemory");
const {
  persistWhatsappContextMemoryEntry,
  loadPersistedWhatsappContextMemories,
  __resetPersistentWhatsappContextMemoryForTests,
} = await import("./persistentContextMemory");

describe("issue #1059 - durable contextual memory adapter", () => {
  beforeEach(() => {
    rows.length = 0;
    nextId = 1;
    vi.clearAllMocks();
    getDb.mockResolvedValue(fakeDb);
    __resetWhatsappContextMemoryForTests();
    __resetPersistentWhatsappContextMemoryForTests();
  });

  it("reloads an individual memory from durable storage after process-local state is reset", async () => {
    const local = recordWhatsappContextMemory({
      userId: 42,
      scope: "individual",
      kind: "individual_preference",
      key: "food-preparation:cafe",
      value: "without_sugar",
      confidence: 0.9,
      appliesToIntents: ["add_foods_to_meal"],
      source: { sourceType: "feedback", feedbackId: 10 },
      createdAt: new Date("2026-09-10T12:00:00.000Z"),
    });

    const persisted = await persistWhatsappContextMemoryEntry(local);
    expect(persisted).toMatchObject({ userId: 42, key: "food-preparation:cafe", value: "without_sugar" });
    expect(rows).toHaveLength(1);

    __resetWhatsappContextMemoryForTests();
    __resetPersistentWhatsappContextMemoryForTests();

    const reloaded = await loadPersistedWhatsappContextMemories(42);
    expect(reloaded).toHaveLength(1);
    expect(reloaded?.[0]).toMatchObject({
      userId: 42,
      scope: "individual",
      status: "active",
      key: "food-preparation:cafe",
      value: "without_sugar",
      source: { sourceType: "feedback", feedbackId: 10 },
    });
  });
});
