import React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDateTimeInTimeZone } from "@/lib/dateTime";
import { formatCalories, formatGrams } from "@/lib/numberFormat";
import type { RegisteredMealGroupViewModel, RegisteredMealItemViewModel, RegisteredMealRecordViewModel } from "../mealViewModels";
import type { MealType, StoredMeal } from "../types";
import { Copy, PencilLine, Star, Trash2 } from "lucide-react";

type RegisteredMealGroupsProps = {
  groups: RegisteredMealGroupViewModel[];
  userTimeZone: string;
  selectedMealId?: number;
  emptyMessage: string;
  isCopyPending?: boolean;
  isFavoritePending?: boolean;
  isRemovePending?: boolean;
  onEditMeal: (meal: StoredMeal) => void;
  onCopyMeal: (meal: StoredMeal, mealLabel: MealType) => void;
  onFavoriteMeal: (meal: StoredMeal) => void;
  onRemoveMeal: (meal: StoredMeal) => void;
  renderEditingForm?: (meal: StoredMeal) => React.ReactNode;
};

function FoodImage({ record }: { record: RegisteredMealRecordViewModel }) {
  if (!record.imageUrl) {
    return null;
  }

  return (
    <img
      src={record.imageUrl}
      alt={`Foto da refeição ${record.mealLabel}`}
      className="h-20 w-20 rounded-2xl border object-cover"
      loading="lazy"
    />
  );
}

function NutritionBadge({ label, value }: { label: string; value: string }) {
  return (
    <span className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
      <strong className="text-foreground">{label}:</strong> {value}
    </span>
  );
}

function MealTotalsRow({ record }: { record: RegisteredMealRecordViewModel }) {
  return (
    <div className="flex flex-wrap gap-2">
      <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">{formatCalories(record.totals.calories)}</Badge>
      <Badge variant="outline">P {formatGrams(record.totals.protein)}</Badge>
      <Badge variant="outline">C {formatGrams(record.totals.carbs)}</Badge>
      <Badge variant="outline">G {formatGrams(record.totals.fat)}</Badge>
    </div>
  );
}

function MealFoodRow({ item, userTimeZone }: { item: RegisteredMealItemViewModel; userTimeZone: string }) {
  return (
    <div className="rounded-2xl border bg-background/70 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-medium tracking-tight">{item.item.foodName}</p>
          <p className="text-sm text-muted-foreground">
            {formatDateTimeInTimeZone(item.registeredAt, userTimeZone)} · {item.item.portionText}
          </p>
        </div>
        <Badge variant="secondary">{formatCalories(item.item.calories)}</Badge>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <NutritionBadge label="Proteínas" value={formatGrams(item.item.protein)} />
        <NutritionBadge label="Carboidratos" value={formatGrams(item.item.carbs)} />
        <NutritionBadge label="Gorduras" value={formatGrams(item.item.fat)} />
        <NutritionBadge label="Qtd." value={formatGrams(item.item.estimatedGrams)} />
      </div>
    </div>
  );
}

export function RegisteredMealGroups({
  groups,
  userTimeZone,
  selectedMealId,
  emptyMessage,
  isCopyPending,
  isFavoritePending,
  isRemovePending,
  onEditMeal,
  onCopyMeal,
  onFavoriteMeal,
  onRemoveMeal,
  renderEditingForm,
}: RegisteredMealGroupsProps) {
  if (!groups.length) {
    return (
      <div className="rounded-2xl border border-dashed bg-muted/20 p-6 text-sm leading-6 text-muted-foreground">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {groups.map(group => (
        <section key={group.mealLabel} className="rounded-3xl border bg-background p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-lg font-semibold capitalize tracking-tight">{group.mealLabel}</p>
              <p className="text-sm text-muted-foreground">
                {group.records.length} {group.records.length === 1 ? "refeição" : "refeições"} · {group.items.length} alimento{group.items.length === 1 ? "" : "s"}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">{formatCalories(group.totals.calories)}</Badge>
              <Badge variant="outline">P {formatGrams(group.totals.protein)}</Badge>
              <Badge variant="outline">C {formatGrams(group.totals.carbs)}</Badge>
              <Badge variant="outline">G {formatGrams(group.totals.fat)}</Badge>
            </div>
          </div>

          <div className="mt-4 space-y-3">
            {group.records.map(record => (
              <div key={record.meal.id} className="rounded-2xl border bg-muted/10 p-4">
                <div className="flex flex-col gap-4 md:flex-row md:items-start">
                  <FoodImage record={record} />
                  <div className="min-w-0 flex-1 space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-medium tracking-tight">{formatDateTimeInTimeZone(record.registeredAt, userTimeZone)}</p>
                        {record.mealNotes ? <p className="mt-1 text-sm text-muted-foreground">{record.mealNotes}</p> : null}
                      </div>
                      <MealTotalsRow record={record} />
                    </div>

                    <div className="space-y-3">
                      {record.items.map(item => (
                        <MealFoodRow
                          key={`${record.meal.id}-${item.item.foodName}-${item.itemIndex}`}
                          item={item}
                          userTimeZone={userTimeZone}
                        />
                      ))}
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-3">
                  <Button type="button" variant={selectedMealId === record.meal.id ? "default" : "outline"} className="rounded-full" onClick={() => onEditMeal(record.meal)}>
                    <PencilLine className="mr-2 h-4 w-4" />
                    {selectedMealId === record.meal.id ? "Editando esta refeição" : "Editar refeição"}
                  </Button>
                  <Button type="button" variant="outline" className="rounded-full" onClick={() => onCopyMeal(record.meal, record.mealLabel)} disabled={isCopyPending}>
                    <Copy className="mr-2 h-4 w-4" />
                    Copiar para o dia
                  </Button>
                  <Button type="button" variant="outline" className="rounded-full" onClick={() => onFavoriteMeal(record.meal)} disabled={isFavoritePending}>
                    <Star className="mr-2 h-4 w-4" />
                    Salvar favorita
                  </Button>
                  <Button type="button" variant="ghost" className="rounded-full text-destructive hover:text-destructive" onClick={() => onRemoveMeal(record.meal)} disabled={isRemovePending}>
                    <Trash2 className="mr-2 h-4 w-4" />
                    Excluir refeição
                  </Button>
                </div>

                {selectedMealId === record.meal.id && renderEditingForm ? (
                  <div className="mt-5 rounded-3xl border border-primary/30 bg-primary/5 p-3">
                    {renderEditingForm(record.meal)}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
