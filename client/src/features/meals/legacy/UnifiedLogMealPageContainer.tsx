import React, { useMemo, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import PageIntro from "@/components/PageIntro";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  getBrowserTimeZone,
  toDateInputValue,
  toDateTimeLocalValue,
  zonedDateTimeLocalToIso,
} from "@/lib/dateTime";
import { formatCalories, formatGrams } from "@/lib/numberFormat";
import { trpc } from "@/lib/trpc";
import { calculateDayTotals, calculateMealTotals } from "../../../../../shared/mealTotals";
import { ArrowRight, CalendarDays, PencilLine, Star, WandSparkles } from "lucide-react";
import { toast } from "sonner";
import { Link } from "wouter";
import {
  MealAiTabContent,
  MealDayRecordsCard,
  MealManualEditorCard,
  MealModeGuide,
  SummaryPill,
} from "../components";
import { RegisteredMealsPage } from "../RegisteredMealsPageContent";
import type { DraftState, MealItemState, StoredMeal } from "../types";

type MealScheduleState = {
  mealLabel: string;
  startTime: string;
  endTime: string;
  enabled: boolean;
};

type MealTab = "registro" | "manual" | "hoje";

const MEAL_LABEL_SUGGESTIONS = [
  "café da manhã",
  "almoço",
  "lanche da tarde",
  "pré-treino",
  "pós-treino",
  "jantar",
  "ceia",
  "outro",
];

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

function createManualMealState(mealLabel = "almoço", occurredAt = toDateTimeLocalValue()) {
  return {
    mealId: undefined as number | undefined,
    mealLabel,
    occurredAt,
    notes: "",
    items: [createEmptyItem()],
  };
}

function minutesFromTime(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function isTimeWithinRange(timeMinutes: number, startTime: string, endTime: string) {
  const start = minutesFromTime(startTime);
  const end = minutesFromTime(endTime);
  if (start <= end) return timeMinutes >= start && timeMinutes <= end;
  return timeMinutes >= start || timeMinutes <= end;
}

function rangeCenterDistance(timeMinutes: number, startTime: string, endTime: string) {
  const start = minutesFromTime(startTime);
  let end = minutesFromTime(endTime);
  let current = timeMinutes;
  if (end < start) end += 1440;
  if (current < start) current += 1440;
  return Math.abs(current - (start + (end - start) / 2));
}

function localMinutesFromDateTimeLocal(value: string) {
  const match = value.match(/T(\d{2}):(\d{2})/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function suggestMealLabelFromSchedules(value: string, schedules: MealScheduleState[] | undefined) {
  const timeMinutes = localMinutesFromDateTimeLocal(value);
  const enabledSchedules = schedules?.filter(schedule => schedule.enabled && schedule.mealLabel.trim()) ?? [];
  if (timeMinutes === null || !enabledSchedules.length) return null;

  const directMatches = enabledSchedules
    .filter(schedule => isTimeWithinRange(timeMinutes, schedule.startTime, schedule.endTime))
    .sort((a, b) => rangeCenterDistance(timeMinutes, a.startTime, a.endTime) - rangeCenterDistance(timeMinutes, b.startTime, b.endTime));

  const fallback = enabledSchedules
    .slice()
    .sort((a, b) => rangeCenterDistance(timeMinutes, a.startTime, a.endTime) - rangeCenterDistance(timeMinutes, b.startTime, b.endTime))[0];

  return (directMatches[0] ?? fallback)?.mealLabel ?? null;
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

export default function LogMealPage() {
  const utils = trpc.useUtils();
  const mealsQuery = trpc.nutrition.meals.list.useQuery();
  const favoriteMealsQuery = trpc.nutrition.meals.favorites.useQuery();
  const mealSchedulesQuery = trpc.nutrition.mealSchedules.list.useQuery();
  const userTimeZone = useMemo(() => getBrowserTimeZone(), []);

  const mealSchedules = mealSchedulesQuery.data as MealScheduleState[] | undefined;
  const defaultMealLabel =
    suggestMealLabelFromSchedules(toDateTimeLocalValue(undefined, userTimeZone), mealSchedules) ?? "almoço";

  const [activeTab, setActiveTab] = useState<MealTab>("registro");
  const [description, setDescription] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [mealLabel, setMealLabel] = useState("");
  const [notes, setNotes] = useState("");
  const [occurredAt, setOccurredAt] = useState(() => toDateTimeLocalValue());
  const [editableItems, setEditableItems] = useState<MealItemState[]>([]);
  const [manualMeal, setManualMeal] = useState(() => createManualMealState(defaultMealLabel));
  const [selectedDay, setSelectedDay] = useState(() => toDateInputValue());

  const suggestedManualMealLabel = useMemo(
    () => suggestMealLabelFromSchedules(manualMeal.occurredAt, mealSchedules),
    [manualMeal.occurredAt, mealSchedules],
  );
  const suggestedDraftMealLabel = useMemo(
    () => suggestMealLabelFromSchedules(occurredAt, mealSchedules),
    [occurredAt, mealSchedules],
  );
  const configuredMealLabels = useMemo(
    () => Array.from(new Set([...(mealSchedules?.map(schedule => schedule.mealLabel).filter(Boolean) ?? []), ...MEAL_LABEL_SUGGESTIONS])),
    [mealSchedules],
  );

  React.useEffect(() => {
    if (!manualMeal.mealId && suggestedManualMealLabel && manualMeal.mealLabel !== suggestedManualMealLabel) {
      setManualMeal(current => (current.mealId ? current : { ...current, mealLabel: suggestedManualMealLabel }));
    }
  }, [manualMeal.mealId, manualMeal.mealLabel, suggestedManualMealLabel]);

  React.useEffect(() => {
    if (draft && suggestedDraftMealLabel && !mealLabel.trim()) setMealLabel(suggestedDraftMealLabel);
  }, [draft, mealLabel, suggestedDraftMealLabel]);

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
      setMealLabel(suggestedDraftMealLabel ?? result.processed.detectedMealLabel);
      setEditableItems(result.processed.items);
      setActiveTab("registro");
      toast.success("Registro preparado. Revise e ajuste antes de salvar.");
    },
    onError: error => toast.error(error.message || "Não foi possível processar a refeição."),
  });

  const confirmMeal = trpc.nutrition.meals.confirm.useMutation({
    onSuccess: async () => {
      await invalidateNutritionViews();
      toast.success("Refeição registrada com sucesso.");
      setDescription("");
      setImageFile(null);
      setAudioFile(null);
      setDraft(null);
      setEditableItems([]);
      setMealLabel("");
      setNotes("");
      setOccurredAt(toDateTimeLocalValue(undefined, userTimeZone));
    },
    onError: error => toast.error(error.message || "Não foi possível salvar a refeição agora."),
  });

  const createManualMeal = trpc.nutrition.meals.createManual.useMutation({
    onSuccess: async () => {
      await invalidateNutritionViews();
      toast.success("Refeição manual criada com sucesso.");
      resetManualMeal();
    },
    onError: error => toast.error(error.message || "Não foi possível criar a refeição manual."),
  });

  const updateMeal = trpc.nutrition.meals.update.useMutation({
    onSuccess: async () => {
      await invalidateNutritionViews();
      toast.success("Refeição atualizada com sucesso.");
      resetManualMeal();
    },
    onError: error => toast.error(error.message || "Não foi possível atualizar a refeição."),
  });

  const removeMeal = trpc.nutrition.meals.remove.useMutation({
    onSuccess: async () => {
      await invalidateNutritionViews();
      toast.success("Refeição removida com sucesso.");
      setManualMeal(current =>
        current.mealId
          ? createManualMealState(suggestMealLabelFromSchedules(current.occurredAt, mealSchedules) ?? "almoço", current.occurredAt)
          : current,
      );
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
      setActiveTab("manual");
    },
    onError: error => toast.error(error.message || "Não foi possível reutilizar a favorita."),
  });

  const previewTotals = useMemo(() => sumItems(editableItems), [editableItems]);
  const manualTotals = useMemo(() => sumItems(manualMeal.items), [manualMeal.items]);
  const selectedDayMeals = useMemo(
    () => (mealsQuery.data ?? []).filter(meal => new Date(meal.occurredAt).toISOString().slice(0, 10) === selectedDay),
    [mealsQuery.data, selectedDay],
  );
  const localDayTotals = useMemo(() => calculateDayTotals(selectedDayMeals), [selectedDayMeals]);
  const dayTotalsQuery = trpc.nutrition.meals.dayTotals.useQuery({ date: selectedDay });
  const dayTotals = dayTotalsQuery.data?.totals ?? localDayTotals;

  const mealLabelSuggestions = (
    <datalist id="meal-label-suggestions">
      {configuredMealLabels.map(label => (
        <option key={label} value={label} />
      ))}
    </datalist>
  );

  const handleProcess = async () => {
    if (!description && !imageFile && !audioFile) {
      toast.error("Informe pelo menos um conteúdo: texto, imagem ou áudio.");
      return;
    }

    processDraft.mutate({
      source: "web",
      text: description || undefined,
      image: imageFile ? { base64: await fileToBase64(imageFile), mimeType: imageFile.type, fileName: imageFile.name } : undefined,
      audio: audioFile ? { base64: await fileToBase64(audioFile), mimeType: audioFile.type, fileName: audioFile.name } : undefined,
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

    if (!manualMeal.mealLabel.trim()) {
      toast.error("Informe o nome da refeição.");
      return;
    }

    if (!normalizedItems.length || normalizedItems.some(item => !item.foodName)) {
      toast.error("Preencha ao menos um alimento na refeição manual.");
      return;
    }

    const payload = {
      mealLabel: manualMeal.mealLabel.trim(),
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
      mealLabel: meal.mealLabel,
      occurredAt: toDateTimeLocalValue(new Date(meal.occurredAt), userTimeZone),
      notes: meal.notes ?? "",
      items: meal.items.map(item => ({ ...item })),
    });
    setActiveTab("manual");
    toast.success("Modo manual aberto com a refeição selecionada.");
  };

  const favoriteMealsBlock = favoriteMealsQuery.data?.length ? (
    <div className="rounded-2xl border bg-muted/20 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="font-medium tracking-tight">Favoritas</p>
          <p className="text-sm text-muted-foreground">Use uma refeição pronta no dia selecionado.</p>
        </div>
        <Badge variant="secondary">{favoriteMealsQuery.data.length}</Badge>
      </div>
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
            <Star className="mr-2 h-4 w-4" />
            {favorite.name}
          </Button>
        ))}
      </div>
    </div>
  ) : null;

  function resetManualMeal() {
    const nextOccurredAt = toDateTimeLocalValue(undefined, userTimeZone);
    setManualMeal(createManualMealState(suggestMealLabelFromSchedules(nextOccurredAt, mealSchedules) ?? "almoço", nextOccurredAt));
  }

  const recordsCard = (
    <MealDayRecordsCard
      meals={selectedDayMeals as StoredMeal[]}
      userTimeZone={userTimeZone}
      selectedMealId={manualMeal.mealId}
      isLoading={mealsQuery.isLoading}
      isCopyPending={copyMeal.isPending}
      isFavoritePending={saveFavoriteMeal.isPending}
      isRemovePending={removeMeal.isPending}
      onEditMeal={loadMealForEditing}
      onCopyMeal={meal => copyMeal.mutate({ mealId: meal.id, occurredAt: zonedDateTimeLocalToIso(`${selectedDay}T12:00`, userTimeZone), mealLabel: meal.mealLabel })}
      onFavoriteMeal={meal => saveFavoriteMeal.mutate({ mealId: meal.id, name: meal.mealLabel })}
      onRemoveMeal={meal => removeMeal.mutate({ mealId: meal.id })}
    />
  );

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <PageIntro
          eyebrow="Registro de refeição"
          title="Registre com texto, foto ou áudio no mesmo fluxo"
          description="O registro concentra texto, foto do prato, foto de rótulo e áudio em uma única experiência. Depois da IA preparar os itens, você ajusta alimentos, porções, calorias e macros antes de salvar."
          stats={
            <div className="grid gap-3 sm:grid-cols-4">
              <SummaryPill label="Calorias" value={formatCalories(dayTotals.calories)} />
              <SummaryPill label="Proteínas" value={formatGrams(dayTotals.protein)} />
              <SummaryPill label="Carboidratos" value={formatGrams(dayTotals.carbs)} />
              <SummaryPill label="Gorduras" value={formatGrams(dayTotals.fat)} />
            </div>
          }
          actions={
            <>
              <div className="w-full min-w-[220px] sm:w-auto">
                <Label htmlFor="selected-day" className="mb-2 block text-xs uppercase tracking-[0.22em] text-muted-foreground">
                  Dia
                </Label>
                <Input id="selected-day" type="date" value={selectedDay} onChange={event => setSelectedDay(event.target.value)} className="h-11 min-w-[220px] rounded-xl" />
              </div>
              <Link href="/meals">
                <Button type="button" variant="outline" className="h-11 rounded-full px-5">
                  Abrir registros
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
            </>
          }
        />

        {mealLabelSuggestions}
        <MealModeGuide activeMode={activeTab} onModeChange={setActiveTab} />

        <Tabs value={activeTab} onValueChange={value => setActiveTab(value as MealTab)} className="gap-4">
          <TabsList className="grid h-auto w-full grid-cols-1 gap-2 rounded-2xl bg-muted/60 p-2 md:grid-cols-3">
            <TabsTrigger className="min-h-11 rounded-xl" value="registro">
              <WandSparkles className="h-4 w-4" />
              Registro de refeição
            </TabsTrigger>
            <TabsTrigger className="min-h-11 rounded-xl" value="manual">
              <PencilLine className="h-4 w-4" />
              Manual
            </TabsTrigger>
            <TabsTrigger className="min-h-11 rounded-xl" value="hoje">
              <CalendarDays className="h-4 w-4" />
              Hoje
            </TabsTrigger>
          </TabsList>

          <TabsContent value="registro" className="space-y-4">
            <MealAiTabContent
              description={description}
              onDescriptionChange={setDescription}
              imageFileName={imageFile?.name}
              audioFileName={audioFile?.name}
              onImageChange={event => setImageFile(event.target.files?.[0] ?? null)}
              onAudioChange={event => setAudioFile(event.target.files?.[0] ?? null)}
              onProcess={handleProcess}
              isProcessing={processDraft.isPending}
              draft={draft}
              mealLabel={mealLabel}
              onMealLabelChange={setMealLabel}
              suggestedMealLabel={suggestedDraftMealLabel}
              occurredAt={occurredAt}
              onOccurredAtChange={nextOccurredAt => {
                setOccurredAt(nextOccurredAt);
                setMealLabel(suggestMealLabelFromSchedules(nextOccurredAt, mealSchedules) ?? mealLabel);
              }}
              notes={notes}
              onNotesChange={setNotes}
              editableItems={editableItems}
              onEditableItemChange={(index, key, value) => updateItem(setEditableItems, index, key, value)}
              previewTotals={previewTotals}
              onConfirm={() => {
                if (!draft?.draftId) {
                  toast.error("Clique em Registrar antes de salvar a refeição.");
                  return;
                }
                confirmMeal.mutate({
                  draftId: draft.draftId,
                  mealLabel: (mealLabel || draft.processed.detectedMealLabel || "").trim(),
                  occurredAt: zonedDateTimeLocalToIso(occurredAt, userTimeZone),
                  notes: notes || undefined,
                  items: editableItems,
                });
              }}
              isConfirmPending={confirmMeal.isPending}
            />
          </TabsContent>

          <TabsContent value="manual" className="space-y-4">
            {favoriteMealsBlock}
            <MealManualEditorCard
              manualMeal={manualMeal}
              suggestedManualMealLabel={suggestedManualMealLabel}
              onMealLabelChange={value => setManualMeal(current => ({ ...current, mealLabel: value }))}
              onOccurredAtChange={nextOccurredAt =>
                setManualMeal(current => ({
                  ...current,
                  occurredAt: nextOccurredAt,
                  mealLabel: suggestMealLabelFromSchedules(nextOccurredAt, mealSchedules) ?? current.mealLabel,
                }))
              }
              onNotesChange={value => setManualMeal(current => ({ ...current, notes: value }))}
              onAddItem={() => setManualMeal(current => ({ ...current, items: [...current.items, createEmptyItem()] }))}
              onRemoveItem={index => setManualMeal(current => ({ ...current, items: current.items.filter((_, currentIndex) => currentIndex !== index) }))}
              onItemChange={(index, key, value) => updateManualItem(index, key, value)}
              manualTotals={manualTotals}
              onSubmit={handleSubmitManualMeal}
              isSubmitting={createManualMeal.isPending || updateMeal.isPending}
              onReset={resetManualMeal}
            />
          </TabsContent>

          <TabsContent value="hoje" className="space-y-4">
            {favoriteMealsBlock}
            {recordsCard}
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}

export { RegisteredMealsPage };
