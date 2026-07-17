const deprecatedIdsByUser = new Map<number, Set<number>>();
const deprecatedKeysByUser = new Map<number, Set<string>>();

type DeprecatedFoodCleanup = (userId: number, foodId: number) => void;
const deprecatedFoodCleanups = new Set<DeprecatedFoodCleanup>();

export function registerDeprecatedFoodCleanup(cleanup: DeprecatedFoodCleanup) {
  deprecatedFoodCleanups.add(cleanup);
  return () => deprecatedFoodCleanups.delete(cleanup);
}

function normalizeIdentity(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s-]/g, "")
    .toLowerCase()
    .trim();
}

export function registerDeprecatedFood(
  userId: number,
  foodId: number,
  identities: Array<string | null | undefined>
) {
  const ids = new Set(deprecatedIdsByUser.get(userId) ?? []);
  ids.add(foodId);
  deprecatedIdsByUser.set(userId, ids);

  const keys = new Set(deprecatedKeysByUser.get(userId) ?? []);
  for (const identity of identities) {
    const key = normalizeIdentity(identity ?? "");
    if (key) keys.add(key);
  }
  deprecatedKeysByUser.set(userId, keys);

  for (const cleanup of deprecatedFoodCleanups) {
    cleanup(userId, foodId);
  }
}

export function isFoodDeprecatedInMemory(userId: number, foodId: number) {
  return deprecatedIdsByUser.get(userId)?.has(foodId) ?? false;
}

export function getDeprecatedIdentityKeys(userId: number) {
  return new Set(deprecatedKeysByUser.get(userId) ?? []);
}

export function clearDeprecatedFoodRegistry(userId: number) {
  deprecatedIdsByUser.delete(userId);
  deprecatedKeysByUser.delete(userId);
}
