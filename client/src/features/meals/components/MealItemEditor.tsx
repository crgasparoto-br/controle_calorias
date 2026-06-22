import React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { MEASUREMENT_UNIT_SUGGESTIONS, normalizeMeasurementUnit } from "@shared/measurementUnits";
import { recalculateMealItemQuantityUnit } from "../mealFormState";
import type { MealItemState } from "../types";
import { parsePositiveQuantityInput } from "./quantityInput";

type MealItemEditorProps = {
  item: MealItemState;
  onChange: <K extends keyof MealItemState>(key: K, value: MealItemState[K]) => void;
};

type CatalogPortion = {
  id: number;
  label: string;
  unit: string;
  quantity: number;
  grams: number;
  isDefault: boolean;
};

type CatalogFood = {
  id: number;
  scope: "global" | "user";
  name: string;
  nutrientsPer100g: {
    caloriesKcal: number;
    proteinGrams: number;
    carbsGrams: number;
    fatGrams: number;
  };
  portions: CatalogPortion[];
};

function roundNutrition(value: number) {
  return Math.round(value * 100) / 100;
}

function calculateMacros(food: CatalogFood, grams: number) {
  const factor = grams / 100;
  return {
    calories: roundNutrition(food.nutrientsPer100g.caloriesKcal * factor),
    protein: roundNutrition(food.nutrientsPer100g.proteinGrams * factor),
    carbs: roundNutrition(food.nutrientsPer100g.carbsGrams * factor),
    fat: roundNutrition(food.nutrientsPer100g.fatGrams * factor),
  };
}

function portionLabel(quantity: number, portion: CatalogPortion) {
  return `${quantity} ${portion.label}`;
}

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
  const catalogFoods = trpc.nutrition.foods.catalogSearch.useQuery(
    { query: item.foodName, limit: 6 },
    { enabled: item.foodName.trim().length >= 2 },
  );
  const selectedCatalogFood = catalogFoods.data?.find(food => food.id === item.foodId) as CatalogFood | undefined;
  const selectedPortion = selectedCatalogFood?.portions.find(portion => portion.id === item.portionId);
  const [quantityInput, setQuantityInput] = React.useState(() => formatQuantity(quantity));
  const [portionQuantityInput, setPortionQuantityInput] = React.useState(() => formatQuantity(item.portionQuantity ?? item.servings));
  const hasFoodSwap =
    item.foodName.trim().length > 0 &&
    item.canonicalName.trim().length > 0 &&
    item.foodName.trim().toLocaleLowerCase("pt-BR") !== item.canonicalName.trim().toLocaleLowerCase("pt-BR");

  React.useEffect(() => {
    setQuantityInput(formatQuantity(quantity));
  }, [quantity]);

  React.useEffect(() => {
    setPortionQuantityInput(formatQuantity(item.portionQuantity ?? item.servings));
  }, [item.portionQuantity, item.servings]);

  const applyCatalogNutrition = (food: CatalogFood, grams: number) => {
    const macros = calculateMacros(food, grams);
    onChange("estimatedGrams", grams);
    onChange("quantity", grams);
    onChange("unit", "g");
    onChange("portionText", `${formatQuantity(grams)} g`);
    onChange("calories", macros.calories);
    onChange("protein", macros.protein);
    onChange("carbs", macros.carbs);
    onChange("fat", macros.fat);
  };

  const applyCatalogFood = (food: CatalogFood) => {
    const defaultPortion = food.portions.find(portion => portion.isDefault) ?? food.portions[0];
    const grams = defaultPortion?.grams ?? 100;

    onChange("foodId", food.id);
    onChange("portionId", defaultPortion?.id);
    onChange("portionQuantity", defaultPortion ? 1 : undefined);
    onChange("foodName", food.name);
    onChange("canonicalName", food.name);
    onChange("quantity", defaultPortion ? 1 : grams);
    onChange("unit", defaultPortion ? normalizeUnitInput(defaultPortion.unit || defaultPortion.label) : "g");
    onChange("portionText", defaultPortion ? portionLabel(1, defaultPortion) : `${formatQuantity(grams)} g`);
    onChange("servings", 1);

    applyCatalogNutrition(food, grams);
  };

  const updateQuantityAndUnit = (nextQuantity: number, nextUnit: string) => {
    const updatedItem = recalculateMealItemQuantityUnit(item, nextQuantity, nextUnit);

    onChange("quantity", updatedItem.quantity);
    onChange("unit", updatedItem.unit);
    onChange("portionText", updatedItem.portionText);
    onChange("servings", updatedItem.servings);
    onChange("estimatedGrams", updatedItem.estimatedGrams);
    onChange("calories", updatedItem.calories);
    onChange("protein", updatedItem.protein);
    onChange("carbs", updatedItem.carbs);
    onChange("fat", updatedItem.fat);
  };

  const applyPortion = (portion: CatalogPortion, quantity = 1) => {
    if (!selectedCatalogFood) return;
    const grams = roundNutrition((portion.grams * quantity) / (portion.quantity || 1));

    onChange("portionId", portion.id);
    onChange("portionQuantity", quantity);
    onChange("quantity", quantity);
    onChange("unit", normalizeUnitInput(portion.unit || portion.label) || "porção");
    onChange("portionText", portionLabel(quantity, portion));
    onChange("servings", quantity);
    applyCatalogNutrition(selectedCatalogFood, grams);
  };

  const handleManualQuantityChange = (nextQuantity: number) => {
    updateQuantityAndUnit(nextQuantity, unit);
    onChange("portionId", undefined);
    onChange("portionQuantity", undefined);
    if (selectedCatalogFood) {
      const normalizedUnit = normalizeMeasurementUnit(unit);
      if (["g", "ml"].includes(normalizedUnit) && nextQuantity > 0) {
        applyCatalogNutrition(selectedCatalogFood, nextQuantity);
      }
    }
  };

  const handleManualQuantityInputChange = (value: string) => {
    setQuantityInput(value);
    const nextQuantity = parsePositiveQuantityInput(value);
    if (nextQuantity === null) {
      return;
    }

    handleManualQuantityChange(nextQuantity);
  };

  const handlePortionQuantityChange = (quantity: number) => {
    if (!selectedPortion) return;
    applyPortion(selectedPortion, quantity);
  };

  const handlePortionQuantityInputChange = (value: string) => {
    setPortionQuantityInput(value);
    const nextQuantity = parsePositiveQuantityInput(value);
    if (nextQuantity === null) {
      return;
    }

    handlePortionQuantityChange(nextQuantity);
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label>Alimento</Label>
            {item.foodId ? <Badge variant="secondary">Catálogo</Badge> : null}
          </div>
          <Input
            value={item.foodName}
            onChange={event => {
              onChange("foodName", event.target.value);
              onChange("foodId", undefined);
              onChange("portionId", undefined);
              onChange("portionQuantity", undefined);
              onChange("source", "heuristic");
            }}
            placeholder="Busque no catálogo: arroz, banana, pão..."
          />
          {catalogFoods.isLoading ? (
            <p className="text-xs text-muted-foreground">Buscando alimentos...</p>
          ) : catalogFoods.data?.length ? (
            <div className="grid gap-2">
              {catalogFoods.data.map(food => {
                const catalogFood = food as CatalogFood;
                return (
                  <Button
                    key={catalogFood.id}
                    type="button"
                    variant={item.foodId === catalogFood.id ? "default" : "outline"}
                    className="h-auto justify-start rounded-2xl px-3 py-2 text-left"
                    onClick={() => applyCatalogFood(catalogFood)}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{catalogFood.name}</span>
                      <span className="block text-xs opacity-80">
                        {catalogFood.scope === "global" ? "Global" : "Personalizado"} · {catalogFood.nutrientsPer100g.caloriesKcal} kcal/100 g
                      </span>
                    </span>
                  </Button>
                );
              })}
            </div>
          ) : item.foodName.trim().length >= 2 ? (
            <p className="text-xs text-muted-foreground">Nenhum alimento do catálogo encontrado para esta busca.</p>
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

      {selectedCatalogFood?.portions.length ? (
        <div className="space-y-3 rounded-2xl border bg-muted/20 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-medium tracking-tight">Porções cadastradas</p>
              <p className="text-xs text-muted-foreground">Escolha uma medida caseira ou ajuste a quantidade.</p>
            </div>
            {selectedPortion ? <Badge variant="outline">{selectedPortion.grams} g base</Badge> : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {selectedCatalogFood.portions.map(portion => (
              <Button
                key={portion.id}
                type="button"
                size="sm"
                variant={item.portionId === portion.id ? "default" : "outline"}
                className="h-8 rounded-full"
                onClick={() => applyPortion(portion)}
              >
                {portion.label} · {portion.grams} g
              </Button>
            ))}
          </div>
          {selectedPortion ? (
            <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
              <div className="space-y-2">
                <Label>Quantidade</Label>
                <Input
                  type="text"
                  inputMode="decimal"
                  value={portionQuantityInput}
                  onChange={event => handlePortionQuantityInputChange(event.target.value)}
                />
              </div>
              <div className="rounded-xl bg-background px-3 py-2 text-sm text-muted-foreground">
                <p className="font-medium text-foreground">{item.portionText}</p>
                <p>{item.estimatedGrams} g finais para cálculo nutricional.</p>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <div className="space-y-2">
          <Label>Quantidade</Label>
          <Input
            type="text"
            inputMode="decimal"
            value={quantityInput}
            onChange={event => handleManualQuantityInputChange(event.target.value)}
          />
          {equivalenceText ? <p className="text-xs text-muted-foreground">{equivalenceText}</p> : null}
        </div>
        <div className="space-y-2 xl:col-span-2">
          <Label>Unidade de medida</Label>
          <Input
            list={unitListId}
            value={unit}
            onChange={event => updateQuantityAndUnit(parsePositiveQuantityInput(quantityInput) ?? quantity, event.target.value)}
            onBlur={event => updateQuantityAndUnit(parsePositiveQuantityInput(quantityInput) ?? quantity, event.target.value)}
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
