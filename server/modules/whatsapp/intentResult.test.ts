import { describe, expect, it } from "vitest";

import { getWhatsAppIntentLogStatus } from "./intentResult";

describe("getWhatsAppIntentLogStatus", () => {
  it("classifica pedido de esclarecimento como warning", () => {
    expect(getWhatsAppIntentLogStatus("clarification_needed")).toBe("warning");
  });

  it("classifica demais intenções como success", () => {
    expect(getWhatsAppIntentLogStatus("water_logged")).toBe("success");
    expect(getWhatsAppIntentLogStatus("meal_item_added")).toBe("success");
  });
});
