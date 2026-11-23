import { describe, expect, it } from "vitest";
import { analyzeFoodPhotoSchema } from "./schemas";

const photo = { base64: "aW1hZ2U=", mimeType: "image/png" };

describe("#1308 existing photo-analysis request schema", () => {
  it("keeps the original V1 image-only request valid with new fields absent", () => {
    const parsed = analyzeFoodPhotoSchema.parse({ image: photo });
    expect(parsed).toMatchObject({ image: photo });
    expect(parsed.imageKind).toBeUndefined();
    expect(parsed.d1OperationId).toBeUndefined();
  });

  it("accepts explicit D1 photo operation metadata without asserting nutritional identity", () => {
    const parsed = analyzeFoodPhotoSchema.parse({
      image: photo, imageKind: "packaging",
      d1OperationId: "photo-entrypoint-0001",
      mealLabel: "almoço", occurredAt: "2026-11-04T12:30",
    });
    expect(parsed).toMatchObject({
      imageKind: "packaging", d1OperationId: "photo-entrypoint-0001",
    });
  });

  it("rejects invalid photo-role injection and unstable operation ID before routing", () => {
    expect(analyzeFoodPhotoSchema.safeParse({
      image: photo, imageKind: "arbitrary_nutrition_engine",
    }).success).toBe(false);
    expect(analyzeFoodPhotoSchema.safeParse({
      image: photo, imageKind: "plate_image", d1OperationId: "short",
    }).success).toBe(false);
    expect(analyzeFoodPhotoSchema.safeParse({
      image: undefined, imageKind: "plate_image",
    }).success).toBe(false);
  });
});
