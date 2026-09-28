import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Save } from "lucide-react";

export type NutritionLabelEditPayload = {
  candidateId: number;
  foodName: string;
  canonicalName: string;
  brand: string | null;
  productVariant: string | null;
  barcode: string | null;
  servingLabel: string;
  servingUnit: string;
  gramsPerServing: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number | null;
};

type NutritionLabelEditFormState = {
  foodName: string;
  canonicalName: string;
  brand: string;
  productVariant: string;
  barcode: string;
  servingLabel: string;
  servingUnit: string;
  gramsPerServing: string;
  calories: string;
  protein: string;
  carbs: string;
  fat: string;
  fiber: string;
};

function nutritionLabelEditFormFromCandidate(
  candidate: any
): NutritionLabelEditFormState {
  return {
    foodName: candidate.foodName ?? "",
    canonicalName: candidate.canonicalName ?? "",
    brand: candidate.brand ?? "",
    productVariant: candidate.productVariant ?? "",
    barcode: candidate.barcode ?? "",
    servingLabel: candidate.servingLabel ?? "",
    servingUnit: candidate.servingUnit ?? "",
    gramsPerServing: String(candidate.gramsPerServing ?? ""),
    calories: String(candidate.calories ?? ""),
    protein: String(candidate.protein ?? ""),
    carbs: String(candidate.carbs ?? ""),
    fat: String(candidate.fat ?? ""),
    fiber: candidate.fiber == null ? "" : String(candidate.fiber),
  };
}

export function NutritionLabelCandidateEditForm({
  candidate,
  isSaving,
  onCancel,
  onSave,
}: {
  candidate: any;
  isSaving: boolean;
  onCancel: () => void;
  onSave: (payload: NutritionLabelEditPayload) => void;
}) {
  const [form, setForm] = useState(() =>
    nutritionLabelEditFormFromCandidate(candidate)
  );
  const setField = (field: keyof NutritionLabelEditFormState, value: string) =>
    setForm(current => ({ ...current, [field]: value }));
  const requiredNumericFields: Array<
    keyof Pick<
      NutritionLabelEditFormState,
      "gramsPerServing" | "calories" | "protein" | "carbs" | "fat"
    >
  > = ["gramsPerServing", "calories", "protein", "carbs", "fat"];
  const valid =
    Boolean(
      form.foodName.trim() &&
        form.canonicalName.trim() &&
        form.servingLabel.trim() &&
        form.servingUnit.trim()
    ) &&
    requiredNumericFields.every(field => {
      const value = Number(form[field]);
      return form[field].trim() !== "" && Number.isFinite(value) && value >= 0;
    }) &&
    Number(form.gramsPerServing) > 0 &&
    (form.fiber.trim() === "" ||
      (Number.isFinite(Number(form.fiber)) && Number(form.fiber) >= 0));

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!valid) return;
    onSave({
      candidateId: candidate.id,
      foodName: form.foodName.trim(),
      canonicalName: form.canonicalName.trim(),
      brand: form.brand.trim() || null,
      productVariant: form.productVariant.trim() || null,
      barcode: form.barcode.trim() || null,
      servingLabel: form.servingLabel.trim(),
      servingUnit: form.servingUnit.trim(),
      gramsPerServing: Number(form.gramsPerServing),
      calories: Number(form.calories),
      protein: Number(form.protein),
      carbs: Number(form.carbs),
      fat: Number(form.fat),
      fiber: form.fiber.trim() === "" ? null : Number(form.fiber),
    });
  };

  return (
    <form
      className="mt-4 space-y-4 rounded-xl border bg-background p-4"
      onSubmit={submit}
      aria-label={`Editar informações de ${candidate.foodName}`}
    >
      <div>
        <p className="font-medium">Editar informações do candidato</p>
        <p className="text-xs text-muted-foreground">
          A imagem e os valores originais ficam preservados no histórico. Salvar
          devolve o candidato para revisão e não publica automaticamente.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {(
          [
            ["foodName", "Nome exibido"],
            ["canonicalName", "Nome canônico"],
            ["brand", "Marca"],
            ["productVariant", "Variante / sabor"],
            ["barcode", "Código de barras"],
            ["servingLabel", "Porção descrita"],
            ["servingUnit", "Unidade da porção"],
          ] as Array<[keyof NutritionLabelEditFormState, string]>
        ).map(([field, label]) => (
          <div key={field} className="space-y-1.5">
            <Label htmlFor={`nutrition-label-edit-${field}`}>{label}</Label>
            <Input
              id={`nutrition-label-edit-${field}`}
              value={form[field]}
              onChange={event => setField(field, event.target.value)}
              maxLength={field === "barcode" ? 32 : 255}
            />
          </div>
        ))}
      </div>
      <div>
        <p className="mb-2 text-sm font-medium">Valores da porção</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(
            [
              ["gramsPerServing", "Gramas", "0.01"],
              ["calories", "Calorias (kcal)", "0.01"],
              ["protein", "Proteínas (g)", "0.01"],
              ["carbs", "Carboidratos (g)", "0.01"],
              ["fat", "Gorduras (g)", "0.01"],
              ["fiber", "Fibras (g)", "0.01"],
            ] as Array<[keyof NutritionLabelEditFormState, string, string]>
          ).map(([field, label, step]) => (
            <div key={field} className="space-y-1.5">
              <Label htmlFor={`nutrition-label-edit-${field}`}>{label}</Label>
              <Input
                id={`nutrition-label-edit-${field}`}
                type="number"
                inputMode="decimal"
                min={0}
                step={step}
                value={form[field]}
                onChange={event => setField(field, event.target.value)}
              />
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={isSaving}>
          Cancelar
        </Button>
        <Button type="submit" disabled={isSaving || !valid}>
          <Save className="mr-1 h-3.5 w-3.5" />
          {isSaving ? "Salvando..." : "Salvar alterações"}
        </Button>
      </div>
    </form>
  );
}
