import { describe, expect, it } from "vitest";
import {
  professionalMessageCreateSchema,
  professionalMessageListSchema,
} from "./schemas";

describe("professional communication schemas", () => {
  it("requires bounded content and an explicit idempotency key", () => {
    expect(
      professionalMessageCreateSchema.safeParse({
        patientId: 1,
        content: "",
        messageType: "guidance",
        idempotencyKey: "short",
      }).success
    ).toBe(false);
    expect(
      professionalMessageCreateSchema.parse({
        patientId: 1,
        content: "Orientação revisada",
        messageType: "guidance",
        origin: "ai_suggested",
        action: "save_draft",
        idempotencyKey: "message-key-123",
      })
    ).toMatchObject({ origin: "ai_suggested", action: "save_draft" });
  });

  it("bounds pagination and rejects unsupported message types", () => {
    expect(professionalMessageListSchema.parse({}).pageSize).toBe(20);
    expect(
      professionalMessageListSchema.safeParse({ pageSize: 100 }).success
    ).toBe(false);
    expect(
      professionalMessageCreateSchema.safeParse({
        patientId: 1,
        content: "x",
        messageType: "marketing",
        idempotencyKey: "message-key-123",
      }).success
    ).toBe(false);
  });
});
