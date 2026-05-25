import DashboardLayout from "@/components/DashboardLayout";
import PageIntro from "@/components/PageIntro";
import { PeriodScopeSelector } from "@/components/PeriodScopeSelector";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import { formatCalories, formatGrams } from "@/lib/numberFormat";
import { trpc } from "@/lib/trpc";
import { CalendarPlus, ListChecks, PencilLine, Plus, Save, Star, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { MealItemEditor, RegisteredMealGroups, SummaryPill } from "./components";
import { createEmptyItem, createManualMealState, sumItems } from "./mealFormState";
import {
  type DateGroupedRegisteredMealsViewModel,
  buildDateGroupedMealGroups,
  buildRegisteredMealGroups,
  filterMealsByDateRange,
  normalizeMealType,
  sumStoredMealTotals,
} from "./mealViewModels";
import { MEAL_TYPES } from "./types";
import type { MealItemState, MealType, StoredMeal } from "./types";

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
        description: "A semana mostra as refeições agrupadas por dia para facilitar revisão rápida e manutenção do que foi lançado.",
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

function DateGroupedMealsSections({
  groups,
  scope,
  userTimeZone,
  selectedMealId,
  emptyMessage,
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
            </div>
          </summary>
          <div className="pt-4">
            <RegisteredMealGroups
              groups={group.groups}
              userTimeZone={userTimeZone}
              selectedMealId={selectedMealId}
              emptyMessage="Nenhuma refeição encontrada para este dia."
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

  const mealsQuery = trpc.nutrition.meals.list.useQuery();
  const favoriteMealsQuery = trpc.nutrition.meals.favorites.useQuery();

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
  const filteredMeals = useMemo(
    () => filterMealsByDateRange(allMeals, { startDate: activeRange.start, endDate: activeRange.end, timeZone: userTimeZone }),
    [activeRange.end, activeRange.start, allMeals, userTimeZone],
  );
  const periodTotals = useMemo(() => sumStoredMealTotals(filteredMeals), [filteredMeals]);
  const periodMealGroups = useMemo(() => buildRegisteredMealGroups(filteredMeals), [filteredMeals]);
  const periodDayGroups = useMemo(
    () => buildDateGroupedMealGroups(filteredMeals, { timeZone: userTimeZone, sortDirection: "desc" }),
    [filteredMeals, userTimeZone],
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
          <div className="space-y-2">
            <Label htmlFor="registered-edit-meal-label">Nome da refeição</Label>
            <Select value={manualMeal.mealLabel} onValueChange={(mealLabel: MealType) => setManualMeal(current => ({ ...current, mealLabel }))}>
              <SelectTrigger id="registered-edit-meal-label"><SelectValue /></SelectTrigger>
              <SelectContent>
                {MEAL_TYPES.map(type => <SelectItem key={type} value={type}>{type}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
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
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <SummaryPill label="Calorias" value={formatCalories(periodTotals.calories)} />
              <SummaryPill label="Proteínas" value={formatGrams(periodTotals.protein)} />
              <SummaryPill label="Carboidratos" value={formatGrams(periodTotals.carbs)} />
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
            <CardTitle className="flex items-center gap-2 text-xl">
              <ListChecks className="h-5 w-5 text-primary" />
              {pageHeading.listTitle}
            </CardTitle>
            <CardDescription>{buildDateSectionDescription(periodScope)}</CardDescription>
          </CardHeader>
          <CardContent>
            {periodScope === "day" ? (
              <RegisteredMealGroups
                groups={periodMealGroups}
                userTimeZone={userTimeZone}
                selectedMealId={manualMeal.mealId}
                emptyMessage={mealsQuery.isLoading ? "Carregando refeições..." : "Nenhuma refeição foi registrada para esta data."}
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
      </div>
    </DashboardLayout>
  );
}
