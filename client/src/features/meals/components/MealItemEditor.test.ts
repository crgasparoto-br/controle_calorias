import { describe, expect, it } from "vitest";
import { parsePositiveQuantityInput } from "./quantityInput";

describe("parsePositiveQuantityInput", () => {
  it("keeps empty input invalid while the user is editing", () => {
    expect(parsePositiveQuantityInput("")).toBeNull();
    expect(parsePositiveQuantityInput("   ")).toBeNull();
  });

  it("rejects non-positive or invalid quantities", () => {
    expect(parsePositiveQuantityInput("0")).toBeNull();
    expect(parsePositiveQuantityInput("-1")).toBeNull();
    expect(parsePositiveQuantityInput("banana")).toBeNull();
  });

  it("accepts positive decimal quantities with dot or comma", () => {
    expect(parsePositiveQuantityInput("1")).toBe(1);
    expect(parsePositiveQuantityInput("2.5")).toBe(2.5);
    expect(parsePositiveQuantityInput("2,5")).toBe(2.5);
  });
});
