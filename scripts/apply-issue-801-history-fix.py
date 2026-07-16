from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"Expected one match in {path}, found {count}")
    file.write_text(text.replace(old, new, 1))


replace_once(
    "server/modules/foods/catalog.ts",
    '''  const userFoodStore = new Map<number, FoodSearchItem[]>();
  const favoriteFoodStore = new Map<number, Set<number>>();
''',
    '''  const userFoodStore = new Map<number, FoodSearchItem[]>();
  const historicalUserFoodStore = new Map<number, FoodSearchItem[]>();
  const favoriteFoodStore = new Map<number, Set<number>>();
''',
)

replace_once(
    "server/modules/foods/catalog.ts",
    '''    const foods = userFoodStore.get(deprecatedUserId);
    if (foods) {
      userFoodStore.set(
        deprecatedUserId,
        foods.filter(food => food.id !== foodId)
      );
    }

    const favorites = favoriteFoodStore.get(deprecatedUserId);''',
    '''    const foods = userFoodStore.get(deprecatedUserId);
    if (foods) {
      const deprecatedFoods = foods
        .filter(food => food.id === foodId)
        .map(food => ({
          ...food,
          status: "deprecated" as const,
          isFavorite: false,
        }));
      if (deprecatedFoods.length) {
        const historicalFoods = historicalUserFoodStore.get(deprecatedUserId) ?? [];
        historicalUserFoodStore.set(deprecatedUserId, [
          ...deprecatedFoods,
          ...historicalFoods.filter(food => food.id !== foodId),
        ]);
      }
      userFoodStore.set(
        deprecatedUserId,
        foods.filter(food => food.id !== foodId)
      );
    }

    const favorites = favoriteFoodStore.get(deprecatedUserId);''',
)

replace_once(
    "server/modules/foods/catalog.ts",
    '''      const historicalFoods = [
        ...(userFoodStore.get(userId) ?? []),
        ...referenceFoods,
      ];''',
    '''      const historicalFoods = [
        ...(userFoodStore.get(userId) ?? []),
        ...(historicalUserFoodStore.get(userId) ?? []),
        ...referenceFoods,
      ];''',
)

replace_once(
    "server/modules/foods/catalog.ts",
    '''  function clearMemory(userId: number) {
    userFoodStore.delete(userId);
    favoriteFoodStore.delete(userId);''',
    '''  function clearMemory(userId: number) {
    userFoodStore.delete(userId);
    historicalUserFoodStore.delete(userId);
    favoriteFoodStore.delete(userId);''',
)

replace_once(
    "server/modules/foods/sleepKoalaRegression.test.ts",
    '''    expect(
      (await foodsService.searchFoods(7, "Sleep Koala", 20)).some(
        item => item.id === created.id
      )
    ).toBe(false);

    databaseAvailable = true;''',
    '''    expect(
      (await foodsService.searchFoods(7, "Sleep Koala", 20)).some(
        item => item.id === created.id
      )
    ).toBe(false);
    await expect(foodsService.getFoodsByIds(7, [created.id])).resolves.toEqual([
      expect.objectContaining({
        id: created.id,
        status: "deprecated",
        isFavorite: false,
      }),
    ]);

    databaseAvailable = true;''',
)

replace_once(
    "docs/design-docs/custom-foods.md",
    '''- após o commit da exclusão, stores e caches ativos removem o alimento e o favorito, mantendo apenas a referência histórica e a supressão de matching.
''',
    '''- após o commit da exclusão, stores e caches ativos removem o alimento e o favorito, mantendo a referência em store histórico separado e a supressão de matching;
- em modo sem banco, a busca ativa não consulta o store histórico, mas o lookup autorizado por ID continua disponível para refeições e relatórios anteriores.
''',
)
