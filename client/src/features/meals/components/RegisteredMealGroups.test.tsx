// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RegisteredMealGroupViewModel } from "../mealViewModels";
import type { MealItemState, StoredMeal } from "../types";
import { RegisteredMealGroups } from "./RegisteredMealGroups";

const { invalidateMock, mutateMock } = vi.hoisted(() => ({
  invalidateMock: vi.fn(),
  mutateMock: vi.fn(),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      nutrition: {
        dashboard: {
          overview: { invalidate: invalidateMock },
          today: { invalidate: invalidateMock },
        },
        meals: {
          list: { invalidate: invalidateMock },
          dayTotals: { invalidate: invalidateMock },
          favorites: { invalidate: invalidateMock },
        },
        reports: {
          weekly: { invalidate: invalidateMock },
          bundle: { invalidate: invalidateMock },
        },
      },
    }),
    nutrition: {
      meals: {
        update: { useMutation: () => ({ mutate: mutateMock, isPending: false }) },
        remove: { useMutation: () => ({ mutate: mutateMock, isPending: false }) },
      },
    },
  },
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("./RegisteredMealItemEditDialog", () => ({
  RegisteredMealItemEditDialog: () => null,
}));

afterEach(() => {
  cleanup();
});

function buildItem(foodName: string): MealItemState {
  return {
    foodName,
    canonicalName: foodName,
    portionText: "100 g",
    servings: 1,
    estimatedGrams: 100,
    calories: 120,
    protein: 5,
    carbs: 18,
    fat: 3,
    confidence: 1,
    source: "catalog",
  };
}

function buildMeal(id: number, foodName: string, occurredAt: string): StoredMeal {
  const item = buildItem(foodName);
  return {
    id,
    mealLabel: "almoço",
    occurredAt: new Date(occurredAt).getTime(),
    source: "web",
    items: [item],
    totals: {
      calories: item.calories,
      protein: item.protein,
      carbs: item.carbs,
      fat: item.fat,
    },
  };
}

function buildGroup(): RegisteredMealGroupViewModel {
  const firstMeal = buildMeal(10, "Arroz", "2026-05-21T12:00:00.000Z");
  const secondMeal = buildMeal(11, "Iogurte", "2026-05-21T14:00:00.000Z");

  return {
    mealLabel: "almoço",
    meals: [firstMeal, secondMeal],
    records: [firstMeal, secondMeal].map(meal => ({
      meal,
      items: meal.items.map((item, itemIndex) => ({
        meal,
        item,
        itemIndex,
        registeredAt: meal.occurredAt,
        mealLabel: "almoço",
      })),
      registeredAt: meal.occurredAt,
      mealLabel: "almoço",
      totals: meal.totals,
    })),
    items: [
      {
        meal: firstMeal,
        item: firstMeal.items[0],
        itemIndex: 0,
        registeredAt: firstMeal.occurredAt,
        mealLabel: "almoço",
      },
      {
        meal: secondMeal,
        item: secondMeal.items[0],
        itemIndex: 0,
        registeredAt: secondMeal.occurredAt,
        mealLabel: "almoço",
      },
    ],
    totals: {
      calories: firstMeal.totals.calories + secondMeal.totals.calories,
      protein: firstMeal.totals.protein + secondMeal.totals.protein,
      carbs: firstMeal.totals.carbs + secondMeal.totals.carbs,
      fat: firstMeal.totals.fat + secondMeal.totals.fat,
    },
  };
}

describe("RegisteredMealGroups", () => {
  it("aciona os callbacks de grupo no cabeçalho sem escolher a refeição mais recente", async () => {
    const user = userEvent.setup();
    const group = buildGroup();
    const onEditMeal = vi.fn();
    const onEditMealGroup = vi.fn();
    const onCopyMealGroup = vi.fn();
    const onFavoriteMealGroup = vi.fn();
    const onRemoveMealGroup = vi.fn();

    render(
      <RegisteredMealGroups
        groups={[group]}
        userTimeZone="America/Sao_Paulo"
        selectedMealId={group.meals[1].id}
        emptyMessage="Sem registros"
        onEditMeal={onEditMeal}
        onEditMealGroup={onEditMealGroup}
        onCopyMealGroup={onCopyMealGroup}
        onFavoriteMealGroup={onFavoriteMealGroup}
        onRemoveMealGroup={onRemoveMealGroup}
      />,
    );

    await user.click(screen.getByRole("button", { name: /editando/i }));
    await user.click(screen.getByRole("button", { name: /copiar/i }));
    await user.click(screen.getByRole("button", { name: /favorita/i }));
    await user.click(screen.getByRole("button", { name: /excluir refeição/i }));

    expect(onEditMeal).not.toHaveBeenCalled();
    expect(onEditMealGroup).toHaveBeenCalledWith(group);
    expect(onCopyMealGroup).toHaveBeenCalledWith(group);
    expect(onFavoriteMealGroup).toHaveBeenCalledWith(group);
    expect(onRemoveMealGroup).toHaveBeenCalledWith(group);
  });

  it("mantem clique em alimento como edição individual do item correto", async () => {
    const user = userEvent.setup();
    const group = buildGroup();
    const onEditMealGroup = vi.fn();
    const onEditMealItem = vi.fn();

    render(
      <RegisteredMealGroups
        groups={[group]}
        userTimeZone="America/Sao_Paulo"
        emptyMessage="Sem registros"
        onEditMealGroup={onEditMealGroup}
        onEditMealItem={onEditMealItem}
      />,
    );

    await user.click(screen.getByRole("button", { name: /editar alimento arroz/i }));

    expect(onEditMealGroup).not.toHaveBeenCalled();
    expect(onEditMealItem).toHaveBeenCalledWith(group.meals[0], 0);
  });
});
