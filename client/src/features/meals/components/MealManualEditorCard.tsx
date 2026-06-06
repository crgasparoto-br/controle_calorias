import React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PencilLine, Plus, Save, Trash2 } from "lucide-react";
import { MealDateTimeInput } from "./MealDateTimeInput";
import { MealItemEditor } from "./MealItemEditor";
import { MealLabelInput } from "./MealLabelInput";
import { MealTotalsBlock } from "./MealTotalsBlock";
import type { MealItemState } from "../types";

type ManualMealStateLike = {
  mealId?: number;
  mealLabel: string;
  occurredAt: string;
  notes: string;
  items: MealItemState[];
};

type MealManualEditorCardProps = {
  manualMeal: ManualMealStateLike;
  suggestedManualMealLabel?: string | null;
  onMealLabelChange: (value: string) => void;
  onOccurredAtChange: (value: string) => void;
  onNotesChange: (value: string) => void;
  onAddItem: () => void;
  onRemoveItem: (index: number) => void;
  onItemChange: <K extends keyof MealItemState>(index: number, key: K, value: MealItemState[K]) => void;
  manualTotals: { calories: number; protein: number; carbs: number; fat: number };
  onSubmit: () => void;
  isSubmitting: boolean;
  onReset: () => void;
};

export function MealManualEditorCard({
  manualMeal,
  suggestedManualMealLabel,
  onMealLabelChange,
  onOccurredAtChange,
  onNotesChange,
  onAddItem,
  onRemoveItem,
  onItemChange,
  manualTotals,
  onSubmit,
  isSubmitting,
  onReset,
}: MealManualEditorCardProps) {
  return (
    <Card defaultOpen className="border-0 shadow-sm ring-1 ring-primary/20">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl">
          <PencilLine className="h-5 w-5 text-primary" />
          {manualMeal.mealId ? "Editar refeição selecionada" : "Criar refeição manual"}
        </CardTitle>
        <CardDescription>
          {manualMeal.mealId
            ? "A edição abre aqui sem perder o contexto do restante da tela."
            : "Busque alimentos do catálogo, escolha porções cadastradas ou informe gramas manualmente quando precisar."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
          <MealLabelInput
            value={manualMeal.mealLabel}
            onChange={onMealLabelChange}
            suggestedLabel={suggestedManualMealLabel}
          />
          <MealDateTimeInput
            id="manual-occurred-at"
            label="Data e horário"
            value={manualMeal.occurredAt}
            onChange={onOccurredAtChange}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="manual-notes">Observações</Label>
          <Textarea
            id="manual-notes"
            value={manualMeal.notes}
            onChange={event => onNotesChange(event.target.value)}
            placeholder="Ex.: refeição pré-treino"
            className="min-h-24 rounded-2xl"
          />
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium tracking-tight">Itens da refeição</p>
            <Button type="button" variant="outline" className="rounded-full" onClick={onAddItem}>
              <Plus className="mr-2 h-4 w-4" />
              Adicionar item
            </Button>
          </div>

          {manualMeal.items.map((item, index) => (
            <div key={`manual-${index}`} className="space-y-3 rounded-2xl border bg-background p-4 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium">Item {index + 1}</p>
                {manualMeal.items.length > 1 ? (
                  <Button type="button" size="icon" variant="ghost" onClick={() => onRemoveItem(index)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                ) : null}
              </div>
              <MealItemEditor item={item} onChange={(key, value) => onItemChange(index, key, value)} />
            </div>
          ))}
        </div>

        <MealTotalsBlock title="Totais da refeição manual" totals={manualTotals} />

        <div className="flex flex-wrap gap-3">
          <Button className="rounded-full" onClick={onSubmit} disabled={isSubmitting}>
            <Save className="mr-2 h-4 w-4" />
            {manualMeal.mealId ? (isSubmitting ? "Atualizando..." : "Salvar alterações") : isSubmitting ? "Criando..." : "Criar refeição manual"}
          </Button>
          <Button type="button" variant="outline" className="rounded-full" onClick={onReset}>
            {manualMeal.mealId ? "Cancelar edição" : "Limpar formulário"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
