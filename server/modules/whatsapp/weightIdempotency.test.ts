import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  listUserWeightEntries: vi.fn(),
  updateUserCurrentWeight: vi.fn(),
}));

vi.mock("../../db", () => dbMocks);

const { ensureWhatsAppWeightEntry } = await import("./weightIdempotency");

describe("ensureWhatsAppWeightEntry", () => {
  beforeEach(() => vi.clearAllMocks());

  it("não repete a mutação quando o mesmo peso já foi persistido", async () => {
    const measuredAt = new Date("2026-07-15T12:00:00Z");
    const existing = { id: 7, userId: 42, weightKg: 80.5, measuredAt };
    dbMocks.listUserWeightEntries.mockResolvedValue([existing]);

    const result = await ensureWhatsAppWeightEntry(42, { weightKg: 80.5, measuredAt });

    expect(result).toEqual({ entry: existing, created: false });
    expect(dbMocks.updateUserCurrentWeight).not.toHaveBeenCalled();
  });

  it("persiste uma vez e recupera o registro criado", async () => {
    const measuredAt = new Date("2026-07-15T12:00:00Z");
    const created = { id: 8, userId: 42, weightKg: 80.5, measuredAt };
    dbMocks.listUserWeightEntries
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([created]);

    const result = await ensureWhatsAppWeightEntry(42, { weightKg: 80.5, measuredAt });

    expect(dbMocks.updateUserCurrentWeight).toHaveBeenCalledOnce();
    expect(result).toEqual({ entry: created, created: true });
  });
});
