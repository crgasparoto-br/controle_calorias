import { describe, expect, it } from "vitest";
import { prepareD1VisualMedia } from "./publicVisualSurfaces";

const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  Buffer.from("fixture-only-image"),
]);
const jpeg = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.from("fixture-only-image"),
]);

describe("D1 visual media pre-network validation", () => {
  it("accepts canonical image bytes and stable digest regardless of data URL wrapper", () => {
    const base64 = png.toString("base64");
    const a = prepareD1VisualMedia({ mimeType: "image/png", base64 });
    const b = prepareD1VisualMedia({ mimeType: "image/png", base64: `data:image/png;base64,${base64}` });
    expect(a).toEqual(b);
    expect(a.url).toBe(`data:image/png;base64,${base64}`);
    expect(a.contentDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(prepareD1VisualMedia({
      mimeType: "image/jpeg", base64: jpeg.toString("base64"),
    }).contentDigest).not.toBe(a.contentDigest);
  });

  it.each([
    [{ mimeType: "image/png", base64: "%%%not-base64%%%" }, "food-d1-visual-invalid-base64"],
    [{ mimeType: "image/png", base64: jpeg.toString("base64") }, "food-d1-visual-media-mime-mismatch"],
    [{ mimeType: "image/png", base64: `data:image/jpeg;base64,${png.toString("base64")}` }, "food-d1-visual-media-mime-mismatch"],
    [{ mimeType: "image/heic", base64: png.toString("base64") }, "food-d1-visual-unsupported-mime"],
    [{ mimeType: "image/png", base64: "a".repeat(12_000_000) }, "food-d1-visual-media-too-large"],
  ] as const)("rejects untrusted image metadata and bytes before provider: %o", (media, error) => {
    expect(() => prepareD1VisualMedia(media)).toThrow(error);
  });
});
