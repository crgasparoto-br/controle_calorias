import React, { useMemo, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { getBrowserTimeZone, toDateTimeLocalValue, zonedDateTimeLocalToIso } from "@/lib/dateTime";
import {
  formatCalories,
  formatCountPtBr,
  formatDecimalInputPtBr,
  formatIntegerInputPtBr,
  formatNumberPtBr,
  parseDecimalInputPtBr,
  parseIntegerInputPtBr,
} from "@/lib/numberFormat";
import { trpc } from "@/lib/trpc";
import { calculateMealTotals } from "../../../../../shared/mealTotals";
import { Droplets, Dumbbell, PencilLine, Scale, Star, WandSparkles } from "lucide-react";
import { toast } from "sonner";
import { MealAiTabContent, MealManualEditorCard, SummaryPill } from "../components";
import { RegisteredMealsPage } from "../RegisteredMealsPageContent";
import type { DraftState, MealItemState } from "../types";

type MealScheduleState = {
  mealLabel: string;
  startTime: string;
  endTime: string;
  enabled: boolean;
};

type MealTab = "registro" | "manual" | "agua" | "exercicios" | "peso";

const MEAL_LABEL_SUGGESTIONS = ["café da manhã", "almoço", "lanche da tarde", "pré-treino", "pós-treino", "jantar", "ceia", "outro"];
const ONBOARDING_DEFAULTS = {
  objective: "melhorar_habitos" as const,
  activityLevel: "moderate" as const,
  trackingExperience: "beginner" as const,
  eatingRoutine: "misto" as const,
  mainDifficulty: "falta_de_planejamento" as const,
};

function createEmptyItem(): MealItemState {
  return { foodName: "", canonicalName: "", portionText: "1 porção", servings: 1, estimatedGrams: 0, calories: 0, protein: 0, carbs: 0, fat: 0, confidence: 1, source: "heuristic" };
}

function createManualMealState(mealLabel = "almoço", occurredAt = toDateTimeLocalValue()) {
  return { mealId: undefined as number | undefined, mealLabel, occurredAt, notes: "", items: [createEmptyItem()] };
}

function buildDefaultExerciseForm() {
  return { activityType: "Corrida", durationMinutes: formatIntegerInputPtBr(45), caloriesBurned: formatIntegerInputPtBr(450), occurredAt: toDateTimeLocalValue(new Date()), notes: "" };
}

function buildDefaultWaterForm() {
  return { amountMl: formatIntegerInputPtBr(300), occurredAt: toDateTimeLocalValue(new Date()), dailyTargetMl: formatIntegerInputPtBr(2500) };
}

function minutesFromTime(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function localMinutesFromDateTimeLocal(value: string) {
  const match = value.match(/T(\d{2}):(\d{2})/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function rangeCenterDistance(timeMinutes: number, startTime: string, endTime: string) {
  const start = minutesFromTime(startTime);
  let end = minutesFromTime(endTime);
  let current = timeMinutes;
  if (end < start) end += 1440;
  if (current < start) current += 1440;
  return Math.abs(current - (start + (end - start) / 2));
}

function isTimeWithinRange(timeMinutes: number, startTime: string, endTime: string) {
  const start = minutesFromTime(startTime);
  const end = minutesFromTime(endTime);
  if (start <= end) return timeMinutes >= start && timeMinutes <= end;
  return timeMinutes >= start || timeMinutes <= end;
}

function suggestMealLabelFromSchedules(value: string, schedules: MealScheduleState[] | undefined) {
  const timeMinutes = localMinutesFromDateTimeLocal(value);
  const enabledSchedules = schedules?.filter(schedule => schedule.enabled && schedule.mealLabel.trim()) ?? [];
  if (timeMinutes === null || !enabledSchedules.length) return null;
  const directMatches = enabledSchedules
    .filter(schedule => isTimeWithinRange(timeMinutes, schedule.startTime, schedule.endTime))
    .sort((a, b) => rangeCenterDistance(timeMinutes, a.startTime, a.endTime) - rangeCenterDistance(timeMinutes, b.startTime, b.endTime));
  const fallback = enabledSchedules.slice().sort((a, b) => rangeCenterDistance(timeMinutes, a.startTime, a.endTime) - rangeCenterDistance(timeMinutes, b.startTime, b.endTime))[0];
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

export default function LogMealPage() {
  const utils = trpc.useUtils();
  const favoritesQuery = trpc.nutrition.meals.favorites.useQuery();
  const schedulesQuery = trpc.nutrition.mealSchedules.list.useQuery();
  const overviewQuery = trpc.nutrition.dashboard.overview.useQuery();
  const reportsBundleQuery = trpc.nutrition.reports.bundle.useQuery();
  const waterGoalQuery = trpc.nutrition.water.goal.useQuery();
  const profileQuery = trpc.nutrition.onboarding.profile.useQuery();
  const userTimeZone = useMemo(() => getBrowserTimeZone(), []);
  const mealSchedules = schedulesQuery.data as MealScheduleState[] | undefined;
  const defaultMealLabel = suggestMealLabelFromSchedules(toDateTimeLocalValue(undefined, userTimeZone), mealSchedules) ?? "almoço";

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
  const [exerciseForm, setExerciseForm] = useState(buildDefaultExerciseForm);
  const [waterForm, setWaterForm] = useState(buildDefaultWaterForm);
  const [weightValue, setWeightValue] = useState("");
  const [weightMeasuredAt, setWeightMeasuredAt] = useState(() => toDateTimeLocalValue(new Date()));

  React.useEffect(() => {
    if (waterGoalQuery.data?.dailyTargetMl) {
      setWaterForm(current => ({ ...current, dailyTargetMl: formatIntegerInputPtBr(waterGoalQuery.data.dailyTargetMl) }));
    }
  }, [waterGoalQuery.data?.dailyTargetMl]);

  React.useEffect(() => {
    if (profileQuery.data?.currentWeightKg) {
      setWeightValue(formatDecimalInputPtBr(profileQuery.data.currentWeightKg, 1));
    }
  }, [profileQuery.data?.currentWeightKg]);

  const suggestedManualMealLabel = useMemo(() => suggestMealLabelFromSchedules(manualMeal.occurredAt, mealSchedules), [manualMeal.occurredAt, mealSchedules]);
  const suggestedDraftMealLabel = useMemo(() => suggestMealLabelFromSchedules(occurredAt, mealSchedules), [occurredAt, mealSchedules]);
  const configuredMealLabels = useMemo(() => Array.from(new Set([...(mealSchedules?.map(schedule => schedule.mealLabel).filter(Boolean) ?? []), ...MEAL_LABEL_SUGGESTIONS])), [mealSchedules]);
  const weightEntries = useMemo(() => [...(reportsBundleQuery.data?.progress.weight.entries ?? [])].reverse(), [reportsBundleQuery.data?.progress.weight.entries]);

  React.useEffect(() => {
    if (!manualMeal.mealId && suggestedManualMealLabel && manualMeal.mealLabel !== suggestedManualMealLabel) {
      setManualMeal(current => (current.mealId ? current : { ...current, mealLabel: suggestedManualMealLabel }));
    }
  }, [manualMeal.mealId, manualMeal.mealLabel, suggestedManualMealLabel]);

  React.useEffect(() => {
    if (draft && suggestedDraftMealLabel && !mealLabel.trim()) setMealLabel(suggestedDraftMealLabel);
  }, [draft, mealLabel, suggestedDraftMealLabel]);

  const invalidateViews = async () => {
    await Promise.all([
      utils.nutrition.dashboard.overview.invalidate(),
      utils.nutrition.meals.list.invalidate(),
      utils.nutrition.meals.dayTotals.invalidate(),
      utils.nutrition.meals.favorites.invalidate(),
      utils.nutrition.reports.weekly.invalidate(),
      utils.nutrition.reports.bundle.invalidate(),
      utils.nutrition.onboarding.profile.invalidate(),
      utils.nutrition.water.goal.invalidate(),
      utils.nutrition.water.list.invalidate(),
    ]);
  };

  const processDraft = trpc.nutrition.meals.processDraft.useMutation({
    onSuccess: result => {
      setDraft(result as DraftState);
      setMealLabel(suggestedDraftMealLabel ?? result.processed.detectedMealLabel);
      setEditableItems(result.processed.items);
      toast.success("Registro preparado. Revise e ajuste antes de salvar.");
    },
    onError: error => toast.error(error.message || "Não foi possível processar a refeição."),
  });

  const confirmMeal = trpc.nutrition.meals.confirm.useMutation({
    onSuccess: async () => {
      await invalidateViews();
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
    onError: error => toast.error(error.message || "Não foi possível salvar a refeição."),
  });

  const createManualMeal = trpc.nutrition.meals.createManual.useMutation({
    onSuccess: async () => {
      await invalidateViews();
      toast.success("Refeição manual criada com sucesso.");
      resetManualMeal();
    },
    onError: error => toast.error(error.message || "Não foi possível criar a refeição manual."),
  });

  const updateMeal = trpc.nutrition.meals.update.useMutation({
    onSuccess: async () => {
      await invalidateViews();
      toast.success("Refeição atualizada com sucesso.");
      resetManualMeal();
    },
    onError: error => toast.error(error.message || "Não foi possível atualizar a refeição."),
  });

  const removeMeal = trpc.nutrition.meals.remove.useMutation({
    onSuccess: async () => {
      await invalidateViews();
      toast.success("Refeição removida com sucesso.");
      setManualMeal(current => current.mealId ? createManualMealState(suggestMealLabelFromSchedules(current.occurredAt, mealSchedules) ?? "almoço", current.occurredAt) : current);
    },
    onError: error => toast.error(error.message || "Não foi possível remover a refeição."),
  });

  const saveFavoriteMeal = trpc.nutrition.meals.saveFavorite.useMutation({ onSuccess: async () => { await invalidateViews(); toast.success("Refeição salva como favorita."); }, onError: error => toast.error(error.message || "Não foi possível favoritar a refeição.") });
  const reuseFavoriteMeal = trpc.nutrition.meals.reuseFavorite.useMutation({ onSuccess: async () => { await invalidateViews(); toast.success("Refeição favorita reutilizada."); setActiveTab("manual"); }, onError: error => toast.error(error.message || "Não foi possível reutilizar a favorita.") });
  const createExercise = trpc.nutrition.exercises.create.useMutation({ onSuccess: async () => { await invalidateViews(); toast.success("Exercício registrado com sucesso."); setExerciseForm(buildDefaultExerciseForm()); }, onError: error => toast.error(error.message || "Não foi possível registrar o exercício.") });
  const removeExercise = trpc.nutrition.exercises.remove.useMutation({ onSuccess: async () => { await invalidateViews(); toast.success("Exercício removido com sucesso."); }, onError: error => toast.error(error.message || "Não foi possível remover o exercício.") });
  const createWaterLog = trpc.nutrition.water.create.useMutation({ onSuccess: async () => { await invalidateViews(); toast.success("Consumo de água registrado com sucesso."); setWaterForm(current => ({ ...current, amountMl: formatIntegerInputPtBr(300), occurredAt: toDateTimeLocalValue(new Date()) })); }, onError: error => toast.error(error.message || "Não foi possível registrar a água.") });
  const updateWaterGoal = trpc.nutrition.water.updateGoal.useMutation({ onSuccess: async () => { await invalidateViews(); toast.success("Meta diária de água atualizada."); }, onError: error => toast.error(error.message || "Não foi possível atualizar a meta.") });
  const removeWaterLog = trpc.nutrition.water.remove.useMutation({ onSuccess: async () => { await invalidateViews(); toast.success("Consumo de água removido com sucesso."); }, onError: error => toast.error(error.message || "Não foi possível remover o consumo.") });
  const updateWeight = trpc.nutrition.onboarding.complete.useMutation({ onSuccess: async () => { await invalidateViews(); toast.success("Peso atualizado com sucesso."); }, onError: error => toast.error(error.message || "Não foi possível atualizar o peso.") });

  const previewTotals = useMemo(() => calculateMealTotals(editableItems), [editableItems]);
  const manualTotals = useMemo(() => calculateMealTotals(manualMeal.items), [manualMeal.items]);
  const waterGoalValue = parseIntegerInputPtBr(waterForm.dailyTargetMl);
  const waterAmountValue = parseIntegerInputPtBr(waterForm.amountMl);
  const isWaterGoalInvalid = waterGoalValue < 250 || waterGoalValue > 10000;
  const isWaterAmountInvalid = waterAmountValue < 50 || waterAmountValue > 5000;
  const parsedWeight = parseDecimalInputPtBr(weightValue);
  const isWeightInvalid = !weightValue.trim() || parsedWeight < 25 || parsedWeight > 350;
  const currentWeightLabel = profileQuery.data?.currentWeightKg ? `${formatNumberPtBr(profileQuery.data.currentWeightKg, { minimumFractionDigits: 0, maximumFractionDigits: 1 })} kg` : "Não informado";

  const handleProcess = async () => {
    if (!description && !imageFile && !audioFile) {
      toast.error("Informe pelo menos texto, imagem ou áudio.");
      return;
    }
    processDraft.mutate({
      source: "web",
      text: description || undefined,
      image: imageFile ? { base64: await fileToBase64(imageFile), mimeType: imageFile.type, fileName: imageFile.name } : undefined,
      audio: audioFile ? { base64: await fileToBase64(audioFile), mimeType: audioFile.type, fileName: audioFile.name } : undefined,
    });
  };

  const handleExerciseSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    createExercise.mutate({ activityType: exerciseForm.activityType.trim(), durationMinutes: parseIntegerInputPtBr(exerciseForm.durationMinutes), caloriesBurned: parseIntegerInputPtBr(exerciseForm.caloriesBurned), occurredAt: zonedDateTimeLocalToIso(exerciseForm.occurredAt), notes: exerciseForm.notes.trim() || undefined });
  };

  const handleWaterSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    createWaterLog.mutate({ amountMl: waterAmountValue, occurredAt: zonedDateTimeLocalToIso(waterForm.occurredAt) });
  };

  const handleWeightSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const profile = profileQuery.data;
    if (!profile?.birthDate || !profile?.heightCm) {
      toast.error("Abra Configurações uma vez para completar o perfil antes de atualizar o peso por aqui.");
      return;
    }
    if (isWeightInvalid) {
      toast.error("Informe um peso entre 25 kg e 350 kg.");
      return;
    }
    updateWeight.mutate({
      name: profile.name?.trim() || "Usuário",
      birthDate: profile.birthDate,
      heightCm: profile.heightCm,
      currentWeightKg: parsedWeight,
      weightMeasuredAt: zonedDateTimeLocalToIso(weightMeasuredAt, userTimeZone),
      weightEntryNote: "Peso atualizado na tela Record.",
      objective: profile.objective ?? ONBOARDING_DEFAULTS.objective,
      activityLevel: profile.activityLevel ?? ONBOARDING_DEFAULTS.activityLevel,
      trackingExperience: profile.trackingExperience ?? ONBOARDING_DEFAULTS.trackingExperience,
      dietaryPreferences: profile.dietaryPreferences ?? [],
      dietaryRestrictions: profile.dietaryRestrictions ?? [],
      eatingRoutine: profile.eatingRoutine ?? ONBOARDING_DEFAULTS.eatingRoutine,
      mainDifficulty: profile.mainDifficulty ?? ONBOARDING_DEFAULTS.mainDifficulty,
    });
  };

  const updateItem = <K extends keyof MealItemState>(setter: React.Dispatch<React.SetStateAction<MealItemState[]>>, index: number, key: K, value: MealItemState[K]) => {
    setter(current => current.map((item, currentIndex) => (currentIndex === index ? { ...item, [key]: value } : item)));
  };

  const updateManualItem = <K extends keyof MealItemState>(index: number, key: K, value: MealItemState[K]) => {
    setManualMeal(current => ({ ...current, items: current.items.map((item, currentIndex) => (currentIndex === index ? { ...item, [key]: value } : item)) }));
  };

  const handleSubmitManualMeal = () => {
    const items = manualMeal.items.map(item => ({ ...item, foodName: item.foodName.trim(), canonicalName: item.canonicalName.trim() || item.foodName.trim(), portionText: item.portionText.trim() || "1 porção", confidence: Number(item.confidence || 1) }));
    if (!manualMeal.mealLabel.trim()) return toast.error("Informe o nome da refeição.");
    if (!items.length || items.some(item => !item.foodName)) return toast.error("Preencha ao menos um alimento na refeição manual.");
    const payload = { mealLabel: manualMeal.mealLabel.trim(), occurredAt: zonedDateTimeLocalToIso(manualMeal.occurredAt, userTimeZone), notes: manualMeal.notes.trim() || undefined, items };
    if (manualMeal.mealId) return updateMeal.mutate({ mealId: manualMeal.mealId, ...payload });
    createManualMeal.mutate(payload);
  };

  function resetManualMeal() {
    const nextOccurredAt = toDateTimeLocalValue(undefined, userTimeZone);
    setManualMeal(createManualMealState(suggestMealLabelFromSchedules(nextOccurredAt, mealSchedules) ?? "almoço", nextOccurredAt));
  }

  const favoriteMealsBlock = favoritesQuery.data?.length ? (
    <div className="rounded-2xl border bg-muted/20 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="font-medium tracking-tight">Favoritas</p>
          <p className="text-sm text-muted-foreground">Use uma refeição pronta na data do cadastro manual.</p>
        </div>
        <Badge variant="secondary">{favoritesQuery.data.length}</Badge>
      </div>
      <div className="flex flex-wrap gap-2">
        {favoritesQuery.data.map(favorite => (
          <Button key={favorite.id} type="button" variant="outline" className="rounded-full" onClick={() => reuseFavoriteMeal.mutate({ favoriteMealId: favorite.id, occurredAt: zonedDateTimeLocalToIso(manualMeal.occurredAt, userTimeZone) })} disabled={reuseFavoriteMeal.isPending}>
            <Star className="mr-2 h-4 w-4" />
            {favorite.name}
          </Button>
        ))}
      </div>
    </div>
  ) : null;

  const waterCard = (
    <Card className="border-0 shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl"><Droplets className="h-5 w-5 text-primary" />Registrar água</CardTitle>
        <CardDescription>Use esta aba para lançar consumo, ajustar a meta diária e revisar lançamentos recentes. O acompanhamento por período fica em Relatórios.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <SummaryPill label="Consumido" value={formatCountPtBr(overviewQuery.data?.today.water.consumedMl ?? 0, " ml")} />
          <SummaryPill label="Meta" value={formatCountPtBr(overviewQuery.data?.today.water.goalMl ?? 0, " ml")} />
          <SummaryPill label="Restante" value={formatCountPtBr(overviewQuery.data?.today.water.remainingMl ?? 0, " ml")} />
        </div>
        <form className="space-y-3" onSubmit={handleWaterSubmit}>
          <div className="space-y-2">
            <Label htmlFor="record-water-goal">Meta diária (ml)</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input id="record-water-goal" type="text" inputMode="numeric" value={waterForm.dailyTargetMl} onChange={event => setWaterForm(current => ({ ...current, dailyTargetMl: formatIntegerInputPtBr(event.target.value) }))} className={isWaterGoalInvalid ? "border-amber-500 ring-1 ring-amber-200" : undefined} />
              <Button type="button" variant="outline" className="rounded-full" onClick={() => updateWaterGoal.mutate({ dailyTargetMl: waterGoalValue })} disabled={updateWaterGoal.isPending || isWaterGoalInvalid}>{updateWaterGoal.isPending ? "Salvando..." : "Salvar meta"}</Button>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="record-water-amount">Consumo (ml)</Label>
              <Input id="record-water-amount" type="text" inputMode="numeric" value={waterForm.amountMl} onChange={event => setWaterForm(current => ({ ...current, amountMl: formatIntegerInputPtBr(event.target.value) }))} className={isWaterAmountInvalid ? "border-amber-500 ring-1 ring-amber-200" : undefined} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="record-water-occurred-at">Data e hora</Label>
              <Input id="record-water-occurred-at" type="datetime-local" value={waterForm.occurredAt} onChange={event => setWaterForm(current => ({ ...current, occurredAt: event.target.value }))} />
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">{[200, 300, 500].map(shortcut => <Button key={shortcut} type="button" variant="outline" className="rounded-full" onClick={() => createWaterLog.mutate({ amountMl: shortcut, occurredAt: new Date().toISOString() })} disabled={createWaterLog.isPending}>+ {formatCountPtBr(shortcut, " ml")}</Button>)}</div>
          <Button type="submit" className="w-full rounded-full" disabled={createWaterLog.isPending || isWaterAmountInvalid}>{createWaterLog.isPending ? "Salvando consumo..." : "Registrar água"}</Button>
        </form>
        <div className="space-y-2">{(overviewQuery.data?.water.logs ?? []).slice(0, 3).map(log => <QuickLog key={log.id} title={formatCountPtBr(log.amountMl, " ml")} subtitle={new Date(Number(log.occurredAt)).toLocaleString("pt-BR")} actionLabel="Remover" onAction={() => removeWaterLog.mutate({ waterLogId: log.id })} disabled={removeWaterLog.isPending} />)}{!(overviewQuery.data?.water.logs ?? []).length ? <EmptyMini text="Nenhum consumo de água foi registrado ainda." /> : null}</div>
      </CardContent>
    </Card>
  );

  const exerciseCard = (
    <Card className="border-0 shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl"><Dumbbell className="h-5 w-5 text-primary" />Registrar exercício</CardTitle>
        <CardDescription>Use esta aba para lançar atividade, revisar lançamentos recentes e corrigir o dia. O acompanhamento por período fica em Relatórios.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form className="space-y-3" onSubmit={handleExerciseSubmit}>
          <Field label="Atividade"><Input value={exerciseForm.activityType} onChange={event => setExerciseForm(current => ({ ...current, activityType: event.target.value }))} placeholder="Ex.: Corrida leve" /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Duração (min)"><Input type="text" inputMode="numeric" value={exerciseForm.durationMinutes} onChange={event => setExerciseForm(current => ({ ...current, durationMinutes: formatIntegerInputPtBr(event.target.value) }))} /></Field>
            <Field label="Gasto estimado (kcal)"><Input type="text" inputMode="numeric" value={exerciseForm.caloriesBurned} onChange={event => setExerciseForm(current => ({ ...current, caloriesBurned: formatIntegerInputPtBr(event.target.value) }))} /></Field>
          </div>
          <Field label="Data e hora"><Input type="datetime-local" value={exerciseForm.occurredAt} onChange={event => setExerciseForm(current => ({ ...current, occurredAt: event.target.value }))} /></Field>
          <Field label="Observações"><Textarea value={exerciseForm.notes} onChange={event => setExerciseForm(current => ({ ...current, notes: event.target.value }))} className="min-h-24 rounded-2xl" /></Field>
          <Button type="submit" className="w-full rounded-full" disabled={createExercise.isPending}>{createExercise.isPending ? "Salvando exercício..." : "Registrar exercício"}</Button>
        </form>
        <div className="space-y-2">{(overviewQuery.data?.exercises ?? []).slice(0, 3).map(exercise => <QuickLog key={exercise.id} title={exercise.activityType} subtitle={`${formatCountPtBr(exercise.durationMinutes, " min")} · ${formatCalories(exercise.caloriesBurned)}`} extra={new Date(Number(exercise.occurredAt)).toLocaleString("pt-BR")} actionLabel="Remover" onAction={() => removeExercise.mutate({ exerciseId: exercise.id })} disabled={removeExercise.isPending} />)}{!(overviewQuery.data?.exercises ?? []).length ? <EmptyMini text="Nenhum exercício foi registrado ainda." /> : null}</div>
      </CardContent>
    </Card>
  );

  const weightCard = (
    <Card className="border-0 shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl"><Scale className="h-5 w-5 text-primary" />Peso atual</CardTitle>
        <CardDescription>Registre o peso com data de medição para acompanhar a evolução ao longo do tempo.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <SummaryPill label="Peso salvo" value={currentWeightLabel} />
          <SummaryPill label="Perfil" value={profileQuery.data?.name?.trim() || "Usuário"} />
        </div>
        <form className="space-y-3" onSubmit={handleWeightSubmit}>
          <Field label="Peso atual (kg)"><Input type="text" inputMode="decimal" value={weightValue} onChange={event => setWeightValue(formatDecimalInputPtBr(event.target.value, 1))} className={isWeightInvalid ? "border-amber-500 ring-1 ring-amber-200" : undefined} placeholder="Ex.: 72,5" /></Field>
          <Field label="Data e hora da medição"><Input type="datetime-local" value={weightMeasuredAt} onChange={event => setWeightMeasuredAt(event.target.value)} /></Field>
          <Button type="submit" className="w-full rounded-full" disabled={updateWeight.isPending || isWeightInvalid}>{updateWeight.isPending ? "Salvando peso..." : "Salvar peso"}</Button>
        </form>
        <div className="space-y-2">
          {weightEntries.slice(0, 5).map(entry => (
            <QuickLog key={entry.id} title={`${formatNumberPtBr(entry.weightKg, { minimumFractionDigits: 0, maximumFractionDigits: 1 })} kg`} subtitle={new Date(`${entry.date}T12:00:00`).toLocaleDateString("pt-BR")} extra={entry.notes || undefined} />
          ))}
          {!weightEntries.length ? <EmptyMini text="Nenhum peso registrado ainda." /> : null}
        </div>
      </CardContent>
    </Card>
  );

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <datalist id="meal-label-suggestions">{configuredMealLabels.map(label => <option key={label} value={label} />)}</datalist>

        <Card className="border-0 bg-muted/20 shadow-sm">
          <CardContent className="p-5 text-sm leading-6 text-muted-foreground">
            Esta tela foi organizada para registrar o que aconteceu no dia, revisar rascunhos e corrigir lançamentos rápidos. Para acompanhar padrão, frequência e evolução de água, exercícios e refeições, use Relatórios.
          </CardContent>
        </Card>

        <Tabs value={activeTab} onValueChange={value => setActiveTab(value as MealTab)} className="gap-4">
          <TabsList className="grid h-auto w-full grid-cols-2 gap-2 rounded-2xl bg-muted/60 p-2 md:grid-cols-3 xl:grid-cols-5">
            <TabsTrigger className="min-h-11 rounded-xl" value="registro"><WandSparkles className="h-4 w-4" />Record com IA</TabsTrigger>
            <TabsTrigger className="min-h-11 rounded-xl" value="manual"><PencilLine className="h-4 w-4" />Manual</TabsTrigger>
            <TabsTrigger className="min-h-11 rounded-xl" value="agua"><Droplets className="h-4 w-4" />Água do dia</TabsTrigger>
            <TabsTrigger className="min-h-11 rounded-xl" value="exercicios"><Dumbbell className="h-4 w-4" />Exercícios</TabsTrigger>
            <TabsTrigger className="min-h-11 rounded-xl" value="peso"><Scale className="h-4 w-4" />Peso atual</TabsTrigger>
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
                if (!draft?.draftId) return toast.error("Clique em Registrar antes de salvar a refeição.");
                confirmMeal.mutate({ draftId: draft.draftId, mealLabel: (mealLabel || draft.processed.detectedMealLabel || "").trim(), occurredAt: zonedDateTimeLocalToIso(occurredAt, userTimeZone), notes: notes || undefined, items: editableItems });
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
              onOccurredAtChange={nextOccurredAt => setManualMeal(current => ({ ...current, occurredAt: nextOccurredAt, mealLabel: suggestMealLabelFromSchedules(nextOccurredAt, mealSchedules) ?? current.mealLabel }))}
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

          <TabsContent value="agua" className="space-y-4">
            {waterCard}
          </TabsContent>

          <TabsContent value="exercicios" className="space-y-4">
            {exerciseCard}
          </TabsContent>

          <TabsContent value="peso" className="space-y-4">
            {weightCard}
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-2"><Label>{label}</Label>{children}</div>;
}

function QuickLog({ title, subtitle, extra, actionLabel, onAction, disabled }: { title: string; subtitle: string; extra?: string; actionLabel?: string; onAction?: () => void; disabled?: boolean }) {
  return (
    <div className="rounded-2xl border bg-muted/30 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium tracking-tight">{title}</p>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
          {extra ? <p className="text-xs text-muted-foreground">{extra}</p> : null}
        </div>
        {actionLabel && onAction ? <Button type="button" size="sm" variant="outline" className="rounded-full" onClick={onAction} disabled={disabled}>{actionLabel}</Button> : null}
      </div>
    </div>
  );
}

function EmptyMini({ text }: { text: string }) {
  return <div className="rounded-2xl border border-dashed bg-muted/20 p-4 text-sm text-muted-foreground">{text}</div>;
}

export { RegisteredMealsPage };
