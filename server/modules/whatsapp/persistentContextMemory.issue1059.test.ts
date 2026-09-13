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

function individualPreference(value: "without_sugar" | "with_sugar", kind: "individual_preference" | "individual_alias" = "individual_preference") {
  return recordWhatsappContextMemory({
    userId: 42,
    scope: "individual",
    kind,
    key: "food-preparation:cafe",
    value,
    confidence: 0.9,
    appliesToIntents: ["add_foods_to_meal"],
    source: { sourceType: "feedback", feedbackId: value === "without_sugar" ? 10 : 11 },
    createdAt: new Date(value === "without_sugar" ? "2026-09-10T12:00:00.000Z" : "2026-09-10T13:00:00.000Z"),
  });
}

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
    const local = individualPreference("without_sugar");

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

  it("replaces the durable semantic slot when the user states a newer preference with different wording", async () => {
    await persistWhatsappContextMemoryEntry(individualPreference("without_sugar", "individual_alias"));
    await persistWhatsappContextMemoryEntry(individualPreference("with_sugar", "individual_preference"));

    expect(rows).toHaveLength(1);
    const reloaded = await loadPersistedWhatsappContextMemories(42);
    expect(reloaded).toHaveLength(1);
    expect(reloaded?.[0]).toMatchObject({
      key: "food-preparation:cafe",
      value: "with_sugar",
      kind: "individual_preference",
      source: { feedbackId: 11 },
    });
  });
});
