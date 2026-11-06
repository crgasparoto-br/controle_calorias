const MEAL_MUTATION_PRE_IMAGE = Symbol.for(
  "controle_calorias.mealMutationPreImage"
);

export function getMealMutationPreImage(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const token = (value as Record<PropertyKey, unknown>)[
    MEAL_MUTATION_PRE_IMAGE
  ];
  return typeof token === "string" ? token : null;
}

export function attachMealMutationPreImage<T extends object>(
  value: T,
  token: unknown
): T {
  if (typeof token !== "string") return value;
  Object.defineProperty(value, MEAL_MUTATION_PRE_IMAGE, {
    value: token,
    enumerable: false,
    configurable: false,
  });
  return value;
}
