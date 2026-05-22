import React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { formatCalories, formatGrams } from "@/lib/numberFormat";
import type { RegisteredMealGroupViewModel, RegisteredMealItemViewModel, RegisteredMealRecordViewModel } from "../mealViewModels";
import type { MealType, StoredMeal } from "../types";
import { ChevronDown, Copy, PencilLine, Star, Trash2 } from "lucide-react";

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

function formatDateLabel(value: number, timeZone: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    dateStyle: "short",
  }).format(new Date(value));
}

function formatTimeLabel(value: number, timeZone: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    timeStyle: "short",
  }).format(new Date(value));
}

function describeMealCount(count: number) {
  return `${count} ${count === 1 ? "refeição" : "refeições"}`;
}

function describeFoodCount(count: number) {
  return `${count} alimento${count === 1 ? "" : "s"}`;
}

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
    <span className="shrink-0 rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
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

function MealFoodRow({
  item,
  record,
  userTimeZone,
  isSelected,
  onEditMeal,
}: {
  item: RegisteredMealItemViewModel;
  record: RegisteredMealRecordViewModel;
  userTimeZone: string;
  isSelected: boolean;
  onEditMeal: (meal: StoredMeal) => void;
}) {
  const portionLabel = item.item.portionText.trim() || formatGrams(item.item.estimatedGrams);

  return (
    <button
      type="button"
      onClick={() => onEditMeal(record.meal)}
      className={[
        "w-full rounded-2xl border px-3 py-3 text-left transition",
        isSelected ? "border-primary/40 bg-primary/5" : "bg-background/70 hover:border-primary/40 hover:bg-primary/5",
      ].join(" ")}
    >
      <div className="flex items-center gap-3 overflow-x-auto whitespace-nowrap text-sm">
        <span className="shrink-0 font-medium text-foreground">{formatTimeLabel(item.registeredAt, userTimeZone)}</span>
        <span className="shrink-0 text-muted-foreground">{portionLabel}</span>
        <span className="min-w-fit font-medium tracking-tight text-foreground">{item.item.foodName}</span>
        <span className="shrink-0 rounded-full bg-muted px-3 py-1 text-xs font-medium text-foreground">{formatCalories(item.item.calories)}</span>
        <NutritionBadge label="Proteínas" value={formatGrams(item.item.protein)} />
        <NutritionBadge label="Carboidratos" value={formatGrams(item.item.carbs)} />
        <NutritionBadge label="Gorduras" value={formatGrams(item.item.fat)} />
        <NutritionBadge label="Qtd." value={formatGrams(item.item.estimatedGrams)} />
      </div>
    </button>
  );
}

function RegisteredMealGroupSection({
  group,
  userTimeZone,
  selectedMealId,
  isCopyPending,
  isFavoritePending,
  isRemovePending,
  onEditMeal,
  onCopyMeal,
  onFavoriteMeal,
  onRemoveMeal,
  renderEditingForm,
}: {
  group: RegisteredMealGroupViewModel;
  userTimeZone: string;
  selectedMealId?: number;
  isCopyPending?: boolean;
  isFavoritePending?: boolean;
  isRemovePending?: boolean;
  onEditMeal: (meal: StoredMeal) => void;
  onCopyMeal: (meal: StoredMeal, mealLabel: MealType) => void;
  onFavoriteMeal: (meal: StoredMeal) => void;
  onRemoveMeal: (meal: StoredMeal) => void;
  renderEditingForm?: (meal: StoredMeal) => React.ReactNode;
}) {
  const referenceDate = group.records[0]?.registeredAt;

  return (
    <Collapsible defaultOpen>
      <section className="rounded-3xl border bg-background shadow-sm">
        <CollapsibleTrigger asChild>
          <button type="button" className="group flex w-full flex-wrap items-center justify-between gap-3 p-4 text-left">
            <div className="min-w-0 flex items-center gap-3 overflow-x-auto whitespace-nowrap">
              <p className="shrink-0 text-lg font-semibold capitalize tracking-tight">{group.mealLabel}</p>
              {referenceDate ? <span className="shrink-0 text-sm text-muted-foreground">{formatDateLabel(referenceDate, userTimeZone)}</span> : null}
              <span className="shrink-0 text-sm text-muted-foreground">{describeMealCount(group.records.length)}</span>
              <span className="shrink-0 text-sm text-muted-foreground">{describeFoodCount(group.items.length)}</span>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">{formatCalories(group.totals.calories)}</Badge>
              <Badge variant="outline">P {formatGrams(group.totals.protein)}</Badge>
              <Badge variant="outline">C {formatGrams(group.totals.carbs)}</Badge>
              <Badge variant="outline">G {formatGrams(group.totals.fat)}</Badge>
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
            </div>
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent className="border-t bg-muted/10 px-4 pb-4 pt-4">
          <div className="space-y-3">
            {group.records.map(record => (
              <div key={record.meal.id} className="rounded-2xl border bg-background p-4">
                <div className="flex flex-col gap-4 md:flex-row md:items-start">
                  <FoodImage record={record} />
                  <div className="min-w-0 flex-1 space-y-3">
                    {record.mealNotes ? <p className="text-sm text-muted-foreground">{record.mealNotes}</p> : null}

                    <div className="space-y-2">
                      {record.items.map(item => (
                        <MealFoodRow
                          key={`${record.meal.id}-${item.item.foodName}-${item.itemIndex}`}
                          item={item}
                          record={record}
                          userTimeZone={userTimeZone}
                          isSelected={selectedMealId === record.meal.id}
                          onEditMeal={onEditMeal}
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
        </CollapsibleContent>
      </section>
    </Collapsible>
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
        <RegisteredMealGroupSection
          key={group.mealLabel}
          group={group}
          userTimeZone={userTimeZone}
          selectedMealId={selectedMealId}
          isCopyPending={isCopyPending}
          isFavoritePending={isFavoritePending}
          isRemovePending={isRemovePending}
          onEditMeal={onEditMeal}
          onCopyMeal={onCopyMeal}
          onFavoriteMeal={onFavoriteMeal}
          onRemoveMeal={onRemoveMeal}
          renderEditingForm={renderEditingForm}
        />
      ))}
    </div>
  );
}
