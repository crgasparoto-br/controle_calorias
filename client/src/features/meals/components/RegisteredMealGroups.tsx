import React, { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { zonedDateTimeLocalToIso, toDateTimeLocalValue } from "@/lib/dateTime";
import { formatCalories, formatGrams } from "@/lib/numberFormat";
import { trpc } from "@/lib/trpc";
import type { RegisteredMealGroupViewModel, RegisteredMealItemViewModel, RegisteredMealRecordViewModel } from "../mealViewModels";
import { normalizeMealType } from "../mealViewModels";
import type { MealItemState, MealType, StoredMeal } from "../types";
import { Copy, PencilLine, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { RegisteredMealItemEditDialog, type RegisteredMealItemEditTarget } from "./RegisteredMealItemEditDialog";

type RegisteredMealGroupsProps = {
  groups: RegisteredMealGroupViewModel[];
  userTimeZone: string;
  selectedMealId?: number;
  emptyMessage: string;
  isCopyPending?: boolean;
  isFavoritePending?: boolean;
  isRemovePending?: boolean;
  onEditMeal?: (meal: StoredMeal) => void;
  onEditMealItem?: (meal: StoredMeal, itemIndex: number) => void;
  onCopyMeal?: (meal: StoredMeal, mealLabel: MealType) => void;
  onFavoriteMeal?: (meal: StoredMeal) => void;
  onRemoveMeal?: (meal: StoredMeal) => void;
  renderEditingForm?: (meal: StoredMeal) => React.ReactNode;
};

function formatTimeLabel(value: number, timeZone: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    timeStyle: "short",
  }).format(new Date(value));
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

function normalizeItemForSave(item: MealItemState): MealItemState {
  const foodName = item.foodName.trim();
  return {
    ...item,
    foodName,
    canonicalName: item.canonicalName.trim() || foodName,
    portionText: item.portionText.trim() || "1 porção",
    confidence: Number(item.confidence || 1),
  };
}

function buildMealItemUpdatePayload(meal: StoredMeal, userTimeZone: string, items: MealItemState[]) {
  return {
    mealId: meal.id,
    mealLabel: normalizeMealType(meal.mealLabel),
    occurredAt: zonedDateTimeLocalToIso(toDateTimeLocalValue(new Date(meal.occurredAt), userTimeZone), userTimeZone),
    notes: meal.notes?.trim() || undefined,
    items,
  };
}

function MealFoodRow({
  item,
  userTimeZone,
  isSelected,
  isDeleting,
  onEditMealItem,
  onDeleteMealItem,
}: {
  item: RegisteredMealItemViewModel;
  userTimeZone: string;
  isSelected: boolean;
  isDeleting?: boolean;
  onEditMealItem?: (meal: StoredMeal, itemIndex: number) => void;
  onDeleteMealItem?: (meal: StoredMeal, itemIndex: number) => void;
}) {
  const portionLabel = item.item.portionText.trim() || formatGrams(item.item.estimatedGrams);
  const rowClassName = [
    "flex w-full items-center gap-2 rounded-2xl border px-2 py-2 transition",
    isSelected ? "border-primary/40 bg-primary/5" : "bg-background/70 hover:border-primary/40 hover:bg-primary/5",
  ].join(" ");
  const contentClassName = "min-w-0 flex-1 rounded-xl px-1 py-1 text-left transition hover:bg-muted/40";
  const content = (
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
  );

  return (
    <div className={rowClassName}>
      {onEditMealItem ? (
        <button
          type="button"
          onClick={() => onEditMealItem(item.meal, item.itemIndex)}
          className={contentClassName}
          aria-label={`Editar alimento ${item.item.foodName}`}
        >
          {content}
        </button>
      ) : (
        <div className={contentClassName}>{content}</div>
      )}
      {onDeleteMealItem ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 rounded-full text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={() => onDeleteMealItem(item.meal, item.itemIndex)}
          disabled={isDeleting}
          aria-label={`Excluir alimento ${item.item.foodName}`}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      ) : null}
    </div>
  );
}

function MealGroupActions({
  meal,
  mealLabel,
  selectedMealId,
  isCopyPending,
  isFavoritePending,
  isRemovePending,
  onEditMeal,
  onCopyMeal,
  onFavoriteMeal,
  onRemoveMeal,
}: {
  meal: StoredMeal;
  mealLabel: MealType;
  selectedMealId?: number;
  isCopyPending?: boolean;
  isFavoritePending?: boolean;
  isRemovePending?: boolean;
  onEditMeal?: (meal: StoredMeal) => void;
  onCopyMeal?: (meal: StoredMeal, mealLabel: MealType) => void;
  onFavoriteMeal?: (meal: StoredMeal) => void;
  onRemoveMeal?: (meal: StoredMeal) => void;
}) {
  const isSelected = selectedMealId === meal.id;

  return (
      <div className="flex flex-wrap justify-end gap-2">
        {onEditMeal ? (
          <Button type="button" variant={isSelected ? "default" : "outline"} className="rounded-full" onClick={() => onEditMeal(meal)}>
            <PencilLine className="mr-2 h-4 w-4" />
            {isSelected ? "Editando" : "Editar"}
          </Button>
        ) : null}
        {onCopyMeal ? (
          <Button type="button" variant="outline" className="rounded-full" onClick={() => onCopyMeal(meal, mealLabel)} disabled={isCopyPending}>
            <Copy className="mr-2 h-4 w-4" />
            Copiar
          </Button>
        ) : null}
        {onFavoriteMeal ? (
          <Button type="button" variant="outline" className="rounded-full" onClick={() => onFavoriteMeal(meal)} disabled={isFavoritePending}>
            <Star className="mr-2 h-4 w-4" />
            Favorita
          </Button>
        ) : null}
        {onRemoveMeal ? (
          <Button
            type="button"
            variant="outline"
            className="rounded-full border-destructive/30 text-destructive hover:border-destructive hover:bg-destructive/5 hover:text-destructive"
            onClick={() => onRemoveMeal(meal)}
            disabled={isRemovePending}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Excluir refeição
          </Button>
        ) : null}
      </div>
  );
}

function RegisteredMealGroupSection({
  group,
  userTimeZone,
  selectedMealId,
  isCopyPending,
  isFavoritePending,
  isRemovePending,
  isItemDeleting,
  onEditMeal,
  onEditMealItem,
  onDeleteMealItem,
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
  isItemDeleting?: boolean;
  onEditMeal?: (meal: StoredMeal) => void;
  onEditMealItem?: (meal: StoredMeal, itemIndex: number) => void;
  onDeleteMealItem?: (meal: StoredMeal, itemIndex: number) => void;
  onCopyMeal?: (meal: StoredMeal, mealLabel: MealType) => void;
  onFavoriteMeal?: (meal: StoredMeal) => void;
  onRemoveMeal?: (meal: StoredMeal) => void;
  renderEditingForm?: (meal: StoredMeal) => React.ReactNode;
}) {
  const hasActions = Boolean(onEditMeal || onCopyMeal || onFavoriteMeal || onRemoveMeal);
  const singleMeal = group.meals.length === 1 ? group.meals[0] : null;
  const hasMultipleMeals = group.meals.length > 1;
  const imageRecords = group.records.filter(record => record.imageUrl);

  return (
    <section className="space-y-2 rounded-2xl border bg-background p-3 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-base font-semibold capitalize tracking-tight text-foreground">{group.mealLabel}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {group.records.length} {group.records.length === 1 ? "refeição" : "refeições"} · {describeFoodCount(group.items.length)} · {formatCalories(group.totals.calories)} · P {formatGrams(group.totals.protein)} · C {formatGrams(group.totals.carbs)} · G {formatGrams(group.totals.fat)}
          </p>
        </div>
        {hasActions && singleMeal ? (
          <MealGroupActions
            meal={singleMeal}
            mealLabel={group.mealLabel}
            selectedMealId={selectedMealId}
            isCopyPending={isCopyPending}
            isFavoritePending={isFavoritePending}
            isRemovePending={isRemovePending}
            onEditMeal={onEditMeal}
            onCopyMeal={onCopyMeal}
            onFavoriteMeal={onFavoriteMeal}
            onRemoveMeal={onRemoveMeal}
          />
        ) : null}
      </div>

      {imageRecords.length ? (
        <div className="flex flex-wrap gap-3">
          {imageRecords.map(record => (
            <FoodImage key={record.meal.id} record={record} />
          ))}
        </div>
      ) : null}

      {group.records.map(record => (
        <div key={record.meal.id} className="space-y-2">
          {hasActions && hasMultipleMeals ? (
            <MealGroupActions
              meal={record.meal}
              mealLabel={group.mealLabel}
              selectedMealId={selectedMealId}
              isCopyPending={isCopyPending}
              isFavoritePending={isFavoritePending}
              isRemovePending={isRemovePending}
              onEditMeal={onEditMeal}
              onCopyMeal={onCopyMeal}
              onFavoriteMeal={onFavoriteMeal}
              onRemoveMeal={onRemoveMeal}
            />
          ) : null}

          {record.items.map(item => (
            <MealFoodRow
              key={`${item.meal.id}-${item.item.foodName}-${item.itemIndex}`}
              item={item}
              userTimeZone={userTimeZone}
              isSelected={selectedMealId === item.meal.id}
              isDeleting={isItemDeleting}
              onEditMealItem={onEditMealItem}
              onDeleteMealItem={onDeleteMealItem}
            />
          ))}

          {record.mealNotes ? <p className="px-1 text-sm text-muted-foreground">{record.mealNotes}</p> : null}

          {selectedMealId === record.meal.id && renderEditingForm ? (
            <div className="mt-3 rounded-3xl border border-primary/30 bg-primary/5 p-3">
              {renderEditingForm(record.meal)}
            </div>
          ) : null}
        </div>
      ))}
    </section>
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
  onEditMealItem,
  onCopyMeal,
  onFavoriteMeal,
  onRemoveMeal,
  renderEditingForm,
}: RegisteredMealGroupsProps) {
  const utils = trpc.useUtils();
  const itemMutationActionRef = useRef<"save" | "delete">("save");
  const [editingItemTarget, setEditingItemTarget] = useState<RegisteredMealItemEditTarget | null>(null);

  const invalidateNutritionViews = async () => {
    await Promise.all([
      utils.nutrition.dashboard.overview.invalidate(),
      utils.nutrition.meals.list.invalidate(),
      utils.nutrition.meals.dayTotals.invalidate(),
      utils.nutrition.meals.favorites.invalidate(),
      utils.nutrition.reports.weekly.invalidate(),
      utils.nutrition.reports.bundle.invalidate(),
    ]);
  };

  const updateMealItem = trpc.nutrition.meals.update.useMutation({
    onSuccess: async () => {
      await invalidateNutritionViews();
      toast.success(itemMutationActionRef.current === "delete" ? "Alimento removido com sucesso." : "Alimento atualizado com sucesso.");
      setEditingItemTarget(null);
    },
    onError: error => toast.error(error.message || "Não foi possível atualizar o alimento."),
  });

  const removeMealFromItemDialog = trpc.nutrition.meals.remove.useMutation({
    onSuccess: async () => {
      await invalidateNutritionViews();
      toast.success("Alimento removido com sucesso.");
      setEditingItemTarget(null);
    },
    onError: error => toast.error(error.message || "Não foi possível remover o alimento."),
  });

  const handleEditMealItem = (meal: StoredMeal, itemIndex: number) => {
    if (onEditMealItem) {
      onEditMealItem(meal, itemIndex);
      return;
    }

    setEditingItemTarget({ meal, itemIndex });
  };

  const handleSaveMealItem = (item: MealItemState) => {
    if (!editingItemTarget) {
      return;
    }

    const normalizedItem = normalizeItemForSave(item);
    if (!normalizedItem.foodName) {
      toast.error("Preencha o nome do alimento.");
      return;
    }

    itemMutationActionRef.current = "save";
    updateMealItem.mutate(buildMealItemUpdatePayload(
      editingItemTarget.meal,
      userTimeZone,
      editingItemTarget.meal.items.map((currentItem, currentIndex) =>
        currentIndex === editingItemTarget.itemIndex ? normalizedItem : normalizeItemForSave(currentItem),
      ),
    ));
  };

  const handleDeleteMealItem = () => {
    if (!editingItemTarget) {
      return;
    }

    itemMutationActionRef.current = "delete";

    if (editingItemTarget.meal.items.length <= 1) {
      removeMealFromItemDialog.mutate({ mealId: editingItemTarget.meal.id });
      return;
    }

    updateMealItem.mutate(buildMealItemUpdatePayload(
      editingItemTarget.meal,
      userTimeZone,
      editingItemTarget.meal.items
        .filter((_, currentIndex) => currentIndex !== editingItemTarget.itemIndex)
        .map(normalizeItemForSave),
    ));
  };

  const handleDeleteMealItemFromRow = (meal: StoredMeal, itemIndex: number) => {
    itemMutationActionRef.current = "delete";

    if (meal.items.length <= 1) {
      removeMealFromItemDialog.mutate({ mealId: meal.id });
      return;
    }

    updateMealItem.mutate(buildMealItemUpdatePayload(
      meal,
      userTimeZone,
      meal.items
        .filter((_, currentIndex) => currentIndex !== itemIndex)
        .map(normalizeItemForSave),
    ));
  };

  if (!groups.length) {
    return (
      <div className="rounded-2xl border border-dashed bg-muted/20 p-6 text-sm leading-6 text-muted-foreground">
        {emptyMessage}
      </div>
    );
  }

  return (
    <>
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
            isItemDeleting={updateMealItem.isPending || removeMealFromItemDialog.isPending}
            onEditMeal={onEditMeal}
            onEditMealItem={handleEditMealItem}
            onDeleteMealItem={handleDeleteMealItemFromRow}
            onCopyMeal={onCopyMeal}
            onFavoriteMeal={onFavoriteMeal}
            onRemoveMeal={onRemoveMeal}
            renderEditingForm={renderEditingForm}
          />
        ))}
      </div>

      <RegisteredMealItemEditDialog
        target={editingItemTarget}
        isSaving={updateMealItem.isPending || removeMealFromItemDialog.isPending}
        onOpenChange={open => {
          if (!open) {
            setEditingItemTarget(null);
          }
        }}
        onDelete={handleDeleteMealItem}
        onSave={handleSaveMealItem}
      />
    </>
  );
}
