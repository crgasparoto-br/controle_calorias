import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeStrictBase64, StrictBase64Error } from "./imageBase64";

describe("decodeStrictBase64", () => {
  afterEach(() => vi.restoreAllMocks());

  it("rejects an oversized payload before allocating a decoded Buffer", () => {
    const bufferFrom = vi.spyOn(Buffer, "from");
    let thrown: unknown;

    try {
      decodeStrictBase64("QUJDRA==", 3);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(StrictBase64Error);
    expect(thrown).toMatchObject({ code: "too_large" });
    expect(bufferFrom).not.toHaveBeenCalled();
  });

  it("accepts the exact byte limit and preserves the canonical compact form", () => {
    const result = decodeStrictBase64("QUJDRA==", 4);

    expect(result.buffer.toString("utf8")).toBe("ABCD");
    expect(result.compact).toBe("QUJDRA==");
  });

  it("rejects malformed or empty input", () => {
    expect(() => decodeStrictBase64("   ", 4)).toThrowError(StrictBase64Error);
    expect(() => decodeStrictBase64("%%%", 4)).toThrowError(StrictBase64Error);
  });
});
