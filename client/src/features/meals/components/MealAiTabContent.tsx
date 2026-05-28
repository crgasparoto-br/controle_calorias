import React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatCountPtBr } from "@/lib/numberFormat";
import { BrainCircuit, ImagePlus, Mic, Save, WandSparkles } from "lucide-react";
import { MealDateTimeInput } from "./MealDateTimeInput";
import { MealEmptyState } from "./MealEmptyState";
import { MealItemEditor } from "./MealItemEditor";
import { MealLabelInput } from "./MealLabelInput";
import { MealTotalsBlock } from "./MealTotalsBlock";
import { MealUploadField } from "./MealUploadField";
import type { DraftState, MealItemState } from "../types";

type MealAiTabContentProps = {
  description: string;
  onDescriptionChange: (value: string) => void;
  imageFileName?: string;
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
  previewTotals: { calories: number; protein: number; carbs: number; fat: number };
  onConfirm: () => void;
  isConfirmPending: boolean;
};

export function MealAiTabContent({
  description,
  onDescriptionChange,
  imageFileName,
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
            Registrar com IA
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
          <div className="flex flex-wrap items-center gap-3">
            <Button className="rounded-full" onClick={onProcess} disabled={isProcessing}>
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
          <CardDescription>Revise os itens antes de salvar.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {draft ? (
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
                  placeholder="Observações adicionais do usuário"
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
                            {hasFoodSwap ? "Confira o início e o fim da troca antes de salvar." : "Revise texto e valores nutricionais antes de salvar."}
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
          ) : (
            <MealEmptyState text="Informe texto, foto, rótulo ou áudio e clique em Registrar. O rascunho aparecerá aqui para revisão antes de salvar." />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
