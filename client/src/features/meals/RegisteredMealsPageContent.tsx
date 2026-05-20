import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { getBrowserTimeZone, toDateInputValue, toDateTimeLocalValue, zonedDateTimeLocalToIso } from "@/lib/dateTime";
import { formatCalories, formatGrams } from "@/lib/numberFormat";
import { trpc } from "@/lib/trpc";
import { CalendarPlus, PencilLine, Plus, Save, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { DayNavigator, MealItemEditor, RegisteredMealGroups, SummaryPill } from "./components";
import { createEmptyItem, createManualMealState, sumItems } from "./mealFormState";
import { buildRegisteredMealGroups, normalizeMealType } from "./mealViewModels";
import { MEAL_TYPES } from "./types";
import type { MealItemState, MealType, StoredMeal } from "./types";

export function RegisteredMealsPage() {
  const utils = trpc.useUtils();
  const userTimeZone = useMemo(() => getBrowserTimeZone(), []);
  const [selectedDay, setSelectedDay] = useState(() => toDateInputValue());
  const [manualMeal, setManualMeal] = useState(createManualMealState);

  const mealsQuery = trpc.nutrition.meals.list.useQuery();
  const favoriteMealsQuery = trpc.nutrition.meals.favorites.useQuery();

  const invalidateNutritionViews = async () => {
    await Promise.all([
      utils.nutrition.dashboard.overview.invalidate(),
      utils.nutrition.meals.list.invalidate(),
      utils.nutrition.meals.dayTotals.invalidate(),
      utils.nutrition.meals.favorites.invalidate(),
      utils.nutrition.reports.weekly.invalidate(),
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

  const registeredMealGroups = useMemo(
    () => buildRegisteredMealGroups((mealsQuery.data ?? []) as StoredMeal[], { selectedDay, timeZone: userTimeZone }),
    [mealsQuery.data, selectedDay, userTimeZone],
  );

  const dayTotals = useMemo(
    () => registeredMealGroups.reduce(
      (totals, group) => ({
        calories: totals.calories + group.totals.calories,
        protein: totals.protein + group.totals.protein,
        carbs: totals.carbs + group.totals.carbs,
        fat: totals.fat + group.totals.fat,
      }),
      { calories: 0, protein: 0, carbs: 0, fat: 0 },
    ),
    [registeredMealGroups],
  );

  const manualTotals = useMemo(() => sumItems(manualMeal.items), [manualMeal.items]);

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
    <Card className="border-0 shadow-sm ring-1 ring-primary/20">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl">
          <PencilLine className="h-5 w-5 text-primary" />
          Editar refeição selecionada
        </CardTitle>
        <CardDescription>Altere os dados abaixo e salve para atualizar esta refeição.</CardDescription>
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
        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle>Refeições registradas</CardTitle>
            <CardDescription>
              Acompanhe os alimentos por refeição, filtre por data e ajuste registros quando necessário.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <DayNavigator selectedDay={selectedDay} onSelectedDayChange={setSelectedDay} />
            <div className="grid gap-3 sm:grid-cols-4">
              <SummaryPill label="Calorias" value={formatCalories(dayTotals.calories)} />
              <SummaryPill label="Proteínas" value={formatGrams(dayTotals.protein)} />
              <SummaryPill label="Carboidratos" value={formatGrams(dayTotals.carbs)} />
              <SummaryPill label="Gorduras" value={formatGrams(dayTotals.fat)} />
            </div>
          </CardContent>
        </Card>

        {favoriteMealsQuery.data?.length ? (
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle>Refeições favoritas</CardTitle>
              <CardDescription>Reutilize uma favorita no dia selecionado.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
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
            </CardContent>
          </Card>
        ) : null}

        {editingBlock}

        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle>Alimentos do dia</CardTitle>
            <CardDescription>
              Os alimentos são agrupados por refeição e exibidos em lista vertical com horário e informações nutricionais.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RegisteredMealGroups
              groups={registeredMealGroups}
              userTimeZone={userTimeZone}
              selectedMealId={manualMeal.mealId}
              emptyMessage={mealsQuery.isLoading ? "Carregando refeições..." : "Nenhuma refeição foi registrada para esta data."}
              isCopyPending={copyMeal.isPending}
              isFavoritePending={saveFavoriteMeal.isPending}
              isRemovePending={removeMeal.isPending}
              onEditMeal={loadMealForEditing}
              onCopyMeal={(meal, mealLabel) => copyMeal.mutate({ mealId: meal.id, occurredAt: zonedDateTimeLocalToIso(`${selectedDay}T12:00`, userTimeZone), mealLabel })}
              onFavoriteMeal={meal => saveFavoriteMeal.mutate({ mealId: meal.id, name: meal.mealLabel })}
              onRemoveMeal={meal => removeMeal.mutate({ mealId: meal.id })}
            />
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
