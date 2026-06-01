import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatCalories, formatGrams } from "@/lib/numberFormat";
import { Trash2 } from "lucide-react";
import { MealItemEditor } from "./MealItemEditor";
import { SummaryPill } from "./SummaryPill";
import { createEmptyItem, sumItems } from "../mealFormState";
import type { MealItemState, StoredMeal } from "../types";

export type RegisteredMealItemEditTarget = {
  meal: StoredMeal;
  itemIndex: number;
};

type RegisteredMealItemEditDialogProps = {
  target: RegisteredMealItemEditTarget | null;
  isSaving?: boolean;
  onOpenChange: (open: boolean) => void;
  onDelete: () => void;
  onSave: (item: MealItemState) => void;
};

function getInitialItem(target: RegisteredMealItemEditTarget | null): MealItemState {
  return target?.meal.items[target.itemIndex] ? { ...target.meal.items[target.itemIndex] } : createEmptyItem();
}

export function RegisteredMealItemEditDialog({
  target,
  isSaving,
  onOpenChange,
  onDelete,
  onSave,
}: RegisteredMealItemEditDialogProps) {
  const [draftItem, setDraftItem] = useState<MealItemState>(() => getInitialItem(target));

  useEffect(() => {
    setDraftItem(getInitialItem(target));
  }, [target]);

  const totals = useMemo(() => sumItems([draftItem]), [draftItem]);
  const foodName = draftItem.foodName.trim() || "alimento selecionado";
  const canDeleteItem = Boolean(target && target.meal.items.length > 1);

  const updateDraftItem = <K extends keyof MealItemState>(key: K, value: MealItemState[K]) => {
    setDraftItem(current => ({ ...current, [key]: value }));
  };

  return (
    <Dialog open={Boolean(target)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Editar alimento</DialogTitle>
          <DialogDescription>
            Ajuste somente as informações de {foodName}. Os outros alimentos desta refeição serão preservados.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-2xl border bg-muted/30 p-4">
            <p className="text-sm text-muted-foreground">Resumo do alimento</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-4">
              <SummaryPill label="Calorias" value={formatCalories(totals.calories)} />
              <SummaryPill label="Proteínas" value={formatGrams(totals.protein)} />
              <SummaryPill label="Carboidratos" value={formatGrams(totals.carbs)} />
              <SummaryPill label="Gorduras" value={formatGrams(totals.fat)} />
            </div>
          </div>

          <MealItemEditor item={draftItem} onChange={updateDraftItem} />
        </div>

        <DialogFooter className="gap-3 sm:justify-between">
          <Button
            type="button"
            variant="outline"
            className="border-destructive/30 text-destructive hover:border-destructive hover:bg-destructive/5 hover:text-destructive"
            onClick={onDelete}
            disabled={isSaving || !canDeleteItem}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Excluir alimento
          </Button>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
              Cancelar
            </Button>
            <Button type="button" onClick={() => onSave(draftItem)} disabled={isSaving}>
              {isSaving ? "Salvando..." : "Salvar alimento"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
