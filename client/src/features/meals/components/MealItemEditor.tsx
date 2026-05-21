import React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import type { MealItemState } from "../types";

type MealItemEditorProps = {
  item: MealItemState;
  onChange: <K extends keyof MealItemState>(key: K, value: MealItemState[K]) => void;
};

export function MealItemEditor({ item, onChange }: MealItemEditorProps) {
  const foods = trpc.nutrition.foods.search.useQuery(
    { query: item.foodName, limit: 5 },
    { enabled: item.foodName.trim().length >= 2 },
  );

  const applyFood = (food: NonNullable<typeof foods.data>[number]) => {
    onChange("foodName", food.name);
    onChange("canonicalName", food.name);
    onChange("portionText", `${food.servingSize} ${food.servingUnit}`);
    onChange("servings", 1);
    onChange("estimatedGrams", food.servingUnit === "g" ? food.servingSize : 0);
    onChange("calories", food.calories);
    onChange("protein", food.protein);
    onChange("carbs", food.carbs);
    onChange("fat", food.fat);
    onChange("confidence", 1);
    onChange("source", "catalog");
  };

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <div className="space-y-2">
        <Label>Alimento</Label>
        <Input value={item.foodName} onChange={event => onChange("foodName", event.target.value)} />
        {foods.data?.length ? (
          <div className="flex flex-wrap gap-2">
            {foods.data.map(food => (
              <Button key={food.id} type="button" variant="outline" size="sm" className="h-8 rounded-full" onClick={() => applyFood(food)}>
                {food.name}
              </Button>
            ))}
          </div>
        ) : null}
      </div>
      <div className="space-y-2">
        <Label>Nome canônico</Label>
        <Input value={item.canonicalName} onChange={event => onChange("canonicalName", event.target.value)} />
      </div>
      <div className="space-y-2">
        <Label>Unidade</Label>
        <Input value={item.portionText} onChange={event => onChange("portionText", event.target.value)} />
      </div>
      <div className="space-y-2">
        <Label>Quantidade</Label>
        <Input type="number" value={item.estimatedGrams} onChange={event => onChange("estimatedGrams", Number(event.target.value))} />
      </div>
      <div className="space-y-2">
        <Label>Calorias</Label>
        <Input type="number" value={item.calories} onChange={event => onChange("calories", Number(event.target.value))} />
      </div>
      <div className="space-y-2">
        <Label>Proteínas</Label>
        <Input type="number" value={item.protein} onChange={event => onChange("protein", Number(event.target.value))} />
      </div>
      <div className="space-y-2">
        <Label>Carboidratos</Label>
        <Input type="number" value={item.carbs} onChange={event => onChange("carbs", Number(event.target.value))} />
      </div>
      <div className="space-y-2">
        <Label>Gorduras</Label>
        <Input type="number" value={item.fat} onChange={event => onChange("fat", Number(event.target.value))} />
      </div>
    </div>
  );
}
