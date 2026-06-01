import React from "react";
import { Badge } from "@/components/ui/badge";
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
  const hasFoodSwap =
    item.foodName.trim().length > 0 &&
    item.canonicalName.trim().length > 0 &&
    item.foodName.trim().toLocaleLowerCase("pt-BR") !== item.canonicalName.trim().toLocaleLowerCase("pt-BR");

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
    <div className="space-y-4">
      <div className="grid gap-3 xl:grid-cols-[1.15fr_0.85fr]">
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
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label>Nome canônico</Label>
            {hasFoodSwap ? <Badge variant="secondary" className="bg-amber-100 text-amber-900 hover:bg-amber-100">Troca detectada</Badge> : null}
          </div>
          <Input value={item.canonicalName} onChange={event => onChange("canonicalName", event.target.value)} />
        </div>
      </div>

      {hasFoodSwap ? (
        <div className="grid gap-2 rounded-2xl border border-amber-200 bg-amber-50/70 p-3 text-sm sm:grid-cols-2">
          <div className="rounded-xl bg-background/90 px-3 py-2">
            <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-amber-900/80">Início da troca</p>
            <p className="font-medium text-foreground">{item.foodName}</p>
          </div>
          <div className="rounded-xl bg-background/90 px-3 py-2">
            <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-amber-900/80">Fim da troca</p>
            <p className="font-medium text-foreground">{item.canonicalName}</p>
          </div>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
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
    </div>
  );
}
