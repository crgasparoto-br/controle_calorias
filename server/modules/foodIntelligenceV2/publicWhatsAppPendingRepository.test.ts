import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Regression for #1308: Drizzle .select({ id }) yields { id: number }, not
 * a number. Never pass that selected record to an owner-scoped WHERE, insert
 * or row decoder. This static control catches accidental variable shadowing
 * before it reaches an actual TiDB integration run.
 */
describe("#1308 D1 durable pending owner scalar contract", () => {
  const source = readFileSync(resolve(__dirname, "publicWhatsAppPendingRepository.ts"), "utf8");
  const stage = source.split("export async function stageFoodD1WhatsAppPending(")[1]
    ?.split("export async function updateFoodD1WhatsAppPending(")[0] ?? "";

  it("locks the authenticated user row but binds every persistence operation to the numeric owner id", () => {
    expect(stage).toContain("const ownerUserId = pending.envelope.ownerUserId;");
    expect(stage).toContain("const [lockedOwner] = await tx.select({ id: users.id })");
    expect(stage).toContain("lockedOwner.id !== ownerUserId");
    for (const call of [
      "eq(foodD1OperationRoutes.ownerUserId, ownerUserId)",
      "eq(whatsappPendingOperations.userId, ownerUserId)",
      "checkedRow(rows[0], ownerUserId, now)",
      "userId: ownerUserId, type: FOOD_D1_WHATSAPP_PENDING_TYPE",
      "checkedRow(saved, ownerUserId, now)",
    ]) {
      expect(stage).toContain(call);
    }
  });

  it("rejects reintroducing object-valued owner bindings in the transaction", () => {
    for (const forbidden of [
      "const [owner] = await tx.select",
      "eq(foodD1OperationRoutes.ownerUserId, owner)",
      "eq(whatsappPendingOperations.userId, owner)",
      "checkedRow(rows[0], owner, now)",
      "checkedRow(saved, owner, now)",
      "userId: owner, type:",
    ]) expect(stage).not.toContain(forbidden);
  });
});
