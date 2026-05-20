import React from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTimeInTimeZone, getBrowserTimeZone, toDateInputValue, toDateTimeLocalValue, zonedDateTimeLocalToIso } from "@/lib/dateTime";
import { formatCalories, formatCountPtBr, formatGrams, formatPercentPtBr } from "@/lib/numberFormat";
import { trpc } from "@/lib/trpc";
import { calculateDayTotals, calculateMealTotals } from "../../../../../shared/mealTotals";
import { BrainCircuit, CalendarPlus, Copy, ImagePlus, Mic, PencilLine, Plus, Save, Star, Trash2, WandSparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

type MealItemState = {
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
};

type DraftState = {
  draftId: string;
  processed: {
    detectedMealLabel: string;
    sourceText: string;
    transcript?: string;
    confidence: number;
    reasoning: string;
    items: MealItemState[];
    totals: {
      calories: number;
      protein: number;
      carbs: number;
      fat: number;
    };
  };
};

type FoodPhotoAnalysisState = {
  id: string;
  status: "pending" | "analyzed" | "confirmed" | "rejected";
  suggestedItems: Array<{
    foodName: string;
    estimatedQuantity: number;
    unit: string;
    estimatedCalories: number;
    estimatedMacros: {
      protein: number;
      carbs: number;
      fat: number;
    };
    confidenceScore: number;
  }>;
  editableItems: MealItemState[];
};

type StoredMeal = {
  id: number;
  mealLabel: string;
  occurredAt: number;
  notes?: string;
  source: "web" | "whatsapp";
  items: MealItemState[];
  totals: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
  };
};

const MEAL_TYPES = ["café da manhã", "almoço", "jantar", "lanche", "outro"] as const;
type MealType = (typeof MEAL_TYPES)[number];

function createEmptyItem(): MealItemState {
  return {
    foodName: "",
    canonicalName: "",
    portionText: "1 porção",
    servings: 1,
    estimatedGrams: 0,
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
    confidence: 1,
    source: "heuristic",
  };
}

function createManualMealState() {
  return {
    mealId: undefined as number | undefined,
    mealLabel: "almoço" as MealType,
    occurredAt: toDateTimeLocalValue(),
    notes: "",
    items: [createEmptyItem()],
  };
}

async function fileToBase64(file: File) {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function sumItems(items: MealItemState[]) {
  return calculateMealTotals(items);
}

type LogMealPageProps = {
  registeredOnly?: boolean;
};

export function RegisteredMealsPage() {
  return <LogMealPageContent registeredOnly />;
}

export default function LogMealPage() {
  return <LogMealPageContent />;
}

function LogMealPageContent({ registeredOnly = false }: LogMealPageProps = {}) {
  const utils = trpc.useUtils();
  const mealsQuery = trpc.nutrition.meals.list.useQuery();
  const favoriteMealsQuery = trpc.nutrition.meals.favorites.useQuery();
  const userTimeZone = useMemo(() => getBrowserTimeZone(), []);
  const manualEditorRef = React.useRef<HTMLDivElement>(null);

  const [description, setDescription] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoAnalysis, setPhotoAnalysis] = useState<FoodPhotoAnalysisState | null>(null);
  const [photoMealLabel, setPhotoMealLabel] = useState<MealType>("almoço");
  const [photoOccurredAt, setPhotoOccurredAt] = useState(() => toDateTimeLocalValue());
  const [photoNotes, setPhotoNotes] = useState("");
  const [photoEditableItems, setPhotoEditableItems] = useState<MealItemState[]>([]);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [mealLabel, setMealLabel] = useState("");
  const [notes, setNotes] = useState("");
  const [occurredAt, setOccurredAt] = useState(() => toDateTimeLocalValue());
  const [editableItems, setEditableItems] = useState<MealItemState[]>([]);
  const [manualMeal, setManualMeal] = useState(createManualMealState);
  const [selectedDay, setSelectedDay] = useState(() => toDateInputValue());
  const dayTotalsQuery = trpc.nutrition.meals.dayTotals.useQuery({ date: selectedDay });

  const invalidateNutritionViews = async () => {
    await Promise.all([
      utils.nutrition.dashboard.overview.invalidate(),
      utils.nutrition.meals.list.invalidate(),
      utils.nutrition.meals.dayTotals.invalidate(),
      utils.nutrition.meals.favorites.invalidate(),
      utils.nutrition.reports.weekly.invalidate(),
    ]);
  };

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
      await invalidateNutritionViews();
      toast.success("Refeição salva com sucesso.");
      setDescription("");
      setImageFile(null);
      setAudioFile(null);
      setDraft(null);
      setEditableItems([]);
      setMealLabel("");
      setNotes("");
      setOccurredAt(toDateTimeLocalValue(undefined, userTimeZone));
    },
    onError: error => toast.error(error.message || "Não foi possível confirmar a refeição agora."),
  });

  const analyzeFoodPhoto = trpc.nutrition.foodPhotoAnalysis.analyze.useMutation({
    onSuccess: result => {
      const analysis = result as FoodPhotoAnalysisState;
      setPhotoAnalysis(analysis);
      setPhotoEditableItems(analysis.editableItems);
      toast.success("Foto analisada. Revise as sugestões antes de salvar.");
    },
    onError: error => toast.error(error.message || "Não foi possível analisar a foto."),
  });

  const confirmFoodPhoto = trpc.nutrition.foodPhotoAnalysis.confirm.useMutation({
    onSuccess: async () => {
      await invalidateNutritionViews();
      toast.success("Refeição da foto salva após confirmação.");
      setPhotoFile(null);
      setPhotoAnalysis(null);
      setPhotoEditableItems([]);
      setPhotoMealLabel("almoço");
      setPhotoOccurredAt(toDateTimeLocalValue(undefined, userTimeZone));
      setPhotoNotes("");
    },
    onError: error => toast.error(error.message || "Não foi possível confirmar a análise da foto."),
  });

  const rejectFoodPhoto = trpc.nutrition.foodPhotoAnalysis.reject.useMutation({
    onSuccess: result => {
      setPhotoAnalysis(current => current ? { ...current, status: result.status } : current);
      setPhotoEditableItems([]);
      toast.success("Análise rejeitada. Nenhuma refeição foi salva.");
    },
    onError: error => toast.error(error.message || "Não foi possível rejeitar a análise."),
  });

  const createManualMeal = trpc.nutrition.meals.createManual.useMutation({
    onSuccess: async () => {
      await invalidateNutritionViews();
      toast.success("Refeição manual criada com sucesso.");
      setManualMeal(createManualMealState());
    },
    onError: error => toast.error(error.message || "Não foi possível criar a refeição manual."),
  });

  const updateMeal = trpc.nutrition.meals.update.useMutation({
    onSuccess: async () => {
      await invalidateNutritionViews();
      toast.success("Refeição atualizada com sucesso.");
      setManualMeal(createManualMealState());
    },
    onError: error => toast.error(error.message || "Não foi possível atualizar a refeição."),
  });

  const removeMeal = trpc.nutrition.meals.remove.useMutation({
    onSuccess: async () => {
      await invalidateNutritionViews();
      toast.success("Refeição removida com sucesso.");
      setManualMeal(current => (current.mealId ? createManualMealState() : current));
    },
    onError: error => toast.error(error.message || "Não foi possível remover a refeição."),
  });

  const copyMeal = trpc.nutrition.meals.copy.useMutation({
    onSuccess: async () => {
      await invalidateNutritionViews();
      toast.success("Refeição copiada para a data selecionada.");
    },
    onError: error => toast.error(error.message || "Não foi possível copiar a refeição."),
  });

  const saveFavoriteMeal = trpc.nutrition.meals.saveFavorite.useMutation({
    onSuccess: async () => {
      await invalidateNutritionViews();
      toast.success("Refeição salva como favorita.");
    },
    onError: error => toast.error(error.message || "Não foi possível favoritar a refeição."),
  });

  const reuseFavoriteMeal = trpc.nutrition.meals.reuseFavorite.useMutation({
    onSuccess: async () => {
      await invalidateNutritionViews();
      toast.success("Refeição favorita reutilizada.");
    },
    onError: error => toast.error(error.message || "Não foi possível reutilizar a favorita."),
  });

  const previewTotals = useMemo(() => sumItems(editableItems), [editableItems]);
  const manualTotals = useMemo(() => sumItems(manualMeal.items), [manualMeal.items]);
  const localDayTotals = useMemo(() => calculateDayTotals(mealsQuery.data ?? []), [mealsQuery.data]);

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

  const handleAnalyzeFoodPhoto = async () => {
    if (!photoFile) {
      toast.error("Selecione uma foto da refeição para analisar.");
      return;
    }

    analyzeFoodPhoto.mutate({
      image: {
        base64: await fileToBase64(photoFile),
        mimeType: photoFile.type,
        fileName: photoFile.name,
      },
    });
  };

  const handleConfirmFoodPhoto = () => {
    if (!photoAnalysis || !photoEditableItems.length) {
      toast.error("Analise uma foto e revise os itens antes de confirmar.");
      return;
    }

    confirmFoodPhoto.mutate({
      analysisId: photoAnalysis.id,
      mealLabel: photoMealLabel,
      occurredAt: zonedDateTimeLocalToIso(photoOccurredAt, userTimeZone),
      notes: photoNotes.trim() || undefined,
      items: photoEditableItems,
    });
  };

  const updateItem = <K extends keyof MealItemState>(
    setter: React.Dispatch<React.SetStateAction<MealItemState[]>>,
    index: number,
    key: K,
    value: MealItemState[K],
  ) => {
    setter(current => current.map((item, currentIndex) => (currentIndex === index ? { ...item, [key]: value } : item)));
  };

  const updateManualItem = <K extends keyof MealItemState>(index: number, key: K, value: MealItemState[K]) => {
    setManualMeal(current => ({
      ...current,
      items: current.items.map((item, currentIndex) => (currentIndex === index ? { ...item, [key]: value } : item)),
    }));
  };

  const handleSubmitManualMeal = () => {
    const normalizedItems = manualMeal.items.map(item => ({
      ...item,
      foodName: item.foodName.trim(),
      canonicalName: item.canonicalName.trim() || item.foodName.trim(),
      portionText: item.portionText.trim() || "1 porção",
      confidence: Number(item.confidence || 1),
    }));

    if (!normalizedItems.length || normalizedItems.some(item => !item.foodName)) {
      toast.error("Preencha ao menos um alimento na refeição manual.");
      return;
    }

    const payload = {
      mealLabel: manualMeal.mealLabel,
      occurredAt: zonedDateTimeLocalToIso(manualMeal.occurredAt, userTimeZone),
      notes: manualMeal.notes.trim() || undefined,
      items: normalizedItems,
    };

    if (manualMeal.mealId) {
      updateMeal.mutate({ mealId: manualMeal.mealId, ...payload });
      return;
    }

    createManualMeal.mutate(payload);
  };

  const loadMealForEditing = (meal: StoredMeal) => {
    setManualMeal({
      mealId: meal.id,
      mealLabel: MEAL_TYPES.includes(meal.mealLabel as MealType) ? meal.mealLabel as MealType : "outro",
      occurredAt: toDateTimeLocalValue(new Date(meal.occurredAt), userTimeZone),
      notes: meal.notes ?? "",
      items: meal.items.map(item => ({ ...item })),
    });
    toast.success("Formulário de edição aberto abaixo da refeição selecionada.");
  };

  const manualMealEditorBlock = (
    <div ref={manualEditorRef}>
      <Card className="border-0 shadow-sm ring-1 ring-primary/20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <PencilLine className="h-5 w-5 text-primary" />
            {manualMeal.mealId ? "Editar refeição selecionada" : "Criar refeição manualmente"}
          </CardTitle>
          <CardDescription>
            {manualMeal.mealId
              ? "Altere os dados abaixo e clique em salvar alterações para atualizar esta refeição."
              : "Use este bloco para criar refeições sem IA e manter seu histórico alimentar manualmente."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="manual-meal-label">Nome da refeição</Label>
              <Select value={manualMeal.mealLabel} onValueChange={(mealLabel: MealType) => setManualMeal(current => ({ ...current, mealLabel }))}>
                <SelectTrigger id="manual-meal-label"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MEAL_TYPES.map(type => <SelectItem key={type} value={type}>{type}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="manual-occurred-at">Data e horário</Label>
              <Input id="manual-occurred-at" type="datetime-local" value={manualMeal.occurredAt} onChange={event => setManualMeal(current => ({ ...current, occurredAt: event.target.value }))} />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="manual-notes">Observações</Label>
            <Textarea id="manual-notes" value={manualMeal.notes} onChange={event => setManualMeal(current => ({ ...current, notes: event.target.value }))} placeholder="Ex.: refeição pré-treino" className="min-h-24 rounded-2xl" />
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium tracking-tight">Itens da refeição</p>
              <Button
                type="button"
                variant="outline"
                className="rounded-full"
                onClick={() => setManualMeal(current => ({ ...current, items: [...current.items, createEmptyItem()] }))}
              >
                <Plus className="mr-2 h-4 w-4" />
                Adicionar item
              </Button>
            </div>

            {manualMeal.items.map((item, index) => (
              <div key={`manual-${index}`} className="space-y-3 rounded-2xl border bg-background p-4 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium">Item {index + 1}</p>
                  {manualMeal.items.length > 1 ? (
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      onClick={() =>
                        setManualMeal(current => ({
                          ...current,
                          items: current.items.filter((_, currentIndex) => currentIndex !== index),
                        }))
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  ) : null}
                </div>
                <MealItemEditor item={item} onChange={(key, value) => updateManualItem(index, key, value)} />
              </div>
            ))}
          </div>

          <div className="rounded-2xl border bg-muted/30 p-4">
            <p className="text-sm text-muted-foreground">Totais da refeição manual</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-4">
              <SummaryPill label="Calorias" value={formatCalories(manualTotals.calories)} />
              <SummaryPill label="Proteínas" value={formatGrams(manualTotals.protein)} />
              <SummaryPill label="Carboidratos" value={formatGrams(manualTotals.carbs)} />
              <SummaryPill label="Gorduras" value={formatGrams(manualTotals.fat)} />
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button className="rounded-full" onClick={handleSubmitManualMeal} disabled={createManualMeal.isPending || updateMeal.isPending}>
              <Save className="mr-2 h-4 w-4" />
              {manualMeal.mealId ? (updateMeal.isPending ? "Atualizando..." : "Salvar alterações") : createManualMeal.isPending ? "Criando..." : "Criar refeição manual"}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="rounded-full"
              onClick={() => setManualMeal(createManualMealState())}
            >
              {manualMeal.mealId ? "Cancelar edição" : "Limpar formulário"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );

  const registeredMealsBlock = (
    <Card className="border-0 shadow-sm">
      <CardHeader>
        <CardTitle>Refeições registradas</CardTitle>
        <CardDescription>
          Edite, copie, favorite ou remova registros para manter seu acompanhamento alimentar ajustado.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {favoriteMealsQuery.data?.length ? (
          <div className="mb-4 rounded-2xl border bg-muted/20 p-4">
            <p className="mb-3 text-sm font-medium tracking-tight">Refeições favoritas</p>
            <div className="flex flex-wrap gap-2">
              {favoriteMealsQuery.data.map(favorite => (
                <Button
                  key={favorite.id}
                  type="button"
                  variant="outline"
                  className="rounded-full"
                  onClick={() => reuseFavoriteMeal.mutate({ favoriteMealId: favorite.id, occurredAt: zonedDateTimeLocalToIso(`${selectedDay}T12:00`, userTimeZone) })}
                  disabled={reuseFavoriteMeal.isPending}
                >
                  <CalendarPlus className="mr-2 h-4 w-4" />
                  {favorite.name}
                </Button>
              ))}
            </div>
          </div>
        ) : null}
        {mealsQuery.data?.length ? (
          mealsQuery.data.map(meal => (
            <div key={meal.id} className="rounded-2xl border bg-background p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium tracking-tight">{meal.mealLabel}</p>
                    <Badge variant="secondary">{meal.source === "web" ? "Web" : "WhatsApp"}</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">{formatDateTimeInTimeZone(meal.occurredAt, userTimeZone)}</p>
                  {meal.notes ? <p className="mt-2 text-sm text-muted-foreground">{meal.notes}</p> : null}
                </div>
                <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">{formatCalories(meal.totals.calories)}</Badge>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {meal.items.map((item, index) => (
                  <Badge key={`${meal.id}-${item.foodName}-${index}`} variant="outline" className="rounded-full px-3 py-1 text-xs">
                    {item.foodName} · {item.portionText}
                  </Badge>
                ))}
              </div>
              <div className="mt-4 flex flex-wrap gap-3">
                <Button type="button" variant={manualMeal.mealId === meal.id ? "default" : "outline"} className="rounded-full" onClick={() => loadMealForEditing(meal as StoredMeal)}>
                  <PencilLine className="mr-2 h-4 w-4" />
                  {manualMeal.mealId === meal.id ? "Editando esta refeição" : "Editar refeição"}
                </Button>
                <Button type="button" variant="outline" className="rounded-full" onClick={() => copyMeal.mutate({ mealId: meal.id, occurredAt: zonedDateTimeLocalToIso(`${selectedDay}T12:00`, userTimeZone), mealLabel: MEAL_TYPES.includes(meal.mealLabel as MealType) ? meal.mealLabel as MealType : "outro" })} disabled={copyMeal.isPending}>
                  <Copy className="mr-2 h-4 w-4" />
                  Copiar para o dia
                </Button>
                <Button type="button" variant="outline" className="rounded-full" onClick={() => saveFavoriteMeal.mutate({ mealId: meal.id, name: meal.mealLabel })} disabled={saveFavoriteMeal.isPending}>
                  <Star className="mr-2 h-4 w-4" />
                  Salvar favorita
                </Button>
                <Button type="button" variant="ghost" className="rounded-full text-destructive hover:text-destructive" onClick={() => removeMeal.mutate({ mealId: meal.id })} disabled={removeMeal.isPending}>
                  <Trash2 className="mr-2 h-4 w-4" />
                  Excluir refeição
                </Button>
              </div>
              {manualMeal.mealId === meal.id ? (
                <div className="mt-5 rounded-3xl border border-primary/30 bg-primary/5 p-3">
                  {manualMealEditorBlock}
                </div>
              ) : null}
            </div>
          ))
        ) : (
          <div className="rounded-2xl border border-dashed bg-muted/20 p-6 text-sm leading-6 text-muted-foreground">
            {registeredOnly
              ? "Nenhuma refeição foi registrada ainda."
              : "Nenhuma refeição foi registrada ainda. Você pode começar pelo fluxo multimodal acima ou criar uma refeição manual neste mesmo módulo."}
          </div>
        )}
      </CardContent>
    </Card>
  );

  if (registeredOnly) {
    return (
      <DashboardLayout>
        <div className="space-y-6">
          {registeredMealsBlock}
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle>Totais do dia</CardTitle>
            <CardDescription>Acompanhe calorias e macros do dia enquanto registra novas refeições.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="max-w-xs space-y-2">
              <Label>Dia</Label>
              <Input type="date" value={selectedDay} onChange={event => setSelectedDay(event.target.value)} />
            </div>
            <div className="grid gap-3 sm:grid-cols-4">
              <SummaryPill label="Calorias" value={formatCalories(dayTotalsQuery.data?.totals.calories ?? localDayTotals.calories)} />
              <SummaryPill label="Proteínas" value={formatGrams(dayTotalsQuery.data?.totals.protein ?? localDayTotals.protein)} />
              <SummaryPill label="Carboidratos" value={formatGrams(dayTotalsQuery.data?.totals.carbs ?? localDayTotals.carbs)} />
              <SummaryPill label="Gorduras" value={formatGrams(dayTotalsQuery.data?.totals.fat ?? localDayTotals.fat)} />
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <ImagePlus className="h-5 w-5 text-primary" />
              Registrar refeição por foto
            </CardTitle>
            <CardDescription>
              A foto gera uma análise com alimentos prováveis, porções e confiança. A refeição só é salva depois da sua confirmação.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5 xl:grid-cols-[0.85fr,1.15fr]">
            <div className="space-y-4">
              <div className="space-y-2 rounded-2xl border bg-muted/20 p-4">
                <Label htmlFor="photo-analysis-image">Foto da refeição</Label>
                <Input id="photo-analysis-image" type="file" accept="image/*" onChange={event => setPhotoFile(event.target.files?.[0] ?? null)} />
                <p className="text-xs text-muted-foreground">{photoFile ? photoFile.name : "Nenhuma foto selecionada."}</p>
              </div>
              <Button type="button" className="rounded-full" onClick={handleAnalyzeFoodPhoto} disabled={analyzeFoodPhoto.isPending}>
                <BrainCircuit className="mr-2 h-4 w-4" />
                {analyzeFoodPhoto.isPending ? "Analisando..." : "Analisar foto"}
              </Button>
              <p className="text-sm leading-6 text-muted-foreground">
                A análise pode errar alimentos e porções. Corrija os campos antes de salvar para manter seu histórico confiável.
              </p>
            </div>

            <div className="space-y-4">
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
                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                          <Label>Nome da refeição</Label>
                          <Select value={photoMealLabel} onValueChange={(value: MealType) => setPhotoMealLabel(value)}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {MEAL_TYPES.map(type => <SelectItem key={type} value={type}>{type}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label>Data e horário</Label>
                          <Input type="datetime-local" value={photoOccurredAt} onChange={event => setPhotoOccurredAt(event.target.value)} />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label>Observações</Label>
                        <Textarea value={photoNotes} onChange={event => setPhotoNotes(event.target.value)} placeholder="Ex.: porção corrigida após revisar a foto" className="min-h-20 rounded-2xl" />
                      </div>

                      <div className="space-y-3">
                        {photoEditableItems.map((item, index) => (
                          <div key={`photo-${index}`} className="space-y-2 rounded-2xl border bg-background p-4">
                            <div className="flex items-center justify-between gap-3">
                              <p className="text-sm font-medium">Sugestão {index + 1}</p>
                              <Badge variant="secondary">{formatPercentPtBr(item.confidence * 100)}% confiança</Badge>
                            </div>
                            <MealItemEditor item={item} onChange={(key, value) => updateItem(setPhotoEditableItems, index, key, value)} />
                          </div>
                        ))}
                      </div>

                      <div className="flex flex-wrap gap-3">
                        <Button type="button" className="rounded-full" onClick={handleConfirmFoodPhoto} disabled={confirmFoodPhoto.isPending || !photoEditableItems.length}>
                          <Save className="mr-2 h-4 w-4" />
                          {confirmFoodPhoto.isPending ? "Salvando..." : "Confirmar e salvar refeição"}
                        </Button>
                        <Button type="button" variant="outline" className="rounded-full" onClick={() => rejectFoodPhoto.mutate({ analysisId: photoAnalysis.id })} disabled={rejectFoodPhoto.isPending}>
                          Rejeitar análise
                        </Button>
                      </div>
                    </>
                  ) : (
                    <div className="rounded-2xl border border-dashed bg-muted/20 p-6 text-sm leading-6 text-muted-foreground">
                      Esta análise não está disponível para confirmação. Nenhuma refeição foi salva automaticamente.
                    </div>
                  )}
                </>
              ) : (
                <div className="rounded-2xl border border-dashed bg-muted/20 p-6 text-sm leading-6 text-muted-foreground">
                  As sugestões da foto aparecerão aqui com quantidade, unidade, calorias, macros e confiança para correção manual.
                </div>
              )}
            </div>
          </CardContent>
        </Card>

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

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="meal-label">Nome da refeição</Label>
                      <Select value={MEAL_TYPES.includes(mealLabel as MealType) ? mealLabel : "outro"} onValueChange={setMealLabel}>
                        <SelectTrigger id="meal-label"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {MEAL_TYPES.map(type => <SelectItem key={type} value={type}>{type}</SelectItem>)}
                        </SelectContent>
                      </Select>
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
                      <MealItemEditor key={`${item.foodName}-${index}`} item={item} onChange={(key, value) => updateItem(setEditableItems, index, key, value)} />
                    ))}
                  </div>

                  <div className="rounded-2xl border bg-muted/30 p-4">
                    <p className="text-sm text-muted-foreground">Totais após revisão</p>
                    <div className="mt-3 grid gap-3 sm:grid-cols-4">
                      <SummaryPill label="Calorias" value={formatCalories(previewTotals.calories)} />
                      <SummaryPill label="Proteínas" value={formatGrams(previewTotals.protein)} />
                      <SummaryPill label="Carboidratos" value={formatGrams(previewTotals.carbs)} />
                      <SummaryPill label="Gorduras" value={formatGrams(previewTotals.fat)} />
                    </div>
                  </div>

                  <Button
                    className="w-full rounded-full"
                    disabled={confirmMeal.isPending || editableItems.length === 0}
                    onClick={() => {
                      confirmMeal.mutate({
                        draftId: draft.draftId,
                        mealLabel: mealLabel || draft.processed.detectedMealLabel,
                        occurredAt: zonedDateTimeLocalToIso(occurredAt, userTimeZone),
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

        <div className="grid gap-6 xl:grid-cols-[0.95fr,1.05fr]">
          {manualMeal.mealId ? null : manualMealEditorBlock}
          {registeredMealsBlock}
        </div>
      </div>
    </DashboardLayout>
  );
}

function MealItemEditor({
  item,
  onChange,
}: {
  item: MealItemState;
  onChange: <K extends keyof MealItemState>(key: K, value: MealItemState[K]) => void;
}) {
  const foods = trpc.nutrition.foods.search.useQuery(
    { query: item.foodName, limit: 5 },
    { enabled: item.foodName.trim().length >= 2 },
  );

  const applyFood = (food: NonNullable<typeof foods.data>[number]) => {
    onChange("foodName", food.name);
    onChange("canonicalName", food.name);
    onChange("portionText", `${food.servingSize} ${food.servingUnit}`);
    onChange("servings", 1);
    onChange("estimatedGrams", food.servingUnit === "g" ? food.servingSize : 0);
    onChange("calories", food.calories);
    onChange("protein", food.protein);
    onChange("carbs", food.carbs);
    onChange("fat", food.fat);
    onChange("confidence", 1);
    onChange("source", "catalog");
  };

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <div className="space-y-2">
        <Label>Alimento</Label>
        <Input value={item.foodName} onChange={event => onChange("foodName", event.target.value)} />
        {foods.data?.length ? (
          <div className="flex flex-wrap gap-2">
            {foods.data.map(food => (
              <Button key={food.id} type="button" variant="outline" size="sm" className="h-8 rounded-full" onClick={() => applyFood(food)}>
                {food.name}
              </Button>
            ))}
          </div>
        ) : null}
      </div>
      <div className="space-y-2">
        <Label>Nome canônico</Label>
        <Input value={item.canonicalName} onChange={event => onChange("canonicalName", event.target.value)} />
      </div>
      <div className="space-y-2">
        <Label>Unidade</Label>
        <Input value={item.portionText} onChange={event => onChange("portionText", event.target.value)} />
      </div>
      <div className="space-y-2">
        <Label>Quantidade</Label>
        <Input type="number" value={item.estimatedGrams} onChange={event => onChange("estimatedGrams", Number(event.target.value))} />
      </div>
      <div className="space-y-2">
        <Label>Calorias</Label>
        <Input type="number" value={item.calories} onChange={event => onChange("calories", Number(event.target.value))} />
      </div>
      <div className="space-y-2">
        <Label>Proteínas</Label>
        <Input type="number" value={item.protein} onChange={event => onChange("protein", Number(event.target.value))} />
      </div>
      <div className="space-y-2">
        <Label>Carboidratos</Label>
        <Input type="number" value={item.carbs} onChange={event => onChange("carbs", Number(event.target.value))} />
      </div>
      <div className="space-y-2">
        <Label>Gorduras</Label>
        <Input type="number" value={item.fat} onChange={event => onChange("fat", Number(event.target.value))} />
      </div>
    </div>
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
