import { describe, expect, it } from "vitest";
import { formatNationalPhoneNumber } from "./OnboardingPage";

describe("formatNationalPhoneNumber", () => {
  it("aplica a máscara de celular brasileira", () => {
    expect(formatNationalPhoneNumber("11999998888", "BR:55")).toBe("(11) 99999-8888");
  });

  it("aplica a máscara de telefone fixo brasileira", () => {
    expect(formatNationalPhoneNumber("1133334444", "BR:55")).toBe("(11) 3333-4444");
  });

  it("remove o código do país quando ele é informado no valor", () => {
    expect(formatNationalPhoneNumber("+55 (11) 99999-8888", "BR:55")).toBe("(11) 99999-8888");
  });

  it("mantém somente os dígitos para países sem máscara específica", () => {
    expect(formatNationalPhoneNumber("(212) 555-0123", "US:1")).toBe("2125550123");
  });
});
