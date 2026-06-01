import React, { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { DisclosureToggle } from "@/components/ui/disclosure-toggle";
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
  record,
  userTimeZone,
  isSelected,
  onEditMealItem,
}: {
  item: RegisteredMealItemViewModel;
  record: RegisteredMealRecordViewModel;
  userTimeZone: string;
  isSelected: boolean;
  onEditMealItem?: (meal: StoredMeal, itemIndex: number) => void;
}) {
  const portionLabel = item.item.portionText.trim() || formatGrams(item.item.estimatedGrams);
  const className = [
    "w-full rounded-2xl border px-3 py-3 text-left transition",
    isSelected ? "border-primary/40 bg-primary/5" : "bg-background/70 hover:border-primary/40 hover:bg-primary/5",
  ].join(" ");
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

  if (!onEditMealItem) {
    return <div className={className}>{content}</div>;
  }

  return (
    <button
      type="button"
      onClick={() => onEditMealItem(record.meal, item.itemIndex)}
      className={className}
      aria-label={`Editar alimento ${item.item.foodName}`}
    >
      {content}
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
  onEditMealItem,
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
  onEditMeal?: (meal: StoredMeal) => void;
  onEditMealItem?: (meal: StoredMeal, itemIndex: number) => void;
  onCopyMeal?: (meal: StoredMeal, mealLabel: MealType) => void;
  onFavoriteMeal?: (meal: StoredMeal) => void;
  onRemoveMeal?: (meal: StoredMeal) => void;
  renderEditingForm?: (meal: StoredMeal) => React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(true);
  const referenceDate = group.records[0]?.registeredAt;
  const imageRecords = group.records.filter(record => record.imageUrl);
  const primaryRecord = group.records[0];
  const hasActions = Boolean(onEditMeal || onCopyMeal || onFavoriteMeal || onRemoveMeal);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
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
              <DisclosureToggle expanded={isOpen} />
            </div>
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent className="border-t bg-muted/10 px-4 pb-4 pt-4">
          <div className="rounded-2xl border bg-background p-4">
            {imageRecords.length ? (
              <div className="mb-4 flex flex-wrap gap-3">
                {imageRecords.map(record => (
                  <FoodImage key={record.meal.id} record={record} />
                ))}
              </div>
            ) : null}

            <div className="space-y-2">
              {group.records.flatMap(record =>
                record.items.map(item => (
                  <MealFoodRow
                    key={`${record.meal.id}-${item.item.foodName}-${item.itemIndex}`}
                    item={item}
                    record={record}
                    userTimeZone={userTimeZone}
                    isSelected={selectedMealId === record.meal.id}
                    onEditMealItem={onEditMealItem}
                  />
                )),
              )}
            </div>

            {primaryRecord?.mealNotes ? <p className="mt-4 text-sm text-muted-foreground">{primaryRecord.mealNotes}</p> : null}

            {primaryRecord && hasActions ? (
              <div className="mt-4 flex flex-wrap gap-3 border-t pt-4">
                {onEditMeal ? (
                  <Button type="button" variant={selectedMealId === primaryRecord.meal.id ? "default" : "outline"} className="rounded-full" onClick={() => onEditMeal(primaryRecord.meal)}>
                    <PencilLine className="mr-2 h-4 w-4" />
                    {selectedMealId === primaryRecord.meal.id ? "Editando esta refeição" : "Editar refeição"}
                  </Button>
                ) : null}
                {onCopyMeal ? (
                  <Button type="button" variant="outline" className="rounded-full" onClick={() => onCopyMeal(primaryRecord.meal, primaryRecord.mealLabel)} disabled={isCopyPending}>
                    <Copy className="mr-2 h-4 w-4" />
                    Copiar para o dia
                  </Button>
                ) : null}
                {onFavoriteMeal ? (
                  <Button type="button" variant="outline" className="rounded-full" onClick={() => onFavoriteMeal(primaryRecord.meal)} disabled={isFavoritePending}>
                    <Star className="mr-2 h-4 w-4" />
                    Salvar favorita
                  </Button>
                ) : null}
                {onRemoveMeal ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="rounded-full border-destructive/30 text-destructive hover:border-destructive hover:bg-destructive/5 hover:text-destructive"
                    onClick={() => onRemoveMeal(primaryRecord.meal)}
                    disabled={isRemovePending}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Excluir refeição
                  </Button>
                ) : null}
              </div>
            ) : null}

            {primaryRecord && selectedMealId === primaryRecord.meal.id && renderEditingForm ? (
              <div className="mt-5 rounded-3xl border border-primary/30 bg-primary/5 p-3">
                {renderEditingForm(primaryRecord.meal)}
              </div>
            ) : null}
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
  onEditMealItem,
  onCopyMeal,
  onFavoriteMeal,
  onRemoveMeal,
  renderEditingForm,
}: RegisteredMealGroupsProps) {
  const utils = trpc.useUtils();
  const [editingItemTarget, setEditingItemTarget] = useState<RegisteredMealItemEditTarget | null>(null);
  const [itemMutationAction, setItemMutationAction] = useState<"save" | "delete">("save");

  const updateMealItem = trpc.nutrition.meals.update.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.nutrition.dashboard.overview.invalidate(),
        utils.nutrition.meals.list.invalidate(),
        utils.nutrition.meals.dayTotals.invalidate(),
        utils.nutrition.reports.weekly.invalidate(),
        utils.nutrition.reports.bundle.invalidate(),
      ]);
      toast.success(itemMutationAction === "delete" ? "Alimento removido com sucesso." : "Alimento atualizado com sucesso.");
      setEditingItemTarget(null);
    },
    onError: error => toast.error(error.message || "Não foi possível atualizar o alimento."),
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

    setItemMutationAction("save");
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

    if (editingItemTarget.meal.items.length <= 1) {
      toast.error("A refeição precisa ter ao menos um alimento. Para remover tudo, exclua a refeição.");
      return;
    }

    setItemMutationAction("delete");
    updateMealItem.mutate(buildMealItemUpdatePayload(
      editingItemTarget.meal,
      userTimeZone,
      editingItemTarget.meal.items
        .filter((_, currentIndex) => currentIndex !== editingItemTarget.itemIndex)
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
            onEditMeal={onEditMeal}
            onEditMealItem={handleEditMealItem}
            onCopyMeal={onCopyMeal}
            onFavoriteMeal={onFavoriteMeal}
            onRemoveMeal={onRemoveMeal}
            renderEditingForm={renderEditingForm}
          />
        ))}
      </div>

      <RegisteredMealItemEditDialog
        target={editingItemTarget}
        isSaving={updateMealItem.isPending}
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
