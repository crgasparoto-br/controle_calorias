import React from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { BrainCircuit, ImagePlus, Mic, Save, WandSparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

type DraftState = {
  draftId: string;
  processed: {
    detectedMealLabel: string;
    sourceText: string;
    transcript?: string;
    confidence: number;
    reasoning: string;
    items: Array<{
      foodName: string;
      canonicalName: string;
      portionText: string;
      servings: number;
      estimatedGrams: number;
      calories: number;
      protein: number;
      carbs: number;
      fat: number;
      confidence: number;
      source: "catalog" | "hybrid" | "heuristic";
    }>;
    totals: {
      calories: number;
      protein: number;
      carbs: number;
      fat: number;
    };
  };
};

async function fileToBase64(file: File) {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function LogMealPage() {
  const utils = trpc.useUtils();
  const [description, setDescription] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [mealLabel, setMealLabel] = useState("");
  const [notes, setNotes] = useState("");
  const [occurredAt, setOccurredAt] = useState(() => new Date().toISOString().slice(0, 16));
  const [editableItems, setEditableItems] = useState<DraftState["processed"]["items"]>([]);

  const processDraft = trpc.nutrition.meals.processDraft.useMutation({
    onSuccess: result => {
      setDraft(result as DraftState);
      setMealLabel(result.processed.detectedMealLabel);
      setEditableItems(result.processed.items);
      toast.success("Inferência preparada. Revise os itens antes de salvar.");
    },
    onError: error => {
      toast.error(error.message || "Não foi possível processar a refeição.");
    },
  });

  const confirmMeal = trpc.nutrition.meals.confirm.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.nutrition.dashboard.overview.invalidate(),
        utils.nutrition.meals.list.invalidate(),
        utils.nutrition.reports.weekly.invalidate(),
      ]);
      toast.success("Refeição salva com sucesso.");
      setDescription("");
      setImageFile(null);
      setAudioFile(null);
      setDraft(null);
      setEditableItems([]);
      setMealLabel("");
      setNotes("");
      setOccurredAt(new Date().toISOString().slice(0, 16));
    },
    onError: error => toast.error(error.message || "Falha ao confirmar a refeição."),
  });

  const previewTotals = useMemo(() => {
    return editableItems.reduce(
      (acc, item) => {
        acc.calories += Number(item.calories || 0);
        acc.protein += Number(item.protein || 0);
        acc.carbs += Number(item.carbs || 0);
        acc.fat += Number(item.fat || 0);
        return acc;
      },
      { calories: 0, protein: 0, carbs: 0, fat: 0 },
    );
  }, [editableItems]);

  const handleProcess = async () => {
    if (!description && !imageFile && !audioFile) {
      toast.error("Informe pelo menos um conteúdo: texto, imagem ou áudio.");
      return;
    }

    const image = imageFile
      ? {
          base64: await fileToBase64(imageFile),
          mimeType: imageFile.type,
          fileName: imageFile.name,
        }
      : undefined;

    const audio = audioFile
      ? {
          base64: await fileToBase64(audioFile),
          mimeType: audioFile.type,
          fileName: audioFile.name,
        }
      : undefined;

    processDraft.mutate({
      source: "web",
      text: description || undefined,
      image,
      audio,
    });
  };

  const updateItem = <K extends keyof DraftState["processed"]["items"][number]>(index: number, key: K, value: DraftState["processed"]["items"][number][K]) => {
    setEditableItems(current => current.map((item, currentIndex) => (currentIndex === index ? { ...item, [key]: value } : item)));
  };

  return (
    <DashboardLayout>
      <div className="grid gap-6 xl:grid-cols-[1.1fr,0.9fr]">
        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <WandSparkles className="h-5 w-5 text-primary" />
              Registrar refeição com IA multimodal
            </CardTitle>
            <CardDescription>
              Envie texto, foto do prato, foto do rótulo ou áudio narrando a refeição. A IA estruturaliza o conteúdo para revisão antes do salvamento.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="meal-description">Descrição em texto</Label>
              <Textarea
                id="meal-description"
                value={description}
                onChange={event => setDescription(event.target.value)}
                placeholder="Ex.: almocei arroz, feijão, frango grelhado e salada"
                className="min-h-36 rounded-2xl"
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2 rounded-2xl border bg-muted/20 p-4">
                <Label htmlFor="meal-image" className="flex items-center gap-2 text-sm font-medium">
                  <ImagePlus className="h-4 w-4 text-primary" />
                  Imagem do prato ou rótulo
                </Label>
                <Input id="meal-image" type="file" accept="image/*" onChange={event => setImageFile(event.target.files?.[0] ?? null)} />
                <p className="text-xs text-muted-foreground">{imageFile ? imageFile.name : "Nenhuma imagem selecionada."}</p>
              </div>
              <div className="space-y-2 rounded-2xl border bg-muted/20 p-4">
                <Label htmlFor="meal-audio" className="flex items-center gap-2 text-sm font-medium">
                  <Mic className="h-4 w-4 text-primary" />
                  Áudio da refeição
                </Label>
                <Input id="meal-audio" type="file" accept="audio/*" onChange={event => setAudioFile(event.target.files?.[0] ?? null)} />
                <p className="text-xs text-muted-foreground">{audioFile ? audioFile.name : "Nenhum áudio selecionado."}</p>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <Button className="rounded-full" onClick={handleProcess} disabled={processDraft.isPending}>
                <BrainCircuit className="mr-2 h-4 w-4" />
                {processDraft.isPending ? "Processando..." : "Gerar inferência"}
              </Button>
              <Badge variant="secondary">Texto + imagem + áudio podem ser usados juntos</Badge>
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle>Fluxo de confirmação</CardTitle>
            <CardDescription>
              A IA sugere alimentos e porções. Você pode ajustar livremente os valores antes de confirmar o registro definitivo.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {draft ? (
              <>
                <div className="rounded-2xl border bg-muted/20 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm text-muted-foreground">Confiança estimada</p>
                      <p className="text-2xl font-semibold tracking-tight">{Math.round(draft.processed.confidence * 100)}%</p>
                    </div>
                    <Badge>{draft.processed.items.length} itens identificados</Badge>
                  </div>
                  <p className="mt-4 text-sm leading-6 text-muted-foreground">{draft.processed.reasoning}</p>
                  {draft.processed.transcript ? (
                    <div className="mt-4 rounded-2xl bg-background p-3 text-sm text-muted-foreground">
                      <strong className="text-foreground">Transcrição:</strong> {draft.processed.transcript}
                    </div>
                  ) : null}
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="meal-label">Nome da refeição</Label>
                    <Input id="meal-label" value={mealLabel} onChange={event => setMealLabel(event.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="occurred-at">Data e horário</Label>
                    <Input id="occurred-at" type="datetime-local" value={occurredAt} onChange={event => setOccurredAt(event.target.value)} />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="meal-notes">Observações</Label>
                  <Textarea id="meal-notes" value={notes} onChange={event => setNotes(event.target.value)} placeholder="Observações adicionais do usuário" className="min-h-24 rounded-2xl" />
                </div>

                <div className="space-y-3">
                  {editableItems.map((item, index) => (
                    <div key={`${item.foodName}-${index}`} className="rounded-2xl border bg-background p-4 shadow-sm">
                      <div className="grid gap-3 lg:grid-cols-2">
                        <div className="space-y-2">
                          <Label>Alimento</Label>
                          <Input value={item.foodName} onChange={event => updateItem(index, "foodName", event.target.value)} />
                        </div>
                        <div className="space-y-2">
                          <Label>Nome canônico</Label>
                          <Input value={item.canonicalName} onChange={event => updateItem(index, "canonicalName", event.target.value)} />
                        </div>
                        <div className="space-y-2">
                          <Label>Porção</Label>
                          <Input value={item.portionText} onChange={event => updateItem(index, "portionText", event.target.value)} />
                        </div>
                        <div className="space-y-2">
                          <Label>Gramas estimados</Label>
                          <Input type="number" value={item.estimatedGrams} onChange={event => updateItem(index, "estimatedGrams", Number(event.target.value))} />
                        </div>
                        <div className="space-y-2">
                          <Label>Calorias</Label>
                          <Input type="number" value={item.calories} onChange={event => updateItem(index, "calories", Number(event.target.value))} />
                        </div>
                        <div className="space-y-2">
                          <Label>Proteínas</Label>
                          <Input type="number" value={item.protein} onChange={event => updateItem(index, "protein", Number(event.target.value))} />
                        </div>
                        <div className="space-y-2">
                          <Label>Carboidratos</Label>
                          <Input type="number" value={item.carbs} onChange={event => updateItem(index, "carbs", Number(event.target.value))} />
                        </div>
                        <div className="space-y-2">
                          <Label>Gorduras</Label>
                          <Input type="number" value={item.fat} onChange={event => updateItem(index, "fat", Number(event.target.value))} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="rounded-2xl border bg-muted/30 p-4">
                  <p className="text-sm text-muted-foreground">Totais após revisão</p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-4">
                    <SummaryPill label="Calorias" value={`${Math.round(previewTotals.calories)} kcal`} />
                    <SummaryPill label="Proteínas" value={`${Math.round(previewTotals.protein)} g`} />
                    <SummaryPill label="Carboidratos" value={`${Math.round(previewTotals.carbs)} g`} />
                    <SummaryPill label="Gorduras" value={`${Math.round(previewTotals.fat)} g`} />
                  </div>
                </div>

                <Button
                  className="w-full rounded-full"
                  disabled={confirmMeal.isPending || editableItems.length === 0}
                  onClick={() => {
                    confirmMeal.mutate({
                      draftId: draft.draftId,
                      mealLabel: mealLabel || draft.processed.detectedMealLabel,
                      occurredAt: new Date(occurredAt).toISOString(),
                      notes: notes || undefined,
                      items: editableItems,
                    });
                  }}
                >
                  <Save className="mr-2 h-4 w-4" />
                  {confirmMeal.isPending ? "Salvando..." : "Confirmar e salvar refeição"}
                </Button>
              </>
            ) : (
              <div className="rounded-2xl border border-dashed bg-muted/20 p-6 text-sm leading-6 text-muted-foreground">
                Nenhuma inferência foi criada ainda. Após enviar conteúdo multimodal, os alimentos identificados aparecerão aqui para revisão detalhada.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}

function SummaryPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-background p-4 text-center shadow-sm">
      <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-lg font-semibold tracking-tight">{value}</p>
    </div>
  );
}
