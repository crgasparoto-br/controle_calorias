import React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatCalories, formatCountPtBr, formatGrams } from "@/lib/numberFormat";
import { BrainCircuit, ImagePlus, Mic, Save, WandSparkles } from "lucide-react";
import { MealDateTimeInput } from "./MealDateTimeInput";
import { MealEmptyState } from "./MealEmptyState";
import { MealItemEditor } from "./MealItemEditor";
import { MealLabelInput } from "./MealLabelInput";
import { MealTotalsBlock } from "./MealTotalsBlock";
import { MealUploadField } from "./MealUploadField";
import { isFoodD1WebDraft, type DraftState, type FoodD1EditableItemState, type MealItemState } from "../types";
import type { MealImageKind } from "../mealFormState";

type MealAiTabContentProps = {
  description: string;
  onDescriptionChange: (value: string) => void;
  imageFileName?: string;
  imageKind: MealImageKind | null;
  onImageKindChange: (kind: MealImageKind) => void;
  audioFileName?: string;
  onImageChange: React.ChangeEventHandler<HTMLInputElement>;
  onAudioChange: React.ChangeEventHandler<HTMLInputElement>;
  onProcess: () => void;
  isProcessing: boolean;
  draft: DraftState | null;
  mealLabel: string;
  onMealLabelChange: (value: string) => void;
  suggestedMealLabel?: string | null;
  occurredAt: string;
  onOccurredAtChange: (value: string) => void;
  notes: string;
  onNotesChange: (value: string) => void;
  editableItems: MealItemState[];
  onEditableItemChange: <K extends keyof MealItemState>(index: number, key: K, value: MealItemState[K]) => void;
  foodD1EditableItems: FoodD1EditableItemState[];
  onFoodD1ItemChange: (index: number, key: "foodName" | "quantityInput" | "unit", value: string) => void;
  previewTotals: { calories: number; protein: number; carbs: number; fat: number };
  onConfirm: () => void;
  isConfirmPending: boolean;
};

export function MealAiTabContent({
  description,
  onDescriptionChange,
  imageFileName,
  imageKind,
  onImageKindChange,
  audioFileName,
  onImageChange,
  onAudioChange,
  onProcess,
  isProcessing,
  draft,
  mealLabel,
  onMealLabelChange,
  suggestedMealLabel,
  occurredAt,
  onOccurredAtChange,
  notes,
  onNotesChange,
  editableItems,
  onEditableItemChange,
  foodD1EditableItems,
  onFoodD1ItemChange,
  previewTotals,
  onConfirm,
  isConfirmPending,
}: MealAiTabContentProps) {
  return (
    <div className="grid gap-6 xl:grid-cols-[1.02fr_0.98fr]">
      <Card defaultOpen className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <WandSparkles className="h-5 w-5 text-primary" />
            Registrar
          </CardTitle>
          <CardDescription>Texto, foto e áudio no mesmo rascunho.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="meal-description">Descrição em texto</Label>
            <Textarea
              id="meal-description"
              value={description}
              onChange={event => onDescriptionChange(event.target.value)}
              placeholder="Ex.: almocei arroz, feijão, frango grelhado e salada"
              className="min-h-36 rounded-2xl"
            />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <MealUploadField
              id="meal-image"
              label="Foto do prato ou rótulo"
              icon={<ImagePlus className="h-4 w-4 text-primary" />}
              fileName={imageFileName}
              accept="image/png,image/jpeg,image/webp,image/heic,image/heif"
              onChange={onImageChange}
            />
            <MealUploadField
              id="meal-audio"
              label="Áudio da refeição"
              icon={<Mic className="h-4 w-4 text-primary" />}
              fileName={audioFileName}
              accept="audio/*"
              onChange={onAudioChange}
            />
          </div>
          {imageFileName ? (
            <div className="space-y-2">
              <Label htmlFor="meal-image-kind">Tipo de foto (obrigatório)</Label>
              <Select value={imageKind ?? undefined} onValueChange={value =>
                onImageKindChange(value as MealImageKind)}>
                <SelectTrigger id="meal-image-kind" aria-required="true"
                  aria-describedby="meal-image-kind-help" className="w-full rounded-xl">
                  <SelectValue placeholder="Selecione o conteúdo da foto" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="plate_image">Prato ou alimento servido</SelectItem>
                  <SelectItem value="packaging">Frente da embalagem</SelectItem>
                  <SelectItem value="nutrition_label">Tabela nutricional / rótulo</SelectItem>
                </SelectContent>
              </Select>
              <p id="meal-image-kind-help" className="text-xs text-muted-foreground">
                Selecione o tipo de foto para habilitar o registro. O tipo orienta a leitura; só o resolvedor valida alimentos e nutrientes.
              </p>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <Button className="rounded-full" onClick={onProcess}
              disabled={isProcessing || (Boolean(imageFileName) && imageKind === null)}>
              <BrainCircuit className="mr-2 h-4 w-4" />
              {isProcessing ? "Processando..." : "Registrar"}
            </Button>
            <Badge variant="secondary">Rascunho revisável</Badge>
          </div>
        </CardContent>
      </Card>

      <Card defaultOpen className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle>Revisão rápida</CardTitle>
          <CardDescription>Confira os itens, a data e o nome da refeição antes de salvar.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {draft ? (
            isFoodD1WebDraft(draft) ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-muted/20 p-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Rascunho V2</p>
                    <p className="text-xl font-semibold tracking-tight">{formatCountPtBr(draft.items.length, " itens para revisar")}</p>
                  </div>
                  <Badge variant="secondary">Expira em até 30 minutos</Badge>
                </div>
                <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
                  <MealLabelInput value={mealLabel} onChange={onMealLabelChange} suggestedLabel={null} disabled />
                  <MealDateTimeInput id="occurred-at" label="Data e horário" value={occurredAt} onChange={onOccurredAtChange} disabled />
                </div>
                <p className="text-sm text-muted-foreground">
                  O destino e a data foram fixados ao gerar o rascunho. Para alterá-los, gere outro rascunho.
                </p>
                <div className="space-y-2">
                  <Label htmlFor="meal-notes">Observações</Label>
                  <Textarea
                    id="meal-notes"
                    value={notes}
                    onChange={event => onNotesChange(event.target.value)}
                    placeholder="Observações adicionais sobre a refeição"
                    className="min-h-24 rounded-2xl"
                  />
                </div>
                <div className="space-y-3">
                  {foodD1EditableItems.map((item, index) => {
                    const hasVerifiedNutrition = item.nutrition.verified &&
                      item.nutrition.calories !== null &&
                      item.nutrition.protein !== null &&
                      item.nutrition.carbs !== null &&
                      item.nutrition.fat !== null;
                    return (
                      <div key={item.observationId} className="space-y-4 rounded-2xl border bg-background p-4 shadow-sm">
                        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/70 pb-3">
                          <div>
                            <p className="text-sm font-medium tracking-tight">Alimento {index + 1}</p>
                            <p className="text-xs text-muted-foreground">
                              {item.disposition === "ready"
                                ? "Confira a identidade e a porção antes de salvar."
                                : "Ajuste o nome ou a porção para tentar resolver este item."}
                            </p>
                          </div>
                          <Badge variant={item.disposition === "ready" ? "secondary" : "outline"}>
                            {item.disposition === "ready" ? "Pronto para confirmar" : "Precisa de revisão"}
                          </Badge>
                        </div>
                        <div className="grid gap-4 md:grid-cols-[minmax(0,1.4fr)_minmax(7rem,0.7fr)_minmax(7rem,0.7fr)]">
                          <div className="space-y-2">
                            <Label htmlFor={`food-d1-name-${index}`}>Alimento</Label>
                            <Input
                              id={`food-d1-name-${index}`}
                              value={item.foodName}
                              onChange={event => onFoodD1ItemChange(index, "foodName", event.target.value)}
                              maxLength={255}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor={`food-d1-quantity-${index}`}>Quantidade</Label>
                            <Input
                              id={`food-d1-quantity-${index}`}
                              inputMode="decimal"
                              value={item.quantityInput}
                              onChange={event => onFoodD1ItemChange(index, "quantityInput", event.target.value)}
                              placeholder="Ex.: 1,5"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor={`food-d1-unit-${index}`}>Unidade</Label>
                            <Input
                              id={`food-d1-unit-${index}`}
                              value={item.unit ?? ""}
                              onChange={event => onFoodD1ItemChange(index, "unit", event.target.value)}
                              maxLength={40}
                              placeholder="Ex.: g, ml"
                            />
                          </div>
                        </div>
                        {hasVerifiedNutrition ? (
                          <p className="text-sm text-muted-foreground">
                            Nutrição verificada: {formatCalories(item.nutrition.calories!)} ·
                            {` ${formatGrams(item.nutrition.protein!)} proteínas · ${formatGrams(item.nutrition.carbs!)} carboidratos · ${formatGrams(item.nutrition.fat!)} gorduras`}
                          </p>
                        ) : (
                          <p className="text-sm text-muted-foreground">
                            Nutrição ainda não verificada; valores estimados não serão usados para salvar.
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
                <Button
                  className="w-full rounded-full"
                  disabled={isConfirmPending || foodD1EditableItems.length === 0 || foodD1EditableItems.some(item => !item.foodName.trim())}
                  onClick={onConfirm}
                >
                  <Save className="mr-2 h-4 w-4" />
                  {isConfirmPending ? "Salvando..." : "Salvar refeição"}
                </Button>
              </>
            ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-muted/20 p-4">
                <div>
                  <p className="text-sm text-muted-foreground">Rascunho gerado</p>
                  <p className="text-xl font-semibold tracking-tight">{formatCountPtBr(draft.processed.items.length, " itens identificados")}</p>
                </div>
                <Badge variant="secondary">Revise antes de salvar</Badge>
              </div>
              {draft.processed.transcript ? (
                <div className="rounded-2xl bg-background p-3 text-sm text-muted-foreground ring-1 ring-border/70">
                  <strong className="text-foreground">Transcrição:</strong> {draft.processed.transcript}
                </div>
              ) : null}
              <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
                <MealLabelInput value={mealLabel} onChange={onMealLabelChange} suggestedLabel={suggestedMealLabel} />
                <MealDateTimeInput id="occurred-at" label="Data e horário" value={occurredAt} onChange={onOccurredAtChange} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="meal-notes">Observações</Label>
                <Textarea
                  id="meal-notes"
                  value={notes}
                  onChange={event => onNotesChange(event.target.value)}
                  placeholder="Observações adicionais sobre a refeição"
                  className="min-h-24 rounded-2xl"
                />
              </div>
              <div className="space-y-3">
                {editableItems.map((item, index) => {
                  const hasFoodSwap =
                    item.foodName.trim().length > 0 &&
                    item.canonicalName.trim().length > 0 &&
                    item.foodName.trim().toLocaleLowerCase("pt-BR") !== item.canonicalName.trim().toLocaleLowerCase("pt-BR");

                  return (
                    <div key={`${item.foodName}-${index}`} className="space-y-4 rounded-2xl border bg-background p-4 shadow-sm">
                      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/70 pb-3">
                        <div>
                          <p className="text-sm font-medium tracking-tight">Alimento {index + 1}</p>
                          <p className="text-xs text-muted-foreground">
                            {hasFoodSwap ? "Confira se a substituição sugerida faz sentido antes de salvar." : "Revise nome, porção e valores nutricionais antes de salvar."}
                          </p>
                        </div>
                        {hasFoodSwap ? <Badge variant="secondary" className="bg-amber-100 text-amber-900 hover:bg-amber-100">Troca de alimento</Badge> : null}
                      </div>
                      <MealItemEditor item={item} onChange={(key, value) => onEditableItemChange(index, key, value)} />
                    </div>
                  );
                })}
              </div>
              <MealTotalsBlock title="Totais após revisão" totals={previewTotals} />
              <Button className="w-full rounded-full" disabled={isConfirmPending || editableItems.length === 0} onClick={onConfirm}>
                <Save className="mr-2 h-4 w-4" />
                {isConfirmPending ? "Salvando..." : "Salvar refeição"}
              </Button>
            </>
            )
          ) : (
            <MealEmptyState text="Informe texto, foto, rótulo ou áudio e clique em Registrar. O rascunho aparecerá aqui para revisão antes de salvar." />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
