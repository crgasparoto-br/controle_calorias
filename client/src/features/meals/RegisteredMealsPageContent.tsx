import DashboardLayout from "@/components/DashboardLayout";
import PageIntro from "@/components/PageIntro";
import { PeriodScopeSelector } from "@/components/PeriodScopeSelector";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  formatDateLabel,
  formatRangeLabel,
  getMonthRange,
  getWeekRange,
  normalizeDateRange,
  toMonthInputValue,
  type PeriodScope,
} from "@/lib/dateRanges";
import { getBrowserTimeZone, toDateInputValue, toDateTimeLocalValue, zonedDateTimeLocalToIso } from "@/lib/dateTime";
import { formatCalories, formatCountPtBr, formatGrams } from "@/lib/numberFormat";
import { trpc } from "@/lib/trpc";
import { CalendarPlus, ChevronDown, Droplets, Dumbbell, ListChecks, PencilLine, Plus, Save, Star, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { MealItemEditor, MealLabelInput, RegisteredMealGroups, SummaryPill } from "./components";
import { createEmptyItem, createManualMealState, sumItems } from "./mealFormState";
import {
  type DateGroupedRegisteredMealsViewModel,
  buildDateGroupedMealGroups,
  buildRegisteredMealGroups,
  filterMealsByDateRange,
  normalizeMealType,
  sumStoredMealTotals,
} from "./mealViewModels";
import type { MealItemState, MealType, StoredMeal } from "./types";

type MealScheduleState = {
  mealLabel: string;
  startTime: string;
  endTime: string;
  enabled: boolean;
};

type WaterLogRecord = {
  id: number;
  amountMl: number;
  occurredAt: string | number | Date;
};

type ExerciseRecord = {
  id: number;
  activityType: string;
  durationMinutes: number;
  caloriesBurned: number;
  occurredAt: string | number | Date;
  notes?: string | null;
};

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
    .sort((a, b) => rangeCenterDistance(timeMinutes, a.startTime, a.endTime) - rangeCenterDistance(timeMinutes, b.startTime, b.startTime));
  const fallback = enabledSchedules
    .slice()
    .sort((a, b) => rangeCenterDistance(timeMinutes, a.startTime, a.endTime) - rangeCenterDistance(timeMinutes, b.startTime, b.endTime))[0];
  return (directMatches[0] ?? fallback)?.mealLabel ?? null;
}

function buildRecordsHeading(scope: PeriodScope) {
  switch (scope) {
    case "day":
      return {
        title: "Registros operacionais do dia",
        description: "Veja o que foi lançado hoje e faça correções, cópias ou reaproveitamento sem sair da área operacional.",
        listTitle: "Refeições do dia",
      };
    case "week":
      return {
        title: "Registros agrupados por semana",
        description: "A semana mostra refeições, água e exercícios agrupados por dia para facilitar revisão rápida e manutenção do que foi lançado.",
        listTitle: "Refeições da semana",
      };
    case "month":
      return {
        title: "Resumo operacional do mês",
        description: "O mês prioriza um resumo por dia, com expansão sob demanda para manter a tela leve.",
        listTitle: "Resumo por dia no mês",
      };
    case "range":
      return {
        title: "Consulta por período configurável",
        description: "Escolha um intervalo e abra só os dias que precisar revisar ou reaproveitar.",
        listTitle: "Registros do período",
      };
  }
}

function buildDateSectionDescription(scope: PeriodScope) {
  switch (scope) {
    case "week":
      return "A semana abre com os dias expandidos para acelerar a revisão.";
    case "month":
      return "O mês mostra primeiro um resumo por dia. Abra só os dias que precisar detalhar.";
    case "range":
      return "Períodos longos ficam recolhidos por padrão para evitar excesso de informação de uma vez.";
    default:
      return "";
  }
}

function toDateKeyInTimeZone(value: string | number | Date, timeZone: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function isDateKeyInRange(dateKey: string, range: { start: string; end: string }) {
  return Boolean(dateKey) && dateKey >= range.start && dateKey <= range.end;
}

function formatDateTimeLabel(value: string | number | Date, timeZone: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value)).replace(",", "");
}

function DateGroupedMealsSections({
  groups,
  scope,
  userTimeZone,
  selectedMealId,
  emptyMessage,
  forceMealGroupsCollapsed,
  isCopyPending,
  isFavoritePending,
  isRemovePending,
  onEditMeal,
  onCopyMeal,
  onFavoriteMeal,
  onRemoveMeal,
}: {
  groups: DateGroupedRegisteredMealsViewModel[];
  scope: PeriodScope;
  userTimeZone: string;
  selectedMealId?: number;
  emptyMessage: string;
  forceMealGroupsCollapsed?: boolean;
  isCopyPending?: boolean;
  isFavoritePending?: boolean;
  isRemovePending?: boolean;
  onEditMeal?: (meal: StoredMeal) => void;
  onCopyMeal?: (meal: StoredMeal, mealLabel: MealType) => void;
  onFavoriteMeal?: (meal: StoredMeal) => void;
  onRemoveMeal?: (meal: StoredMeal) => void;
}) {
  if (!groups.length) {
    return (
      <div className="rounded-2xl border border-dashed bg-muted/20 p-6 text-sm leading-6 text-muted-foreground">
        {emptyMessage}
      </div>
    );
  }

  const defaultOpen = scope === "week";

  return (
    <div className="space-y-4">
      {groups.map(group => (
        <details key={group.date} className="group rounded-3xl border bg-muted/10 p-4" open={defaultOpen}>
          <summary className="flex cursor-pointer list-none flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-base font-semibold tracking-tight">{formatDateLabel(group.date, { weekday: "long", day: "2-digit", month: "short" })}</p>
              <p className="text-sm text-muted-foreground">
                {group.mealCount} refeições · {group.itemCount} itens lançados
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <SummaryPill label="Calorias" value={formatCalories(group.totals.calories)} />
              <SummaryPill label="Proteínas" value={formatGrams(group.totals.protein)} />
              <SummaryPill label="Carboidratos" value={formatGrams(group.totals.carbs)} />
              <SummaryPill label="Gorduras" value={formatGrams(group.totals.fat)} />
            </div>
          </summary>
          <div className="pt-4">
            <RegisteredMealGroups
              groups={group.groups}
              userTimeZone={userTimeZone}
              selectedMealId={selectedMealId}
              emptyMessage="Nenhuma refeição encontrada para este dia."
              forceCollapsed={forceMealGroupsCollapsed}
              isCopyPending={isCopyPending}
              isFavoritePending={isFavoritePending}
              isRemovePending={isRemovePending}
              onEditMeal={onEditMeal}
              onCopyMeal={onCopyMeal}
              onFavoriteMeal={onFavoriteMeal}
              onRemoveMeal={onRemoveMeal}
            />
          </div>
        </details>
      ))}
    </div>
  );
}

function HabitRecordsSection({
  waterLogs,
  exerciseLogs,
  userTimeZone,
  isLoading,
}: {
  waterLogs: WaterLogRecord[];
  exerciseLogs: ExerciseRecord[];
  userTimeZone: string;
  isLoading?: boolean;
}) {
  const waterTotalMl = waterLogs.reduce((total, log) => total + (log.amountMl ?? 0), 0);
  const exerciseTotalCalories = exerciseLogs.reduce((total, exercise) => total + (exercise.caloriesBurned ?? 0), 0);
  const exerciseTotalMinutes = exerciseLogs.reduce((total, exercise) => total + (exercise.durationMinutes ?? 0), 0);

  return (
    <Card collapsible={false} className="border-0 shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl">
          <Droplets className="h-5 w-5 text-primary" />
          Água e exercícios no período
        </CardTitle>
        <CardDescription>Revise os registros operacionais de hidratação e atividade física no mesmo intervalo selecionado para as refeições.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryPill label="Água" value={formatCountPtBr(waterTotalMl, " ml")} />
          <SummaryPill label="Registros de água" value={String(waterLogs.length)} />
          <SummaryPill label="Exercícios" value={formatCalories(exerciseTotalCalories)} />
          <SummaryPill label="Tempo ativo" value={formatCountPtBr(exerciseTotalMinutes, " min")} />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border bg-muted/10 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="font-medium tracking-tight">Registros de água</p>
                <p className="text-sm text-muted-foreground">{waterLogs.length} {waterLogs.length === 1 ? "lançamento" : "lançamentos"}</p>
              </div>
              <Droplets className="h-5 w-5 text-primary" />
            </div>
            <div className="space-y-2">
              {isLoading ? <EmptyOperationalRecord text="Carregando água..." /> : null}
              {!isLoading && !waterLogs.length ? <EmptyOperationalRecord text="Nenhum consumo de água no intervalo." /> : null}
              {waterLogs.map(log => (
                <OperationalRecord key={log.id} label={`${formatDateTimeLabel(log.occurredAt, userTimeZone)} - ${formatCountPtBr(log.amountMl, "ml")}`} />
              ))}
            </div>
          </div>

          <div className="rounded-2xl border bg-muted/10 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="font-medium tracking-tight">Registros de exercícios</p>
                <p className="text-sm text-muted-foreground">{exerciseLogs.length} {exerciseLogs.length === 1 ? "lançamento" : "lançamentos"}</p>
              </div>
              <Dumbbell className="h-5 w-5 text-primary" />
            </div>
            <div className="space-y-2">
              {isLoading ? <EmptyOperationalRecord text="Carregando exercícios..." /> : null}
              {!isLoading && !exerciseLogs.length ? <EmptyOperationalRecord text="Nenhum exercício no intervalo." /> : null}
              {exerciseLogs.map(exercise => (
                <OperationalRecord
                  key={exercise.id}
                  label={`${formatDateTimeLabel(exercise.occurredAt, userTimeZone)} - ${exercise.activityType} ${formatCountPtBr(exercise.durationMinutes, " min")} . ${formatCalories(exercise.caloriesBurned)}`}
                />
              ))}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function RegisteredMealsPage() {
  const utils = trpc.useUtils();
  const userTimeZone = useMemo(() => getBrowserTimeZone(), []);
  const [periodScope, setPeriodScope] = useState<PeriodScope>("day");
  const [selectedDay, setSelectedDay] = useState(() => toDateInputValue());
  const [selectedMonth, setSelectedMonth] = useState(() => toMonthInputValue(new Date(), userTimeZone));
  const [rangeStart, setRangeStart] = useState(() => toDateInputValue(new Date(Date.now() - 6 * 24 * 60 * 60 * 1000), userTimeZone));
  const [rangeEnd, setRangeEnd] = useState(() => toDateInputValue());
  const [copyTargetDay, setCopyTargetDay] = useState(() => toDateInputValue());
  const [manualMeal, setManualMeal] = useState(createManualMealState);
  const [areMealGroupsCollapsed, setAreMealGroupsCollapsed] = useState(false);

  const mealsQuery = trpc.nutrition.meals.list.useQuery();
  const favoriteMealsQuery = trpc.nutrition.meals.favorites.useQuery();
  const mealSchedulesQuery = trpc.nutrition.mealSchedules.list.useQuery();
  const waterLogsQuery = trpc.nutrition.water.list.useQuery();
  const exercisesQuery = trpc.nutrition.exercises.list.useQuery();
  const mealSchedules = mealSchedulesQuery.data as MealScheduleState[] | undefined;

  const activeRange = useMemo(() => {
    switch (periodScope) {
      case "day":
        return { start: selectedDay, end: selectedDay };
      case "week":
        return getWeekRange(selectedDay);
      case "month":
        return getMonthRange(selectedMonth);
      case "range":
        return normalizeDateRange(rangeStart, rangeEnd);
    }
  }, [periodScope, rangeEnd, rangeStart, selectedDay, selectedMonth]);

  const invalidateNutritionViews = async () => {
    await Promise.all([
      utils.nutrition.dashboard.overview.invalidate(),
      utils.nutrition.meals.list.invalidate(),
      utils.nutrition.meals.dayTotals.invalidate(),
      utils.nutrition.meals.favorites.invalidate(),
      utils.nutrition.reports.weekly.invalidate(),
      utils.nutrition.reports.bundle.invalidate(),
    ]);
  };

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
      toast.success("Refeição copiada para a data de destino.");
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

  const allMeals = (mealsQuery.data ?? []) as StoredMeal[];
  const allWaterLogs = (waterLogsQuery.data ?? []) as WaterLogRecord[];
  const allExercises = (exercisesQuery.data ?? []) as ExerciseRecord[];
  const filteredMeals = useMemo(
    () => filterMealsByDateRange(allMeals, { startDate: activeRange.start, endDate: activeRange.end, timeZone: userTimeZone }),
    [activeRange.end, activeRange.start, allMeals, userTimeZone],
  );
  const filteredWaterLogs = useMemo(
    () => allWaterLogs.filter(log => isDateKeyInRange(toDateKeyInTimeZone(log.occurredAt, userTimeZone), activeRange)),
    [activeRange, allWaterLogs, userTimeZone],
  );
  const filteredExercises = useMemo(
    () => allExercises.filter(exercise => isDateKeyInRange(toDateKeyInTimeZone(exercise.occurredAt, userTimeZone), activeRange)),
    [activeRange, allExercises, userTimeZone],
  );
  const periodTotals = useMemo(() => sumStoredMealTotals(filteredMeals), [filteredMeals]);
  const periodMealGroups = useMemo(() => buildRegisteredMealGroups(filteredMeals), [filteredMeals]);
  const periodDayGroups = useMemo(
    () => buildDateGroupedMealGroups(filteredMeals, { timeZone: userTimeZone, sortDirection: "desc" }),
    [filteredMeals, userTimeZone],
  );
  const suggestedManualMealLabel = useMemo(
    () => suggestMealLabelFromSchedules(manualMeal.occurredAt, mealSchedules),
    [manualMeal.occurredAt, mealSchedules],
  );
  const manualTotals = useMemo(() => sumItems(manualMeal.items), [manualMeal.items]);
  const pageHeading = buildRecordsHeading(periodScope);
  const activeRangeLabel = formatRangeLabel(activeRange);

  const handleReferenceDayChange = (value: string) => {
    setSelectedDay(value);
    setCopyTargetDay(value);
  };

  const loadMealForEditing = (meal: StoredMeal) => {
    setManualMeal({
      mealId: meal.id,
      mealLabel: normalizeMealType(meal.mealLabel),
      occurredAt: toDateTimeLocalValue(new Date(meal.occurredAt), userTimeZone),
      notes: meal.notes ?? "",
      items: meal.items.map(item => ({ ...item })),
    });
    toast.success("Formulário de edição aberto acima da lista.");
  };

  const updateManualItem = <K extends keyof MealItemState>(index: number, key: K, value: MealItemState[K]) => {
    setManualMeal(current => ({
      ...current,
      items: current.items.map((item, currentIndex) => (currentIndex === index ? { ...item, [key]: value } : item)),
    }));
  };

  const handleSubmitManualMeal = () => {
    if (!manualMeal.mealId) {
      toast.error("Selecione uma refeição para editar.");
      return;
    }

    const normalizedItems = manualMeal.items.map(item => ({
      ...item,
      foodName: item.foodName.trim(),
      canonicalName: item.canonicalName.trim() || item.foodName.trim(),
      portionText: item.portionText.trim() || "1 porção",
      confidence: Number(item.confidence || 1),
    }));

    if (!normalizedItems.length || normalizedItems.some(item => !item.foodName)) {
      toast.error("Preencha ao menos um alimento na refeição.");
      return;
    }

    updateMeal.mutate({
      mealId: manualMeal.mealId,
      mealLabel: manualMeal.mealLabel,
      occurredAt: zonedDateTimeLocalToIso(manualMeal.occurredAt, userTimeZone),
      notes: manualMeal.notes.trim() || undefined,
      items: normalizedItems,
    });
  };

  const editingBlock = manualMeal.mealId ? (
    <Card defaultOpen className="border-0 shadow-sm ring-1 ring-primary/20">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl">
          <PencilLine className="h-5 w-5 text-primary" />
          Editar refeição selecionada
        </CardTitle>
        <CardDescription>O editor abre acima da lista para manter o contexto e reduzir deslocamento visual.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <MealLabelInput
            value={manualMeal.mealLabel}
            onChange={mealLabel => setManualMeal(current => ({ ...current, mealLabel }))}
            suggestedLabel={suggestedManualMealLabel}
          />
          <div className="space-y-2">
            <Label htmlFor="registered-edit-occurred-at">Data e horário</Label>
            <Input id="registered-edit-occurred-at" type="datetime-local" value={manualMeal.occurredAt} onChange={event => setManualMeal(current => ({ ...current, occurredAt: event.target.value }))} />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="registered-edit-notes">Observações</Label>
          <Textarea id="registered-edit-notes" value={manualMeal.notes} onChange={event => setManualMeal(current => ({ ...current, notes: event.target.value }))} className="min-h-24 rounded-2xl" />
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium tracking-tight">Itens da refeição</p>
            <Button type="button" variant="outline" className="rounded-full" onClick={() => setManualMeal(current => ({ ...current, items: [...current.items, createEmptyItem()] }))}>
              <Plus className="mr-2 h-4 w-4" />
              Adicionar item
            </Button>
          </div>

          {manualMeal.items.map((item, index) => (
            <div key={`registered-edit-${index}`} className="space-y-3 rounded-2xl border bg-background p-4 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium">Item {index + 1}</p>
                {manualMeal.items.length > 1 ? (
                  <Button type="button" size="icon" variant="ghost" onClick={() => setManualMeal(current => ({ ...current, items: current.items.filter((_, currentIndex) => currentIndex !== index) }))}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                ) : null}
              </div>
              <MealItemEditor item={item} onChange={(key, value) => updateManualItem(index, key, value)} />
            </div>
          ))}
        </div>

        <div className="rounded-2xl border bg-muted/30 p-4">
          <p className="text-sm text-muted-foreground">Totais da refeição</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-4">
            <SummaryPill label="Calorias" value={formatCalories(manualTotals.calories)} />
            <SummaryPill label="Proteínas" value={formatGrams(manualTotals.protein)} />
            <SummaryPill label="Carboidratos" value={formatGrams(manualTotals.carbs)} />
            <SummaryPill label="Gorduras" value={formatGrams(manualTotals.fat)} />
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <Button className="rounded-full" onClick={handleSubmitManualMeal} disabled={updateMeal.isPending}>
            <Save className="mr-2 h-4 w-4" />
            {updateMeal.isPending ? "Atualizando..." : "Salvar alterações"}
          </Button>
          <Button type="button" variant="outline" className="rounded-full" onClick={() => setManualMeal(createManualMealState())}>
            Cancelar edição
          </Button>
        </div>
      </CardContent>
    </Card>
  ) : null;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <PageIntro
          eyebrow="Registros"
          title={pageHeading.title}
          description={`${pageHeading.description} Intervalo ativo: ${activeRangeLabel}.`}
          stats={
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
              <SummaryPill label="Calorias" value={formatCalories(periodTotals.calories)} />
              <SummaryPill label="Proteínas" value={formatGrams(periodTotals.protein)} />
              <SummaryPill label="Carboidratos" value={formatGrams(periodTotals.carbs)} />
              <SummaryPill label="Gorduras" value={formatGrams(periodTotals.fat)} />
              <SummaryPill label="Refeições" value={String(filteredMeals.length)} />
              <SummaryPill label="Dias com registros" value={String(periodDayGroups.length)} />
            </div>
          }
          actions={
            <PeriodScopeSelector
              scope={periodScope}
              onScopeChange={setPeriodScope}
              selectedDay={selectedDay}
              onSelectedDayChange={handleReferenceDayChange}
              selectedMonth={selectedMonth}
              onSelectedMonthChange={setSelectedMonth}
              rangeStart={rangeStart}
              onRangeStartChange={setRangeStart}
              rangeEnd={rangeEnd}
              onRangeEndChange={setRangeEnd}
            />
          }
        />

        {favoriteMealsQuery.data?.length ? (
          <Card defaultOpen className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl">
                <Star className="h-5 w-5 text-primary" />
                Refeições favoritas
              </CardTitle>
              <CardDescription>Reutilize uma favorita na data de destino, mesmo enquanto consulta semana, mês ou período.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-end gap-3 rounded-2xl border bg-muted/20 p-3">
                <div className="space-y-2">
                  <Label htmlFor="favorite-copy-target">Data de destino</Label>
                  <Input id="favorite-copy-target" type="date" value={copyTargetDay} onChange={event => setCopyTargetDay(event.target.value)} className="sm:w-44" />
                </div>
                <div className="rounded-2xl border bg-background px-4 py-3 text-sm text-muted-foreground">
                  Cópias e reutilização vão para <span className="font-semibold text-foreground">{formatDateLabel(copyTargetDay)}</span>.
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {favoriteMealsQuery.data.map(favorite => (
                  <Button
                    key={favorite.id}
                    type="button"
                    variant="outline"
                    className="rounded-full"
                    onClick={() => reuseFavoriteMeal.mutate({ favoriteMealId: favorite.id, occurredAt: zonedDateTimeLocalToIso(`${copyTargetDay}T12:00`, userTimeZone) })}
                    disabled={reuseFavoriteMeal.isPending}
                  >
                    <CalendarPlus className="mr-2 h-4 w-4" />
                    {favorite.name}
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>
        ) : null}

        {editingBlock}

        <Card collapsible={false} className="border-0 shadow-sm">
          <CardHeader>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle className="flex items-center gap-2 text-xl">
                <ListChecks className="h-5 w-5 text-primary" />
                {pageHeading.listTitle}
              </CardTitle>
              <Button
                type="button"
                variant="outline"
                className="w-fit rounded-full"
                onClick={() => setAreMealGroupsCollapsed(current => !current)}
                aria-expanded={!areMealGroupsCollapsed}
              >
                <ChevronDown className={`mr-2 h-4 w-4 transition-transform ${areMealGroupsCollapsed ? "-rotate-90" : "rotate-0"}`} />
                {areMealGroupsCollapsed ? "Expandir todas" : "Recolher todas"}
              </Button>
            </div>
            <CardDescription>{buildDateSectionDescription(periodScope)}</CardDescription>
          </CardHeader>
          <CardContent>
            {periodScope === "day" ? (
              <RegisteredMealGroups
                groups={periodMealGroups}
                userTimeZone={userTimeZone}
                selectedMealId={manualMeal.mealId}
                emptyMessage={mealsQuery.isLoading ? "Carregando refeições..." : "Nenhuma refeição foi registrada para esta data."}
                forceCollapsed={areMealGroupsCollapsed}
                isCopyPending={copyMeal.isPending}
                isFavoritePending={saveFavoriteMeal.isPending}
                isRemovePending={removeMeal.isPending}
                onEditMeal={loadMealForEditing}
                onCopyMeal={(meal, mealLabel) => copyMeal.mutate({ mealId: meal.id, occurredAt: zonedDateTimeLocalToIso(`${copyTargetDay}T12:00`, userTimeZone), mealLabel })}
                onFavoriteMeal={meal => saveFavoriteMeal.mutate({ mealId: meal.id, name: meal.mealLabel })}
                onRemoveMeal={meal => removeMeal.mutate({ mealId: meal.id })}
              />
            ) : (
              <DateGroupedMealsSections
                groups={periodDayGroups}
                scope={periodScope}
                userTimeZone={userTimeZone}
                selectedMealId={manualMeal.mealId}
                emptyMessage={mealsQuery.isLoading ? "Carregando refeições..." : `Nenhum registro encontrado para ${activeRangeLabel.toLowerCase()}.`}
                forceMealGroupsCollapsed={areMealGroupsCollapsed}
                isCopyPending={copyMeal.isPending}
                isFavoritePending={saveFavoriteMeal.isPending}
                isRemovePending={removeMeal.isPending}
                onEditMeal={loadMealForEditing}
                onCopyMeal={(meal, mealLabel) => copyMeal.mutate({ mealId: meal.id, occurredAt: zonedDateTimeLocalToIso(`${copyTargetDay}T12:00`, userTimeZone), mealLabel })}
                onFavoriteMeal={meal => saveFavoriteMeal.mutate({ mealId: meal.id, name: meal.mealLabel })}
                onRemoveMeal={meal => removeMeal.mutate({ mealId: meal.id })}
              />
            )}
          </CardContent>
        </Card>

        <HabitRecordsSection
          waterLogs={filteredWaterLogs}
          exerciseLogs={filteredExercises}
          userTimeZone={userTimeZone}
          isLoading={waterLogsQuery.isLoading || exercisesQuery.isLoading}
        />
      </div>
    </DashboardLayout>
  );
}

function OperationalRecord({ label }: { label: string }) {
  return (
    <div className="rounded-2xl border bg-background p-3 text-sm font-medium tracking-tight text-foreground">
      {label}
    </div>
  );
}

function EmptyOperationalRecord({ text }: { text: string }) {
  return <div className="rounded-2xl border border-dashed bg-background/70 p-4 text-sm text-muted-foreground">{text}</div>;
}
