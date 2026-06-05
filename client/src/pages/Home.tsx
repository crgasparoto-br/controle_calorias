import React from "react";
import DashboardLayout from "@/components/DashboardLayout";
import PageIntro from "@/components/PageIntro";
import UXState from "@/components/UXState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { toDateInputValue, zonedDateTimeLocalToIso } from "@/lib/dateTime";
import { formatCalories, formatCountPtBr, formatGrams, formatPercentPtBr } from "@/lib/numberFormat";
import { trpc } from "@/lib/trpc";
import { SAFE_NUTRITION_MESSAGES } from "@shared/safeMessages";
import { ArrowRight, BrainCircuit, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { Link } from "wouter";

type AssistantSuggestion = {
  text: string;
  suggestedFoods: Array<{
    foodName: string;
    portionText: string;
    estimatedGrams: number;
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
  }>;
  estimatedCalories: number;
  estimatedMacros: {
    protein: number;
    carbs: number;
    fat: number;
  };
  alert?: string;
  educationalNotice: string;
};

type MealTotals = {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
};

type GroupedMealSummary = {
  id: string;
  mealLabel: string;
  totals: MealTotals;
  count: number;
};

type MacroSummary = {
  label: string;
  consumed: number;
  goal: number;
};

function macroProgress(consumed: number, goal: number) {
  if (!goal) return 0;
  return Math.min((consumed / goal) * 100, 100);
}

function uncappedGoalProgress(consumed: number, goal: number) {
  if (!goal) return 0;
  return (consumed / goal) * 100;
}

function formatGoalProgressText(consumed: number, goal: number) {
  if (!goal) return "Meta não definida.";
  return `${formatPercentPtBr(uncappedGoalProgress(consumed, goal))}% da meta do dia.`;
}

function formatGoalComparison(consumed: number, goal: number, formatter: (value: number) => string) {
  const goalLabel = `Meta ${formatter(goal)}`;
  const excess = consumed - goal;

  if (goal > 0 && excess > 0) {
    return `${goalLabel} · ${formatter(excess)} acima`;
  }

  return goalLabel;
}

function dayShare(value: number, total: number) {
  if (!total || value <= 0) return 0;
  return (value / total) * 100;
}

function formatDayShare(value: number, total: number) {
  return `${formatPercentPtBr(dayShare(value, total))}% do total do dia`;
}

function macroGramTotal(protein: number, carbs: number, fat: number) {
  return protein + carbs + fat;
}

function formatMacroGramShare(grams: number, totalGrams: number, label: string) {
  return `${label}: ${formatPercentPtBr(dayShare(grams, totalGrams))}% do total em gramas`;
}

function positiveRemaining(value: number) {
  return Math.max(value, 0);
}

function toUtcNoonDate(dateKey: string) {
  return new Date(`${dateKey}T12:00:00Z`);
}

function addDaysToDateKey(dateKey: string, days: number) {
  const date = toUtcNoonDate(dateKey);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatSelectedDateLabel(dateKey: string, todayKey: string) {
  if (dateKey === todayKey) return "Hoje";
  if (dateKey === addDaysToDateKey(todayKey, -1)) return "Ontem";
  if (dateKey === addDaysToDateKey(todayKey, 1)) return "Amanhã";

  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "UTC",
    weekday: "long",
  }).format(toUtcNoonDate(dateKey));
}

function formatSelectedDateSubtitle(dateKey: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "UTC",
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(toUtcNoonDate(dateKey));
}

function recordsHref(dateKey: string) {
  return `/meals?date=${encodeURIComponent(dateKey)}`;
}

export default function Home() {
  const utils = trpc.useUtils();
  const todayKey = toDateInputValue();
  const [selectedDate, setSelectedDate] = React.useState(todayKey);
  const isViewingToday = selectedDate === todayKey;
  const overview = trpc.nutrition.dashboard.today.useQuery({ date: selectedDate });
  const [assistantMessage, setAssistantMessage] = React.useState("");
  const [assistantSuggestion, setAssistantSuggestion] = React.useState<AssistantSuggestion | null>(null);

  const assistantSuggest = trpc.nutrition.assistant.suggest.useMutation({
    onSuccess: result => {
      setAssistantSuggestion(result as AssistantSuggestion);
    },
    onError: error => toast.error(error.message || "Não foi possível gerar uma sugestão agora."),
  });

  const saveAssistantMeal = trpc.nutrition.meals.createManual.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.nutrition.dashboard.overview.invalidate(),
        utils.nutrition.dashboard.today.invalidate(),
        utils.nutrition.meals.list.invalidate(),
        utils.nutrition.meals.dayTotals.invalidate(),
        utils.nutrition.reports.weekly.invalidate(),
      ]);
      toast.success("Sugestão salva como refeição.");
    },
    onError: error => toast.error(error.message || "Não foi possível salvar a sugestão."),
  });

  const handleAssistantSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!assistantMessage.trim()) return;
    assistantSuggest.mutate({ message: assistantMessage });
  };

  const handleAssistantShortcut = (message: string) => {
    setAssistantMessage(message);
    assistantSuggest.mutate({ message });
  };

  const handleSaveSuggestionAsMeal = () => {
    if (!assistantSuggestion?.suggestedFoods.length) {
      toast.error("A sugestão não tem alimentos suficientes para salvar.");
      return;
    }

    saveAssistantMeal.mutate({
      mealLabel: "jantar",
      occurredAt: zonedDateTimeLocalToIso(`${selectedDate}T12:00`),
      notes: "Sugestão educativa do assistente alimentar.",
      items: assistantSuggestion.suggestedFoods.map(food => ({
        foodName: food.foodName,
        canonicalName: food.foodName,
        portionText: food.portionText,
        servings: 1,
        estimatedGrams: food.estimatedGrams,
        calories: food.calories,
        protein: food.protein,
        carbs: food.carbs,
        fat: food.fat,
        confidence: 0.7,
        source: "heuristic" as const,
      })),
    });
  };

  const selectedDayMeals = overview.data?.meals ?? [];
  const consumedCalories = overview.data?.today.consumed.calories ?? 0;
  const consumedProtein = overview.data?.today.consumed.protein ?? 0;
  const consumedCarbs = overview.data?.today.consumed.carbs ?? 0;
  const consumedFat = overview.data?.today.consumed.fat ?? 0;
  const calorieGoal = overview.data?.today.goal.calories ?? 0;
  const proteinGoal = overview.data?.today.goal.protein ?? 0;
  const carbsGoal = overview.data?.today.goal.carbs ?? 0;
  const fatGoal = overview.data?.today.goal.fat ?? 0;
  const consumedMacroTotal = macroGramTotal(consumedProtein, consumedCarbs, consumedFat);
  const goalMacroTotal = macroGramTotal(proteinGoal, carbsGoal, fatGoal);
  const remainingCalories = overview.data?.today.remaining.calories ?? 0;
  const exerciseCalories = overview.data?.today.burned.calories ?? 0;
  const netCalories = overview.data?.today.net.calories ?? 0;
  const waterConsumedMl = overview.data?.today.water.consumedMl ?? 0;
  const waterGoalMl = overview.data?.today.water.goalMl ?? 0;
  const macroSummaries: MacroSummary[] = [
    { label: "Proteína", consumed: consumedProtein, goal: proteinGoal },
    { label: "Carboidratos", consumed: consumedCarbs, goal: carbsGoal },
    { label: "Gorduras", consumed: consumedFat, goal: fatGoal },
  ];
  const groupedSelectedDayMeals = React.useMemo<GroupedMealSummary[]>(() => {
    const mealsByLabel = new Map<string, GroupedMealSummary>();

    selectedDayMeals.forEach(meal => {
      const mealLabel = meal.mealLabel.trim() || "Refeição";
      const key = mealLabel.toLocaleLowerCase("pt-BR");
      const existing = mealsByLabel.get(key);

      if (existing) {
        existing.count += 1;
        existing.totals.calories += meal.totals.calories ?? 0;
        existing.totals.protein += meal.totals.protein ?? 0;
        existing.totals.carbs += meal.totals.carbs ?? 0;
        existing.totals.fat += meal.totals.fat ?? 0;
        return;
      }

      mealsByLabel.set(key, {
        id: String(meal.id),
        mealLabel,
        totals: {
          calories: meal.totals.calories ?? 0,
          protein: meal.totals.protein ?? 0,
          carbs: meal.totals.carbs ?? 0,
          fat: meal.totals.fat ?? 0,
        },
        count: 1,
      });
    });

    return Array.from(mealsByLabel.values());
  }, [selectedDayMeals]);

  if (overview.isLoading) {
    return (
      <DashboardLayout>
        <div className="mx-auto flex max-w-7xl flex-col gap-6">
          <Skeleton className="h-20 rounded-2xl" />
          <div className="grid gap-4 xl:grid-cols-[1.05fr,0.95fr]">
            <Skeleton className="h-96 rounded-2xl" />
            <Skeleton className="h-96 rounded-2xl" />
          </div>
        </div>
      </DashboardLayout>
    );
  }

  if (overview.isError) {
    return (
      <DashboardLayout>
        <div className="mx-auto max-w-7xl">
          <UXState
            variant="error"
            title="Não foi possível carregar o Hoje agora"
            description="Tente atualizar a página em instantes. Seus registros seguem sendo a base para acompanhar próximos passos com calma."
          />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <DateNavigator
          selectedDate={selectedDate}
          todayKey={todayKey}
          isViewingToday={isViewingToday}
          onPreviousDay={() => setSelectedDate(current => addDaysToDateKey(current, -1))}
          onNextDay={() => setSelectedDate(current => addDaysToDateKey(current, 1))}
          onToday={() => setSelectedDate(todayKey)}
        />

        <PageIntro
          eyebrow="Hoje"
          title="Como está o seu dia agora?"
          description="Acompanhe consumo, metas e registros do dia selecionado em uma leitura rápida."
          actions={
            <>
              <Link href="/registrar">
                <Button className="rounded-full">
                  Registrar refeição
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
              <Link href={recordsHref(selectedDate)}>
                <Button variant="outline" className="rounded-full">
                  Ver registros do dia
                </Button>
              </Link>
              <Link href="/reports">
                <Button variant="outline" className="rounded-full">
                  Ver relatório da semana
                </Button>
              </Link>
            </>
          }
        />

        <section className="space-y-4">
          <SectionHeading title="Foco do dia" />
          <div className="grid gap-4 xl:grid-cols-[1.05fr,0.95fr]">
            <div className="space-y-4">
              <TodayStatusCard
                consumedCalories={consumedCalories}
                calorieGoal={calorieGoal}
                remainingCalories={remainingCalories}
                netCalories={netCalories}
                exerciseCalories={exerciseCalories}
                waterConsumedMl={waterConsumedMl}
                waterGoalMl={waterGoalMl}
                groupedMealsCount={groupedSelectedDayMeals.length}
                macroSummaries={macroSummaries}
                consumedMacroTotal={consumedMacroTotal}
                goalMacroTotal={goalMacroTotal}
              />

              <MealsOfDayCard
                groupedMeals={groupedSelectedDayMeals}
                recordsUrl={recordsHref(selectedDate)}
                consumedCalories={consumedCalories}
                consumedProtein={consumedProtein}
                consumedCarbs={consumedCarbs}
                consumedFat={consumedFat}
              />
            </div>

            <FoodAssistantCard
              message={assistantMessage}
              suggestion={assistantSuggestion}
              isGenerating={assistantSuggest.isPending}
              isSaving={saveAssistantMeal.isPending}
              onMessageChange={setAssistantMessage}
              onSubmit={handleAssistantSubmit}
              onShortcut={handleAssistantShortcut}
              onSaveSuggestion={handleSaveSuggestionAsMeal}
            />
          </div>
        </section>
      </div>
    </DashboardLayout>
  );
}

function DateNavigator({
  selectedDate,
  todayKey,
  isViewingToday,
  onPreviousDay,
  onNextDay,
  onToday,
}: {
  selectedDate: string;
  todayKey: string;
  isViewingToday: boolean;
  onPreviousDay: () => void;
  onNextDay: () => void;
  onToday: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 text-center sm:flex-row sm:justify-between sm:text-left">
      <div>
        <p className="text-sm font-medium text-muted-foreground">Dia selecionado</p>
        <h1 className="text-2xl font-semibold tracking-tight capitalize">{formatSelectedDateLabel(selectedDate, todayKey)}</h1>
        <p className="text-sm text-muted-foreground">{formatSelectedDateSubtitle(selectedDate)}</p>
      </div>
      <div className="flex items-center gap-2 rounded-full border bg-background p-1 shadow-sm">
        <Button type="button" variant="ghost" className="h-10 w-10 rounded-full p-0" onClick={onPreviousDay} aria-label="Dia anterior">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button type="button" variant={isViewingToday ? "secondary" : "ghost"} className="rounded-full px-4" onClick={onToday} disabled={isViewingToday}>
          Hoje
        </Button>
        <Button type="button" variant="ghost" className="h-10 w-10 rounded-full p-0" onClick={onNextDay} aria-label="Próximo dia">
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function SectionHeading({ title, description }: { title: string; description?: string }) {
  return (
    <div className="space-y-1">
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      {description ? <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{description}</p> : null}
    </div>
  );
}

function TodayStatusCard({
  consumedCalories,
  calorieGoal,
  remainingCalories,
  netCalories,
  exerciseCalories,
  waterConsumedMl,
  waterGoalMl,
  groupedMealsCount,
  macroSummaries,
  consumedMacroTotal,
  goalMacroTotal,
}: {
  consumedCalories: number;
  calorieGoal: number;
  remainingCalories: number;
  netCalories: number;
  exerciseCalories: number;
  waterConsumedMl: number;
  waterGoalMl: number;
  groupedMealsCount: number;
  macroSummaries: MacroSummary[];
  consumedMacroTotal: number;
  goalMacroTotal: number;
}) {
  return (
    <Card className="border-0 shadow-sm">
      <CardHeader>
        <CardTitle>Status do dia</CardTitle>
        <CardDescription>Leitura rápida do momento atual e da meta planejada.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatBlock label="Calorias consumidas" value={formatCalories(consumedCalories)} sublabel={formatGoalComparison(consumedCalories, calorieGoal, formatCalories)} />
          <StatBlock
            label="Calorias restantes"
            value={formatCalories(positiveRemaining(remainingCalories))}
            sublabel={remainingCalories < 0 ? "Acima da meta planejada para o dia" : "Disponíveis para os próximos registros"}
          />
          <StatBlock label="Saldo líquido" value={formatCalories(netCalories)} sublabel="Consumo menos exercícios registrados" />
          <StatBlock label="Refeições" value={formatCountPtBr(groupedMealsCount)} sublabel="Agrupadas por nome" />
        </div>

        <div className="grid gap-3 lg:grid-cols-3">
          {macroSummaries.map(macro => (
            <StatBlock
              key={macro.label}
              label={macro.label}
              value={formatGrams(macro.consumed)}
              sublabel={formatGoalComparison(macro.consumed, macro.goal, formatGrams)}
              details={[
                formatMacroGramShare(macro.consumed, consumedMacroTotal, "Consumido"),
                formatMacroGramShare(macro.goal, goalMacroTotal, "Meta"),
              ]}
            />
          ))}
        </div>

        <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
          <CalorieBar consumed={consumedCalories} goal={calorieGoal} />
          {macroSummaries.map(macro => (
            <MacroBar key={macro.label} label={macro.label} consumed={macro.consumed} goal={macro.goal} />
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <SupportMetric label="Exercícios" value={formatCalories(exerciseCalories)} helper="Queimadas no dia" />
          <SupportMetric label="Água do dia" value={formatCountPtBr(waterConsumedMl, " ml")} helper={`Meta ${formatCountPtBr(waterGoalMl, " ml")}`} />
        </div>
      </CardContent>
    </Card>
  );
}

function MealsOfDayCard({
  groupedMeals,
  recordsUrl,
  consumedCalories,
  consumedProtein,
  consumedCarbs,
  consumedFat,
}: {
  groupedMeals: GroupedMealSummary[];
  recordsUrl: string;
  consumedCalories: number;
  consumedProtein: number;
  consumedCarbs: number;
  consumedFat: number;
}) {
  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle>Refeições do dia</CardTitle>
          <CardDescription>Registros confirmados no dia selecionado, somados por refeição.</CardDescription>
        </div>
        <Link href={recordsUrl}>
          <Button variant="ghost" className="gap-2 px-0 sm:px-3">
            Ver lista completa
            <ArrowRight className="h-4 w-4" />
          </Button>
        </Link>
      </CardHeader>
      <CardContent className="space-y-3">
        {groupedMeals.length ? (
          groupedMeals.map(meal => (
            <div key={meal.id} className="rounded-2xl border bg-background p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-medium tracking-tight">{meal.mealLabel}</p>
                  {meal.count > 1 ? <p className="mt-1 text-xs text-muted-foreground">{formatCountPtBr(meal.count)} registros somados</p> : null}
                </div>
              </div>
              <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                <MealNutritionMetric label="Calorias" value={formatCalories(meal.totals.calories)} percentage={formatDayShare(meal.totals.calories, consumedCalories)} />
                <MealNutritionMetric label="Proteínas" value={formatGrams(meal.totals.protein)} percentage={formatDayShare(meal.totals.protein, consumedProtein)} />
                <MealNutritionMetric label="Carboidratos" value={formatGrams(meal.totals.carbs)} percentage={formatDayShare(meal.totals.carbs, consumedCarbs)} />
                <MealNutritionMetric label="Gorduras" value={formatGrams(meal.totals.fat)} percentage={formatDayShare(meal.totals.fat, consumedFat)} />
              </div>
            </div>
          ))
        ) : (
          <EmptyCopy text="Nenhuma refeição foi registrada neste dia. Um primeiro registro simples já ajuda a visualizar o dia com mais clareza." />
        )}
      </CardContent>
    </Card>
  );
}

function FoodAssistantCard({
  message,
  suggestion,
  isGenerating,
  isSaving,
  onMessageChange,
  onSubmit,
  onShortcut,
  onSaveSuggestion,
}: {
  message: string;
  suggestion: AssistantSuggestion | null;
  isGenerating: boolean;
  isSaving: boolean;
  onMessageChange: (value: string) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  onShortcut: (message: string) => void;
  onSaveSuggestion: () => void;
}) {
  const shortcuts = [
    "Sugira um jantar usando minhas calorias restantes.",
    "Como posso bater minha proteína hoje?",
    "Quero um lanche barato para agora.",
    "Sugira uma substituição alimentar simples.",
  ];

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <BrainCircuit className="h-5 w-5 text-primary" />
              Assistente alimentar
            </CardTitle>
            <CardDescription>Peça ideias simples considerando suas metas, preferências e restrições cadastradas.</CardDescription>
          </div>
          <Badge variant="secondary" className="w-fit">Educativo</Badge>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 lg:grid-cols-[0.95fr,1.05fr]">
        <form className="space-y-3" onSubmit={onSubmit}>
          <Textarea
            value={message}
            onChange={event => onMessageChange(event.target.value)}
            placeholder="Ex.: sugira um jantar leve com as calorias restantes"
            aria-label="Pedido para o assistente alimentar"
            className="min-h-28 resize-none"
            maxLength={600}
          />
          <div className="flex flex-wrap gap-2">
            {shortcuts.map(shortcut => (
              <Button
                key={shortcut}
                type="button"
                variant="outline"
                size="sm"
                className="h-auto rounded-full px-3 py-2 text-left whitespace-normal"
                onClick={() => onShortcut(shortcut)}
                disabled={isGenerating}
              >
                {shortcut}
              </Button>
            ))}
          </div>
          <Button type="submit" disabled={isGenerating || message.trim().length < 3}>
            {isGenerating ? "Gerando sugestão..." : "Pedir sugestão"}
          </Button>
          <p className="text-xs leading-5 text-muted-foreground">
            As sugestões são educativas e não substituem orientação de nutricionista, médico ou outro profissional de saúde.
          </p>
        </form>

        <div className="rounded-2xl border bg-muted/20 p-4">
          {suggestion ? (
            <div className="space-y-4">
              <p className="text-sm leading-6 text-muted-foreground">{suggestion.text}</p>
              <div className="grid gap-2 sm:grid-cols-4">
                <MiniMacro label="Calorias" value={formatCalories(suggestion.estimatedCalories)} />
                <MiniMacro label="Proteínas" value={formatGrams(suggestion.estimatedMacros.protein)} />
                <MiniMacro label="Carboidratos" value={formatGrams(suggestion.estimatedMacros.carbs)} />
                <MiniMacro label="Gorduras" value={formatGrams(suggestion.estimatedMacros.fat)} />
              </div>
              {suggestion.suggestedFoods.length ? (
                <div className="space-y-2">
                  <p className="text-sm font-medium tracking-tight">Alimentos sugeridos</p>
                  <div className="grid gap-2">
                    {suggestion.suggestedFoods.map(food => (
                      <div key={`${food.foodName}-${food.portionText}`} className="rounded-xl border bg-background px-3 py-2 text-sm">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-medium">{food.foodName}</span>
                          <span className="text-muted-foreground">{food.portionText}</span>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {formatCalories(food.calories)} · {formatGrams(food.protein)} proteína
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              {suggestion.alert ? <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{suggestion.alert}</p> : null}
              <p className="text-xs leading-5 text-muted-foreground">{suggestion.educationalNotice}</p>
              <Button type="button" onClick={onSaveSuggestion} disabled={isSaving || !suggestion.suggestedFoods.length}>
                {isSaving ? "Salvando..." : "Salvar como refeição"}
              </Button>
            </div>
          ) : (
            <EmptyCopy text="A resposta aparecerá aqui com alimentos sugeridos, calorias, macros e uma observação de segurança quando necessário." />
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function StatBlock({ label, value, sublabel, details }: { label: string; value: string; sublabel: string; details?: string[] }) {
  return (
    <div className="rounded-2xl border bg-background p-4 shadow-sm">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 text-xl font-semibold tracking-tight">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{sublabel}</p>
      {details?.length ? (
        <div className="mt-3 space-y-1 border-t pt-3">
          {details.map(detail => (
            <p key={detail} className="text-xs leading-5 text-muted-foreground">
              {detail}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SupportMetric({ label, value, helper }: { label: string; value: string; helper: string }) {
  return (
    <div className="rounded-2xl border bg-muted/30 p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 text-xl font-semibold tracking-tight">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{helper}</p>
    </div>
  );
}

function CalorieBar({ consumed, goal }: { consumed: number; goal: number }) {
  const progress = macroProgress(consumed, goal);
  const progressText = formatGoalProgressText(consumed, goal);
  const isAboveGoal = goal > 0 && consumed > goal;

  return (
    <div className="space-y-2 rounded-2xl border bg-muted/30 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="font-medium tracking-tight">Calorias</p>
        <p className="text-sm text-muted-foreground">
          {formatCalories(consumed)} / {formatCalories(goal)}
        </p>
      </div>
      <Progress value={progress} className="h-2" />
      <p className="text-xs text-muted-foreground">
        {isAboveGoal ? `${progressText} ${SAFE_NUTRITION_MESSAGES.aboveDailyGoal}` : progressText}
      </p>
    </div>
  );
}

function MacroBar({ label, consumed, goal }: { label: string; consumed: number; goal: number }) {
  const progress = macroProgress(consumed, goal);
  const progressText = formatGoalProgressText(consumed, goal);
  const isAboveGoal = goal > 0 && consumed > goal;

  return (
    <div className="space-y-2 rounded-2xl border bg-muted/30 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="font-medium tracking-tight">{label}</p>
        <p className="text-sm text-muted-foreground">
          {formatGrams(consumed)} / {formatGrams(goal)}
        </p>
      </div>
      <Progress value={progress} className="h-2" />
      <p className="text-xs text-muted-foreground">
        {isAboveGoal ? `${progressText} ${SAFE_NUTRITION_MESSAGES.macroAboveGoal}` : progressText}
      </p>
    </div>
  );
}

function MiniMacro({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-muted/40 px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-medium tracking-tight">{value}</p>
    </div>
  );
}

function MealNutritionMetric({ label, value, percentage }: { label: string; value: string; percentage: string }) {
  return (
    <div className="rounded-xl bg-muted/40 px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-medium tracking-tight">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{percentage}</p>
    </div>
  );
}

function EmptyCopy({ text }: { text: string }) {
  return <UXState compact description={text} />;
}
