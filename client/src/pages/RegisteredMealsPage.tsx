import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDateTimeInTimeZone, getBrowserTimeZone, toDateInputValue, zonedDateTimeLocalToIso } from "@/lib/dateTime";
import { formatCalories, formatCountPtBr, formatGrams } from "@/lib/numberFormat";
import { trpc } from "@/lib/trpc";
import { calculateDayTotals, calculateMealTotals } from "../../../shared/mealTotals";
import { CalendarDays, CalendarPlus, ChevronLeft, ChevronRight, Copy, ImageIcon, Star, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

type MealItemState = {
  foodName: string;
  canonicalName?: string;
  portionText: string;
  servings?: number;
  estimatedGrams: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  confidence?: number;
  source?: "catalog" | "hybrid" | "heuristic";
  imageUrl?: string;
  photoUrl?: string;
  supportingImageUrl?: string;
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
  imageUrl?: string;
  photoUrl?: string;
  supportingImageUrl?: string;
};

const MEAL_ORDER = ["café da manhã", "almoço", "jantar", "lanche", "outro"];

function addDays(dateValue: string, days: number) {
  const [year, month, day] = dateValue.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  return toDateInputValue(date);
}

function getMealImageUrl(meal: StoredMeal, item: MealItemState) {
  return item.imageUrl || item.photoUrl || item.supportingImageUrl || meal.imageUrl || meal.photoUrl || meal.supportingImageUrl;
}

function groupMealsByLabel(meals: StoredMeal[]) {
  const grouped = new Map<string, StoredMeal[]>();

  meals.forEach(meal => {
    const label = meal.mealLabel || "outro";
    const current = grouped.get(label) ?? [];
    current.push(meal);
    grouped.set(label, current);
  });

  return Array.from(grouped.entries()).sort(([labelA], [labelB]) => {
    const indexA = MEAL_ORDER.indexOf(labelA);
    const indexB = MEAL_ORDER.indexOf(labelB);
    return (indexA === -1 ? Number.MAX_SAFE_INTEGER : indexA) - (indexB === -1 ? Number.MAX_SAFE_INTEGER : indexB);
  });
}

export default function RegisteredMealsPage() {
  const utils = trpc.useUtils();
  const userTimeZone = useMemo(() => getBrowserTimeZone(), []);
  const [selectedDay, setSelectedDay] = useState(() => toDateInputValue());

  const mealsQuery = trpc.nutrition.meals.list.useQuery();
  const favoriteMealsQuery = trpc.nutrition.meals.favorites.useQuery();
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

  const copyMeal = trpc.nutrition.meals.copy.useMutation({
    onSuccess: async () => {
      await invalidateNutritionViews();
      toast.success("Refeição copiada para a data selecionada.");
    },
    onError: error => toast.error(error.message || "Não foi possível copiar a refeição."),
  });

  const removeMeal = trpc.nutrition.meals.remove.useMutation({
    onSuccess: async () => {
      await invalidateNutritionViews();
      toast.success("Refeição removida com sucesso.");
    },
    onError: error => toast.error(error.message || "Não foi possível remover a refeição."),
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

  const filteredMeals = useMemo(() => {
    return ((mealsQuery.data ?? []) as StoredMeal[]).filter(meal => toDateInputValue(new Date(meal.occurredAt), userTimeZone) === selectedDay);
  }, [mealsQuery.data, selectedDay, userTimeZone]);

  const groupedMeals = useMemo(() => groupMealsByLabel(filteredMeals), [filteredMeals]);
  const localDayTotals = useMemo(() => calculateDayTotals(filteredMeals), [filteredMeals]);
  const totals = dayTotalsQuery.data?.totals ?? localDayTotals;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <CalendarDays className="h-5 w-5 text-primary" />
              Refeições registradas
            </CardTitle>
            <CardDescription>
              Navegue por data e visualize os alimentos agrupados por refeição, com horário e informações nutricionais por item.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr),auto] lg:items-end">
              <div className="space-y-2">
                <Label htmlFor="registered-meals-day">Data do registro</Label>
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" variant="outline" size="icon" className="rounded-full" aria-label="Dia anterior" onClick={() => setSelectedDay(current => addDays(current, -1))}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Input id="registered-meals-day" type="date" value={selectedDay} onChange={event => setSelectedDay(event.target.value)} className="max-w-xs" />
                  <Button type="button" variant="outline" size="icon" className="rounded-full" aria-label="Próximo dia" onClick={() => setSelectedDay(current => addDays(current, 1))}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <Badge variant="secondary" className="w-fit rounded-full px-4 py-2">
                {formatCountPtBr(filteredMeals.length, " refeições")}
              </Badge>
            </div>

            <div className="grid gap-3 sm:grid-cols-4">
              <SummaryPill label="Calorias" value={formatCalories(totals.calories)} />
              <SummaryPill label="Proteínas" value={formatGrams(totals.protein)} />
              <SummaryPill label="Carboidratos" value={formatGrams(totals.carbs)} />
              <SummaryPill label="Gorduras" value={formatGrams(totals.fat)} />
            </div>
          </CardContent>
        </Card>

        {favoriteMealsQuery.data?.length ? (
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg">Refeições favoritas</CardTitle>
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

        {groupedMeals.length ? (
          groupedMeals.map(([mealLabel, meals]) => {
            const groupTotals = calculateDayTotals(meals);

            return (
              <Card key={mealLabel} className="border-0 shadow-sm">
                <CardHeader>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <CardTitle className="capitalize">{mealLabel}</CardTitle>
                      <CardDescription>{formatCountPtBr(meals.length, " registros nesta refeição")}</CardDescription>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-right text-xs text-muted-foreground sm:grid-cols-4">
                      <MacroValue label="Cal" value={formatCalories(groupTotals.calories)} />
                      <MacroValue label="Prot" value={formatGrams(groupTotals.protein)} />
                      <MacroValue label="Carb" value={formatGrams(groupTotals.carbs)} />
                      <MacroValue label="Gord" value={formatGrams(groupTotals.fat)} />
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {meals.map(meal => {
                    const mealTotals = calculateMealTotals(meal.items);

                    return (
                      <div key={meal.id} className="rounded-2xl border bg-background p-4 shadow-sm">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant="secondary">{meal.source === "web" ? "Web" : "WhatsApp"}</Badge>
                              <span className="text-sm font-medium text-muted-foreground">{formatDateTimeInTimeZone(meal.occurredAt, userTimeZone)}</span>
                            </div>
                            {meal.notes ? <p className="mt-2 text-sm text-muted-foreground">{meal.notes}</p> : null}
                          </div>
                          <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">{formatCalories(mealTotals.calories)}</Badge>
                        </div>

                        <div className="mt-4 space-y-3">
                          {meal.items.map((item, index) => {
                            const imageUrl = getMealImageUrl(meal, item);

                            return (
                              <div key={`${meal.id}-${item.foodName}-${index}`} className="grid gap-3 rounded-2xl border bg-muted/20 p-3 md:grid-cols-[auto,minmax(0,1fr)]">
                                {imageUrl ? (
                                  <img src={imageUrl} alt={`Foto de ${item.foodName}`} className="h-24 w-24 rounded-2xl object-cover" loading="lazy" />
                                ) : (
                                  <div className="flex h-24 w-24 items-center justify-center rounded-2xl border border-dashed bg-background text-muted-foreground">
                                    <ImageIcon className="h-5 w-5" />
                                  </div>
                                )}
                                <div className="space-y-3">
                                  <div className="flex flex-wrap items-start justify-between gap-2">
                                    <div>
                                      <p className="font-medium tracking-tight">{item.foodName}</p>
                                      <p className="text-sm text-muted-foreground">{item.portionText} · {formatGrams(item.estimatedGrams)} · registrado às {formatDateTimeInTimeZone(meal.occurredAt, userTimeZone)}</p>
                                    </div>
                                    {imageUrl ? <Badge variant="outline">criado por foto</Badge> : null}
                                  </div>
                                  <div className="grid gap-2 sm:grid-cols-4">
                                    <NutrientPill label="Calorias" value={formatCalories(item.calories)} />
                                    <NutrientPill label="Proteínas" value={formatGrams(item.protein)} />
                                    <NutrientPill label="Carboidratos" value={formatGrams(item.carbs)} />
                                    <NutrientPill label="Gorduras" value={formatGrams(item.fat)} />
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        <div className="mt-4 flex flex-wrap gap-3">
                          <Button type="button" variant="outline" className="rounded-full" onClick={() => copyMeal.mutate({ mealId: meal.id, occurredAt: zonedDateTimeLocalToIso(`${selectedDay}T12:00`, userTimeZone), mealLabel: MEAL_ORDER.includes(meal.mealLabel) ? meal.mealLabel as never : "outro" as never })} disabled={copyMeal.isPending}>
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
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            );
          })
        ) : (
          <Card className="border-0 shadow-sm">
            <CardContent className="p-6">
              <div className="rounded-2xl border border-dashed bg-muted/20 p-6 text-sm leading-6 text-muted-foreground">
                Nenhuma refeição foi registrada para a data selecionada. Use as setas para navegar por outros dias ou escolha uma data no calendário.
              </div>
            </CardContent>
          </Card>
        )}
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

function MacroValue({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-semibold text-foreground">{value}</p>
      <p>{label}</p>
    </div>
  );
}

function NutrientPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-background p-3 text-sm shadow-sm">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-semibold tracking-tight">{value}</p>
    </div>
  );
}
