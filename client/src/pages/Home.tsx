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
import { formatCalories, formatCountPtBr, formatGrams, formatPercentPtBr } from "@/lib/numberFormat";
import { trpc } from "@/lib/trpc";
import { buildDailyNutritionStatus, SAFE_NUTRITION_MESSAGES } from "@shared/safeMessages";
import { ArrowRight, BrainCircuit, Droplets, Dumbbell, Flame, Salad } from "lucide-react";
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

function macroProgress(consumed: number, goal: number) {
  if (!goal) return 0;
  return Math.min((consumed / goal) * 100, 100);
}

function dayShare(value: number, total: number) {
  if (!total || value <= 0) return 0;
  return (value / total) * 100;
}

function formatDayShare(value: number, total: number) {
  return `${formatPercentPtBr(dayShare(value, total))}% do total do dia`;
}

function positiveRemaining(value: number) {
  return Math.max(value, 0);
}

export default function Home() {
  const utils = trpc.useUtils();
  const overview = trpc.nutrition.dashboard.overview.useQuery();
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
      occurredAt: new Date().toISOString(),
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

  const todaysMeals = overview.data?.meals ?? [];
  const consumedCalories = overview.data?.today.consumed.calories ?? 0;
  const consumedProtein = overview.data?.today.consumed.protein ?? 0;
  const consumedCarbs = overview.data?.today.consumed.carbs ?? 0;
  const consumedFat = overview.data?.today.consumed.fat ?? 0;
  const calorieGoal = overview.data?.today.goal.calories ?? 0;
  const remainingCalories = overview.data?.today.remaining.calories ?? 0;
  const exerciseCalories = overview.data?.today.burned.calories ?? 0;
  const dailyStatus = buildDailyNutritionStatus(consumedCalories, calorieGoal, overview.data?.today.remaining.protein ?? 0);
  const groupedTodaysMeals = React.useMemo<GroupedMealSummary[]>(() => {
    const mealsByLabel = new Map<string, GroupedMealSummary>();

    todaysMeals.forEach(meal => {
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
        id: meal.id,
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
  }, [todaysMeals]);

  if (overview.isLoading) {
    return (
      <DashboardLayout>
        <div className="mx-auto flex max-w-7xl flex-col gap-6">
          <div className="grid gap-4 md:grid-cols-3">
            <Skeleton className="h-36 rounded-2xl" />
            <Skeleton className="h-36 rounded-2xl" />
            <Skeleton className="h-36 rounded-2xl" />
          </div>
          <Skeleton className="h-80 rounded-2xl" />
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
      <div className="mx-auto flex max-w-7xl flex-col gap-8">
        <PageIntro
          eyebrow="Hoje"
          title="Como está o seu dia agora?"
          description=""
          actions={
            <>
              <Link href="/registrar">
                <Button className="rounded-full">
                  Registrar refeição
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
              <Link href="/meals">
                <Button variant="outline" className="rounded-full">
                  Ver registros de hoje
                </Button>
              </Link>
              <Link href="/reports">
                <Button variant="outline" className="rounded-full">
                  Ver relatório da semana
                </Button>
              </Link>
            </>
          }
          stats={
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
              <DailyMetric
                title="Calorias consumidas"
                value={formatCalories(consumedCalories)}
                helper={`${formatPercentPtBr(overview.data?.today.adherence ?? 0)}% da meta do dia`}
                icon={Flame}
              />
              <DailyMetric
                title="Calorias restantes"
                value={formatCalories(positiveRemaining(remainingCalories))}
                helper={remainingCalories < 0 ? "Acima da meta planejada hoje" : "Disponíveis para os próximos registros"}
                icon={Salad}
              />
              <DailyMetric
                title="Exercícios"
                value={formatCalories(exerciseCalories)}
                helper="Queimadas hoje"
                icon={Dumbbell}
              />
              <DailyMetric
                title="Saldo líquido"
                value={formatCalories(overview.data?.today.net.calories ?? 0)}
                helper="Consumo menos exercícios registrados"
                icon={Dumbbell}
              />
              <DailyMetric
                title="Água do dia"
                value={formatCountPtBr(overview.data?.today.water.consumedMl ?? 0, " ml")}
                helper={`Meta ${formatCountPtBr(overview.data?.today.water.goalMl ?? 0, " ml")}`}
                icon={Droplets}
              />
            </div>
          }
        />

        <section className="space-y-4">
          <SectionHeading title="Foco do dia" />
          <div className="grid gap-4 xl:grid-cols-[1.05fr,0.95fr]">
            <div className="space-y-4">
              <Card className="border-0 shadow-sm">
                <CardHeader>
                  <CardTitle>Status do dia</CardTitle>
                  <CardDescription>Leitura rápida do momento atual e da meta planejada.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="rounded-2xl border bg-muted/30 p-4">
                    <p className="text-sm leading-6 text-muted-foreground">{dailyStatus}</p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                    <StatBlock label="Calorias consumidas" value={formatCalories(consumedCalories)} sublabel={`Meta ${formatCalories(calorieGoal)}`} />
                    <StatBlock label="Proteína" value={formatGrams(consumedProtein)} sublabel={`Meta ${formatGrams(overview.data?.today.goal.protein ?? 0)}`} />
                    <StatBlock label="Carboidratos" value={formatGrams(consumedCarbs)} sublabel={`Meta ${formatGrams(overview.data?.today.goal.carbs ?? 0)}`} />
                    <StatBlock label="Gorduras" value={formatGrams(consumedFat)} sublabel={`Meta ${formatGrams(overview.data?.today.goal.fat ?? 0)}`} />
                    <StatBlock label="Refeições" value={formatCountPtBr(groupedTodaysMeals.length)} sublabel="Agrupadas por nome" />
                  </div>
                  <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
                    <CalorieBar consumed={consumedCalories} goal={calorieGoal} />
                    <MacroBar label="Proteínas" consumed={consumedProtein} goal={overview.data?.today.goal.protein ?? 0} />
                    <MacroBar label="Carboidratos" consumed={consumedCarbs} goal={overview.data?.today.goal.carbs ?? 0} />
                    <MacroBar label="Gorduras" consumed={consumedFat} goal={overview.data?.today.goal.fat ?? 0} />
                  </div>
                </CardContent>
              </Card>

              <Card className="border-0 shadow-sm">
                <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <CardTitle>Refeições do dia</CardTitle>
                    <CardDescription>Registros confirmados hoje, somados por refeição.</CardDescription>
                  </div>
                  <Link href="/meals">
                    <Button variant="ghost" className="gap-2 px-0 sm:px-3">
                      Ver lista completa
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  </Link>
                </CardHeader>
                <CardContent className="space-y-3">
                  {groupedTodaysMeals.length ? (
                    groupedTodaysMeals.map(meal => (
                      <div key={meal.id} className="rounded-2xl border bg-background p-4 shadow-sm">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="font-medium tracking-tight">{meal.mealLabel}</p>
                            {meal.count > 1 ? (
                              <p className="mt-1 text-xs text-muted-foreground">{formatCountPtBr(meal.count)} registros somados</p>
                            ) : null}
                          </div>
                        </div>
                        <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                          <MealNutritionMetric
                            label="Calorias"
                            value={formatCalories(meal.totals.calories)}
                            percentage={formatDayShare(meal.totals.calories, consumedCalories)}
                          />
                          <MealNutritionMetric
                            label="Proteínas"
                            value={formatGrams(meal.totals.protein)}
                            percentage={formatDayShare(meal.totals.protein, consumedProtein)}
                          />
                          <MealNutritionMetric
                            label="Carboidratos"
                            value={formatGrams(meal.totals.carbs)}
                            percentage={formatDayShare(meal.totals.carbs, consumedCarbs)}
                          />
                          <MealNutritionMetric
                            label="Gorduras"
                            value={formatGrams(meal.totals.fat)}
                            percentage={formatDayShare(meal.totals.fat, consumedFat)}
                          />
                        </div>
                      </div>
                    ))
                  ) : (
                    <EmptyCopy text="Nenhuma refeição foi registrada hoje. Um primeiro registro simples já ajuda a visualizar o dia com mais clareza." />
                  )}
                </CardContent>
              </Card>
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

function SectionHeading({ title, description }: { title: string; description?: string }) {
  return (
    <div className="space-y-1">
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      {description ? <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{description}</p> : null}
    </div>
  );
}

function DailyMetric({
  icon: Icon,
  title,
  value,
  helper,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  value: string;
  helper: string;
}) {
  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="flex min-h-36 items-start justify-between gap-4 p-5">
        <div>
          <p className="text-sm text-muted-foreground">{title}</p>
          <p className="mt-3 text-3xl font-semibold tracking-tight">{value}</p>
          <p className="mt-2 text-sm leading-5 text-muted-foreground">{helper}</p>
        </div>
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </div>
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

function StatBlock({ label, value, sublabel }: { label: string; value: string; sublabel: string }) {
  return (
    <div className="rounded-2xl border bg-background p-4 shadow-sm">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 text-xl font-semibold tracking-tight">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{sublabel}</p>
    </div>
  );
}

function CalorieBar({ consumed, goal }: { consumed: number; goal: number }) {
  const progress = macroProgress(consumed, goal);
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
        {isAboveGoal ? SAFE_NUTRITION_MESSAGES.aboveDailyGoal : `${formatPercentPtBr(progress)}% da meta de hoje.`}
      </p>
    </div>
  );
}

function MacroBar({ label, consumed, goal }: { label: string; consumed: number; goal: number }) {
  const progress = macroProgress(consumed, goal);
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
        {isAboveGoal ? SAFE_NUTRITION_MESSAGES.macroAboveGoal : `${formatPercentPtBr(progress)}% da meta de hoje.`}
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