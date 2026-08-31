export const BILLING_ADMIN_MUTATION_ERROR_MESSAGES = {
  createProduct: "Não foi possível criar o produto. Revise os dados e tente novamente.",
  createVersion: "Não foi possível criar a versão. Revise os dados e tente novamente.",
  createCoupon: "Não foi possível criar o cupom. Revise os dados e tente novamente.",
  publishVersion: "Não foi possível publicar a versão. Tente novamente.",
  deactivateVersion: "Não foi possível encerrar a versão. Tente novamente.",
  deactivateCoupon: "Não foi possível desativar o cupom. Tente novamente.",
} as const;

export type BillingAdminMutationErrorKey = keyof typeof BILLING_ADMIN_MUTATION_ERROR_MESSAGES;

export function billingAdminMutationErrorMessage(
  key: BillingAdminMutationErrorKey,
  _providerError: unknown
) {
  return BILLING_ADMIN_MUTATION_ERROR_MESSAGES[key];
}
