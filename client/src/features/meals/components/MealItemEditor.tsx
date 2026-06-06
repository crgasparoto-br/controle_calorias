import React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { MEASUREMENT_UNIT_SUGGESTIONS, normalizeMeasurementUnit } from "@/shared/measurementUnits";
import type { MealItemState } from "../types";

type MealItemEditorProps = {
  item: MealItemState;
  onChange: <K extends keyof MealItemState>(key: K, value: MealItemState[K]) => void;
};

function parseQuantityFromPortionText(portionText: string) {
  const match = portionText.trim().match(/^(\d+(?:[,.]\d+)?)/u);
  if (!match) {
    return null;
  }

  const value = Number(match[1].replace(",", "."));
  return Number.isFinite(value) && value > 0 ? value : null;
}

function deriveUnitFromPortionText(portionText: string) {
  const normalized = portionText
    .trim()
    .replace(/^\d+(?:[,.]\d+)?\s*/u, "")
    .trim();

  return normalized || "porção";
}

function formatQuantity(value: number) {
  return Number.isInteger(value) ? String(value) : String(value).replace(".", ",");
}

function normalizeUnitInput(value: string) {
  return normalizeMeasurementUnit(value.replace(/^\d+(?:[,.]\d+)?\s*/u, ""));
}

export function MealItemEditor({ item, onChange }: MealItemEditorProps) {
  const unitListId = React.useId();
  const quantity = item.quantity ?? parseQuantityFromPortionText(item.portionText) ?? item.servings;
  const unit = item.unit?.trim() || deriveUnitFromPortionText(item.portionText);
  const equivalenceText = item.estimatedGrams > 0
    ? `equivale a ${formatQuantity(item.estimatedGrams)} g`
    : null;
  const foods = trpc.nutrition.foods.search.useQuery(
    { query: item.foodName, limit: 5 },
    { enabled: item.foodName.trim().length >= 2 },
  );
  const hasFoodSwap =
    item.foodName.trim().length > 0 &&
    item.canonicalName.trim().length > 0 &&
    item.foodName.trim().toLocaleLowerCase("pt-BR") !== item.canonicalName.trim().toLocaleLowerCase("pt-BR");

  const updateQuantityAndUnit = (nextQuantity: number, nextUnit: string) => {
    const safeQuantity = Number.isFinite(nextQuantity) && nextQuantity > 0 ? nextQuantity : 1;
    const safeUnit = normalizeUnitInput(nextUnit) || "porção";

    onChange("quantity", safeQuantity);
    onChange("unit", safeUnit);
    onChange("portionText", `${formatQuantity(safeQuantity)} ${safeUnit}`);

    if (["g", "ml"].includes(safeUnit)) {
      onChange("estimatedGrams", safeQuantity);
    }
  };

  const applyFood = (food: NonNullable<typeof foods.data>[number]) => {
    const nextUnit = normalizeUnitInput(food.servingUnit || "porção") || "porção";

    onChange("foodName", food.name);
    onChange("canonicalName", food.name);
    onChange("quantity", food.servingSize);
    onChange("unit", nextUnit);
    onChange("portionText", `${formatQuantity(food.servingSize)} ${nextUnit}`);
    onChange("servings", 1);
    onChange("estimatedGrams", ["g", "ml"].includes(nextUnit) ? food.servingSize : 0);
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
          <Label>Quantidade</Label>
          <Input
            type="number"
            min="0.1"
            step="0.1"
            value={quantity}
            onChange={event => updateQuantityAndUnit(Number(event.target.value), unit)}
          />
          {equivalenceText ? <p className="text-xs text-muted-foreground">{equivalenceText}</p> : null}
        </div>
        <div className="space-y-2 xl:col-span-2">
          <Label>Unidade de medida</Label>
          <Input
            list={unitListId}
            value={unit}
            onChange={event => updateQuantityAndUnit(quantity, event.target.value)}
            onBlur={event => updateQuantityAndUnit(quantity, event.target.value)}
            placeholder="Ex.: g, ml, fatia, lata"
          />
          <datalist id={unitListId}>
            {MEASUREMENT_UNIT_SUGGESTIONS.map(suggestion => (
              <option key={suggestion} value={suggestion} />
            ))}
          </datalist>
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
