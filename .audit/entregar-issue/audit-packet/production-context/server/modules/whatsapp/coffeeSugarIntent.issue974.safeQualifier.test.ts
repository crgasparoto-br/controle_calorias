import { describe, expect, it } from "vitest";
import { isCoffeeSugarRegistrationText } from "./coffeeSugarIntent";

describe("generic coffee safe qualifier", () => {
  it("keeps sem adicao de acucar out of the generic clarification", () => {
    expect(isCoffeeSugarRegistrationText("cafe sem adicao de acucar")).toBe(false);
  });
});
