export function parsePositiveQuantityInput(value: string) {
  const normalized = value.trim().replace(",", ".");
  if (!normalized) {
    return null;
  }

  const quantity = Number(normalized);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : null;
}
