import { describe, expect, it } from "vitest";
import {
  BILLING_ADMIN_MUTATION_ERROR_MESSAGES,
  billingAdminMutationErrorMessage,
} from "./billingAdminMutationErrors";

describe("billingAdminMutationErrorMessage", () => {
  it.each([
    ["createProduct", "Não foi possível criar o produto."],
    ["createVersion", "Não foi possível criar a versão."],
    ["createCoupon", "Não foi possível criar o cupom."],
  ] as const)("mantém erros de %s acionáveis em pt-BR", (key, expected) => {
    const message = billingAdminMutationErrorMessage(
      key,
      new Error("synthetic provider validation failure")
    );

    expect(message).toContain(expected);
    expect(message).not.toContain("synthetic");
    expect(message).not.toContain("provider validation failure");
  });

  it("também protege ações sensíveis contra mensagens técnicas do provider", () => {
    for (const key of ["publishVersion", "deactivateVersion", "deactivateCoupon"] as const) {
      expect(
        billingAdminMutationErrorMessage(key, new Error("upstream exploded"))
      ).toBe(BILLING_ADMIN_MUTATION_ERROR_MESSAGES[key]);
    }
  });
});
