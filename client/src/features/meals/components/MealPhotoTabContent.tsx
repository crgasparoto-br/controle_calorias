import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatCountPtBr, formatPercentPtBr } from "@/lib/numberFormat";
import { BrainCircuit, ImagePlus, Save } from "lucide-react";
import { MealDateTimeInput } from "./MealDateTimeInput";
import { MealEmptyState } from "./MealEmptyState";
import { MealItemEditor } from "./MealItemEditor";
import { MealLabelInput } from "./MealLabelInput";
import { MealUploadField } from "./MealUploadField";
import type { FoodPhotoAnalysisState, MealItemState } from "../types";

type MealPhotoTabContentProps = {
  photoFileName?: string;
  onPhotoChange: React.ChangeEventHandler<HTMLInputElement>;
  onAnalyze: () => void;
  isAnalyzing: boolean;
  photoAnalysis: FoodPhotoAnalysisState | null;
  photoMealLabel: string;
  onPhotoMealLabelChange: (value: string) => void;
  suggestedPhotoMealLabel?: string | null;
  photoOccurredAt: string;
  onPhotoOccurredAtChange: (value: string) => void;
  photoNotes: string;
  onPhotoNotesChange: (value: string) => void;
  photoEditableItems: MealItemState[];
  onPhotoItemChange: <K extends keyof MealItemState>(index: number, key: K, value: MealItemState[K]) => void;
  onConfirm: () => void;
  isConfirmPending: boolean;
  onReject: () => void;
  isRejectPending: boolean;
};

export function MealPhotoTabContent({
  photoFileName,
  onPhotoChange,
  onAnalyze,
  isAnalyzing,
  photoAnalysis,
  photoMealLabel,
  onPhotoMealLabelChange,
  suggestedPhotoMealLabel,
  photoOccurredAt,
  onPhotoOccurredAtChange,
  photoNotes,
  onPhotoNotesChange,
  photoEditableItems,
  onPhotoItemChange,
  onConfirm,
  isConfirmPending,
  onReject,
  isRejectPending,
}: MealPhotoTabContentProps) {
  return (
    <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
      <Card defaultOpen className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <ImagePlus className="h-5 w-5 text-primary" />
            Registrar por foto
          </CardTitle>
          <CardDescription>
            A foto gera alimentos prováveis, porções e confiança. Nada é salvo sem sua confirmação.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <MealUploadField
            id="photo-analysis-image"
            label="Foto da refeição"
            icon={<ImagePlus className="h-4 w-4 text-primary" />}
            fileName={photoFileName}
            accept="image/*"
            onChange={onPhotoChange}
          />
          <Button type="button" className="rounded-full" onClick={onAnalyze} disabled={isAnalyzing}>
            <BrainCircuit className="mr-2 h-4 w-4" />
            {isAnalyzing ? "Analisando..." : "Analisar foto"}
          </Button>
          <p className="text-sm leading-6 text-muted-foreground">
            Este modo é melhor quando você quer corrigir rápido uma imagem única sem misturar texto ou áudio.
          </p>
        </CardContent>
      </Card>

      <Card defaultOpen className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle>Confirmação da análise</CardTitle>
          <CardDescription>
            Os itens sugeridos ficam em um único painel para reduzir idas e vindas na revisão.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {photoAnalysis ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-muted/20 p-4">
                <div>
                  <p className="text-sm text-muted-foreground">Status da análise</p>
                  <p className="text-xl font-semibold tracking-tight">{photoAnalysis.status}</p>
                </div>
                <Badge>{formatCountPtBr(photoAnalysis.suggestedItems.length, " sugestões")}</Badge>
              </div>
              {photoAnalysis.status === "analyzed" ? (
                <>
                  <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
                    <MealLabelInput
                      value={photoMealLabel}
                      onChange={onPhotoMealLabelChange}
                      suggestedLabel={suggestedPhotoMealLabel}
                    />
                    <MealDateTimeInput
                      id="photo-occurred-at"
                      label="Data e horário"
                      value={photoOccurredAt}
                      onChange={onPhotoOccurredAtChange}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Observações</Label>
                    <Textarea
                      value={photoNotes}
                      onChange={event => onPhotoNotesChange(event.target.value)}
                      placeholder="Ex.: porção corrigida após revisar a foto"
                      className="min-h-20 rounded-2xl"
                    />
                  </div>
                  <div className="space-y-3">
                    {photoEditableItems.map((item, index) => (
                      <div key={`photo-${index}`} className="space-y-2 rounded-2xl border bg-background p-4">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-medium">Sugestão {index + 1}</p>
                          <Badge variant="secondary">{formatPercentPtBr(item.confidence * 100)}% confiança</Badge>
                        </div>
                        <MealItemEditor item={item} onChange={(key, value) => onPhotoItemChange(index, key, value)} />
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <Button type="button" className="rounded-full" onClick={onConfirm} disabled={isConfirmPending || !photoEditableItems.length}>
                      <Save className="mr-2 h-4 w-4" />
                      {isConfirmPending ? "Salvando..." : "Confirmar e salvar refeição"}
                    </Button>
                    <Button type="button" variant="outline" className="rounded-full" onClick={onReject} disabled={isRejectPending}>
                      Rejeitar análise
                    </Button>
                  </div>
                </>
              ) : (
                <MealEmptyState text="Esta análise não está disponível para confirmação. Nenhuma refeição foi salva automaticamente." />
              )}
            </>
          ) : (
            <MealEmptyState text="As sugestões da foto aparecerão aqui com quantidade, calorias, macros e confiança para correção manual." />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
