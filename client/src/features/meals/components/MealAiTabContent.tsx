import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatCountPtBr, formatPercentPtBr } from "@/lib/numberFormat";
import { BrainCircuit, ImagePlus, Mic, Save, WandSparkles } from "lucide-react";
import type React from "react";
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
    <div className="grid gap-6 xl:grid-cols-[1.08fr_0.92fr]">
      <Card defaultOpen className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <WandSparkles className="h-5 w-5 text-primary" />
            Registrar com IA multimodal
          </CardTitle>
          <CardDescription>
            Texto, imagem e áudio podem entrar juntos. A IA organiza tudo em um rascunho revisável antes do salvamento.
          </CardDescription>
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
              label="Imagem do prato ou rótulo"
              icon={<ImagePlus className="h-4 w-4 text-primary" />}
              fileName={imageFileName}
              accept="image/*"
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
          <div className="flex flex-wrap gap-3">
            <Button className="rounded-full" onClick={onProcess} disabled={isProcessing}>
              <BrainCircuit className="mr-2 h-4 w-4" />
              {isProcessing ? "Processando..." : "Gerar inferência"}
            </Button>
            <Badge variant="secondary">Texto + imagem + áudio juntos</Badge>
          </div>
        </CardContent>
      </Card>

      <Card defaultOpen className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle>Revisão antes de salvar</CardTitle>
          <CardDescription>
            O rascunho fica concentrado aqui para correções rápidas, sem misturar com outros modos de registro.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {draft ? (
            <>
              <div className="rounded-2xl border bg-muted/20 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm text-muted-foreground">Confiança estimada</p>
                    <p className="text-2xl font-semibold tracking-tight">{formatPercentPtBr(draft.processed.confidence * 100)}%</p>
                  </div>
                  <Badge>{formatCountPtBr(draft.processed.items.length, " itens identificados")}</Badge>
                </div>
                <p className="mt-4 text-sm leading-6 text-muted-foreground">{draft.processed.reasoning}</p>
                {draft.processed.transcript ? (
                  <div className="mt-4 rounded-2xl bg-background p-3 text-sm text-muted-foreground">
                    <strong className="text-foreground">Transcrição:</strong> {draft.processed.transcript}
                  </div>
                ) : null}
              </div>
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
                {editableItems.map((item, index) => (
                  <MealItemEditor
                    key={`${item.foodName}-${index}`}
                    item={item}
                    onChange={(key, value) => onEditableItemChange(index, key, value)}
                  />
                ))}
              </div>
              <MealTotalsBlock title="Totais após revisão" totals={previewTotals} />
              <Button className="w-full rounded-full" disabled={isConfirmPending || editableItems.length === 0} onClick={onConfirm}>
                <Save className="mr-2 h-4 w-4" />
                {isConfirmPending ? "Salvando..." : "Confirmar e salvar refeição"}
              </Button>
            </>
          ) : (
            <MealEmptyState text="Nenhuma inferência foi criada ainda. Depois do envio, a revisão aparecerá aqui com alimentos, horários e totais já prontos para ajuste." />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
