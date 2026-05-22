import React from "react";
import DashboardLayout from "@/components/DashboardLayout";
import PageIntro from "@/components/PageIntro";
import UXState from "@/components/UXState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  formatCalories,
  formatCountPtBr,
  formatGrams,
  formatIntegerInputPtBr,
  formatIntegerPtBr,
  formatNumberPtBr,
  formatPercentPtBr,
  parseIntegerInputPtBr,
} from "@/lib/numberFormat";
import { toDateInputValue, toDateTimeLocalValue, zonedDateTimeLocalToIso } from "@/lib/dateTime";
import { trpc } from "@/lib/trpc";
import { buildDailyNutritionStatus, SAFE_NUTRITION_MESSAGES } from "@shared/safeMessages";
import {
  Activity,
  ArrowRight,
  Award,
  BrainCircuit,
  CalendarDays,
  Droplets,
  Dumbbell,
  Flame,
  ListChecks,
  PencilLine,
  Salad,
  Trash2,
  X,
} from "lucide-react";
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

function macroProgress(consumed: number, goal: number) {
  if (!goal) return 0;
  return Math.min((consumed / goal) * 100, 100);
}

function positiveRemaining(value: number) {
  return Math.max(value, 0);
}

function buildDefaultExerciseForm() {
  return {
    activityType: "Corrida",
    durationMinutes: formatIntegerInputPtBr(45),
    caloriesBurned: formatIntegerInputPtBr(450),
    occurredAt: toDateTimeLocalValue(new Date()),
    notes: "",
  };
}

function buildDefaultWaterForm() {
  return {
    amountMl: formatIntegerInputPtBr(300),
    occurredAt: toDateTimeLocalValue(new Date()),
    dailyTargetMl: formatIntegerInputPtBr(2500),
  };
}

function buildExerciseEditForm(exercise: {
  activityType: string;
  durationMinutes: number;
  caloriesBurned: number;
  occurredAt: number;
  notes?: string | null;
}) {
  return {
    activityType: exercise.activityType,
    durationMinutes: formatIntegerInputPtBr(exercise.durationMinutes),
    caloriesBurned: formatIntegerInputPtBr(exercise.caloriesBurned),
    occurredAt: toDateTimeLocalValue(new Date(Number(exercise.occurredAt))),
    notes: exercise.notes ?? "",
  };
}

export default function Home() {
  const utils = trpc.useUtils();
  const overview = trpc.nutrition.dashboard.overview.useQuery();
  const waterGoal = trpc.nutrition.water.goal.useQuery();
  const [assistantMessage, setAssistantMessage] = React.useState("");
  const [assistantSuggestion, setAssistantSuggestion] = React.useState<AssistantSuggestion | null>(null);
  const [exerciseForm, setExerciseForm] = React.useState(buildDefaultExerciseForm);
  const [waterForm, setWaterForm] = React.useState(buildDefaultWaterForm);
  const [editingExerciseId, setEditingExerciseId] = React.useState<number | null>(null);
  const [editingExerciseForm, setEditingExerciseForm] = React.useState(buildDefaultExerciseForm);

  React.useEffect(() => {
    if (waterGoal.data?.dailyTargetMl) {
      setWaterForm(current => ({ ...current, dailyTargetMl: formatIntegerInputPtBr(waterGoal.data.dailyTargetMl) }));
    }
  }, [waterGoal.data?.dailyTargetMl]);

  const createExercise = trpc.nutrition.exercises.create.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.nutrition.dashboard.overview.invalidate(),
        utils.nutrition.reports.weekly.invalidate(),
      ]);
      setExerciseForm(buildDefaultExerciseForm());
    },
  });

  const updateExercise = trpc.nutrition.exercises.update.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.nutrition.dashboard.overview.invalidate(),
        utils.nutrition.reports.weekly.invalidate(),
      ]);
      setEditingExerciseId(null);
      setEditingExerciseForm(buildDefaultExerciseForm());
    },
  });

  const removeExercise = trpc.nutrition.exercises.remove.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.nutrition.dashboard.overview.invalidate(),
        utils.nutrition.reports.weekly.invalidate(),
      ]);
    },
  });

  const createWaterLog = trpc.nutrition.water.create.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.nutrition.dashboard.overview.invalidate(),
        utils.nutrition.reports.weekly.invalidate(),
        utils.nutrition.water.list.invalidate(),
      ]);
      setWaterForm(current => ({
        ...current,
        amountMl: formatIntegerInputPtBr(300),
        occurredAt: toDateTimeLocalValue(new Date()),
      }));
    },
  });

  const updateWaterGoal = trpc.nutrition.water.updateGoal.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.nutrition.dashboard.overview.invalidate(),
        utils.nutrition.water.goal.invalidate(),
      ]);
    },
  });

  const removeWaterLog = trpc.nutrition.water.remove.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.nutrition.dashboard.overview.invalidate(),
        utils.nutrition.reports.weekly.invalidate(),
        utils.nutrition.water.list.invalidate(),
      ]);
    },
  });

  const updateGamification = trpc.nutrition.gamification.updateSettings.useMutation({
    onSuccess: async () => {
      await utils.nutrition.dashboard.overview.invalidate();
      await utils.nutrition.gamification.get.invalidate();
    },
  });

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

  const handleExerciseSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    createExercise.mutate({
      activityType: exerciseForm.activityType.trim(),
      durationMinutes: parseIntegerInputPtBr(exerciseForm.durationMinutes),
      caloriesBurned: parseIntegerInputPtBr(exerciseForm.caloriesBurned),
      occurredAt: zonedDateTimeLocalToIso(exerciseForm.occurredAt),
      notes: exerciseForm.notes.trim() || undefined,
    });
  };

  const handleWaterSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    createWaterLog.mutate({
      amountMl: parseIntegerInputPtBr(waterForm.amountMl),
      occurredAt: zonedDateTimeLocalToIso(waterForm.occurredAt),
    });
  };

  const handleQuickWater = (amountMl: number) => {
    createWaterLog.mutate({
      amountMl,
      occurredAt: new Date().toISOString(),
    });
  };

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

  const weeklyCombined = overview.data?.weekly ?? [];
  const waterGoalValue = parseIntegerInputPtBr(waterForm.dailyTargetMl);
  const waterAmountValue = parseIntegerInputPtBr(waterForm.amountMl);
  const isWaterGoalInvalid = waterGoalValue < 250 || waterGoalValue > 10000;
  const isWaterAmountInvalid = waterAmountValue < 50 || waterAmountValue > 5000;
  const todayKey = toDateInputValue(new Date());
  const todaysMeals = (overview.data?.meals ?? []).filter(meal => toDateInputValue(new Date(meal.occurredAt)) === todayKey);
  const consumedCalories = overview.data?.today.consumed.calories ?? 0;
  const calorieGoal = overview.data?.today.goal.calories ?? 0;
  const remainingCalories = overview.data?.today.remaining.calories ?? 0;
  const dailyStatus = buildDailyNutritionStatus(consumedCalories, calorieGoal, overview.data?.today.remaining.protein ?? 0);

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
            title="Não foi possível carregar o dashboard agora"
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
          eyebrow="Dashboard"
          title="Resumo do dia"
          description="O painel foi reorganizado para destacar o que pede ação agora: consumo, saldo, hidratação, exercícios e refeições registradas."
          actions={
            <>
              <Link href="/reports">
                <Button variant="outline" className="rounded-full">
                  Abrir relatórios
                </Button>
              </Link>
              <Link href="/log-meal">
                <Button className="rounded-full">
                  Registrar refeição
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
            </>
          }
          stats={
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
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
          <SectionHeading
            title="Foco do dia"
            description="Aqui fica o que ajuda a decidir os próximos registros sem precisar percorrer a página inteira."
          />
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
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <StatBlock label="Meta calórica" value={formatCalories(calorieGoal)} sublabel={overview.data?.today.goal.label ?? "Planejamento diário"} />
                    <StatBlock label="Proteína" value={formatGrams(overview.data?.today.consumed.protein ?? 0)} sublabel={`Meta ${formatGrams(overview.data?.today.goal.protein ?? 0)}`} />
                    <StatBlock label="Carboidratos" value={formatGrams(overview.data?.today.consumed.carbs ?? 0)} sublabel={`Meta ${formatGrams(overview.data?.today.goal.carbs ?? 0)}`} />
                    <StatBlock label="Refeições" value={formatCountPtBr(todaysMeals.length)} sublabel="Registradas hoje" />
                  </div>
                  <div className="grid gap-3 lg:grid-cols-3">
                    <MacroBar label="Proteínas" consumed={overview.data?.today.consumed.protein ?? 0} goal={overview.data?.today.goal.protein ?? 0} />
                    <MacroBar label="Carboidratos" consumed={overview.data?.today.consumed.carbs ?? 0} goal={overview.data?.today.goal.carbs ?? 0} />
                    <MacroBar label="Gorduras" consumed={overview.data?.today.consumed.fat ?? 0} goal={overview.data?.today.goal.fat ?? 0} />
                  </div>
                </CardContent>
              </Card>

              <Card className="border-0 shadow-sm">
                <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <CardTitle>Refeições do dia</CardTitle>
                    <CardDescription>Registros confirmados hoje, com calorias e macros por refeição.</CardDescription>
                  </div>
                  <Link href="/meals">
                    <Button variant="ghost" className="gap-2 px-0 sm:px-3">
                      Ver lista completa
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  </Link>
                </CardHeader>
                <CardContent className="space-y-3">
                  {todaysMeals.length ? (
                    todaysMeals.map(meal => (
                      <div key={meal.id} className="rounded-2xl border bg-background p-4 shadow-sm">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-medium tracking-tight">{meal.mealLabel}</p>
                              <Badge variant="secondary">{meal.source === "web" ? "Web" : "WhatsApp"}</Badge>
                            </div>
                            <p className="text-sm text-muted-foreground">
                              {new Date(meal.occurredAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                            </p>
                          </div>
                          <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">{formatCalories(meal.totals.calories)}</Badge>
                        </div>
                        <div className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
                          <MiniMacro label="Proteínas" value={formatGrams(meal.totals.protein)} />
                          <MiniMacro label="Carboidratos" value={formatGrams(meal.totals.carbs)} />
                          <MiniMacro label="Gorduras" value={formatGrams(meal.totals.fat)} />
                        </div>
                        <div className="mt-4 flex flex-wrap gap-2">
                          {meal.items.map(item => (
                            <Badge key={`${meal.id}-${item.foodName}`} variant="outline" className="rounded-full px-3 py-1 text-xs">
                              {item.foodName} · {item.portionText}
                            </Badge>
                          ))}
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

        <section className="space-y-4">
          <SectionHeading
            title="Aprofundar sem alongar a página"
            description="Os blocos abaixo foram agrupados por tarefa para deixar o dashboard mais leve no primeiro olhar, sem perder informação nem atalhos de ação."
          />

          <Tabs defaultValue="routine" className="gap-4">
            <TabsList className="grid h-auto w-full grid-cols-2 gap-2 rounded-2xl bg-muted/60 p-2 xl:grid-cols-4">
              <TabsTrigger className="min-h-11 rounded-xl" value="quality">
                <Award className="h-4 w-4" />
                Qualidade
              </TabsTrigger>
              <TabsTrigger className="min-h-11 rounded-xl" value="week">
                <CalendarDays className="h-4 w-4" />
                Semana
              </TabsTrigger>
              <TabsTrigger className="min-h-11 rounded-xl" value="routine">
                <Activity className="h-4 w-4" />
                Registros rápidos
              </TabsTrigger>
              <TabsTrigger className="min-h-11 rounded-xl" value="history">
                <ListChecks className="h-4 w-4" />
                Histórico
              </TabsTrigger>
            </TabsList>

            <TabsContent value="quality" className="space-y-4">
              <div className="grid gap-4 xl:grid-cols-[1.15fr,0.85fr]">
                <Card className="border-0 shadow-sm">
                  <CardHeader>
                    <CardTitle>Qualidade alimentar de hoje</CardTitle>
                    <CardDescription>Indicadores simples a partir dos alimentos classificados e dos registros de água.</CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <StatBlock label="Fibras" value={formatGrams(overview.data?.today.quality?.fiberGrams ?? 0)} sublabel="Quando disponível no alimento" />
                    <StatBlock label="Frutas" value={formatNumberPtBr(overview.data?.today.quality?.fruitServings ?? 0, { maximumFractionDigits: 1 })} sublabel="Porções registradas" />
                    <StatBlock label="Vegetais" value={formatNumberPtBr(overview.data?.today.quality?.vegetableServings ?? 0, { maximumFractionDigits: 1 })} sublabel="Porções registradas" />
                    <StatBlock label="Regularidade" value={`${formatIntegerPtBr(overview.data?.today.quality?.regularityScore ?? 0)}%`} sublabel={`${formatCountPtBr(overview.data?.today.quality?.mealCount ?? 0)} refeições hoje`} />
                    <StatBlock label="Proteína" value={formatGrams(overview.data?.today.quality?.proteinGrams ?? 0)} sublabel="Total do dia" />
                    <StatBlock label="Água" value={`${formatIntegerPtBr(overview.data?.today.quality?.waterMl ?? 0)} ml`} sublabel="Total registrado" />
                    <StatBlock label="Ultraprocessados" value={formatNumberPtBr(overview.data?.today.quality?.ultraProcessedServings ?? 0, { maximumFractionDigits: 1 })} sublabel="Porções registradas" />
                  </CardContent>
                </Card>

                <Card className="border-0 shadow-sm">
                  <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        <Award className="h-5 w-5 text-primary" />
                        Badges de consistência
                      </CardTitle>
                      <CardDescription>Reconhecimentos focados em registro, hidratação, planejamento e rotina sustentável.</CardDescription>
                    </div>
                    <label className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Switch
                        checked={overview.data?.gamification?.enabled ?? true}
                        onCheckedChange={enabled => updateGamification.mutate({ enabled })}
                        disabled={updateGamification.isPending}
                      />
                      Gamificação ativa
                    </label>
                  </CardHeader>
                  <CardContent>
                    {overview.data?.gamification?.enabled === false ? (
                      <EmptyCopy text="Gamificação desativada. Seus registros seguem funcionando normalmente, sem exibir novos badges." />
                    ) : overview.data?.gamification?.earnedBadges?.length ? (
                      <div className="grid gap-3 sm:grid-cols-2">
                        {overview.data.gamification.earnedBadges.slice(0, 6).map(badge => (
                          <div key={`${badge.code}-${badge.weekStart ?? "geral"}`} className="rounded-2xl border bg-muted/20 p-4">
                            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                              <Award className="h-5 w-5" />
                            </div>
                            <p className="mt-3 font-semibold tracking-tight">{badge.title}</p>
                            <p className="mt-1 text-sm leading-5 text-muted-foreground">{badge.description}</p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <EmptyCopy text="Os badges aparecem aqui conforme a semana ganha registros consistentes, com foco em rotina, planejamento e cuidado sustentável." />
                    )}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="week" className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <MetricCard icon={Flame} title="Líquido de hoje" value={formatCalories(overview.data?.today.net.calories ?? 0)} description="Consumo menos exercícios" />
                <MetricCard icon={Dumbbell} title="Gasto com exercícios" value={formatCalories(overview.data?.today.burned.calories ?? 0)} description="Queimadas hoje" />
                <MetricCard icon={Droplets} title="Água hoje" value={formatCountPtBr(overview.data?.today.water.consumedMl ?? 0, " ml")} description={`Meta ${formatCountPtBr(overview.data?.today.water.goalMl ?? 0, " ml")}`} />
                <MetricCard icon={BrainCircuit} title="Hábitos lembrados" value={formatCountPtBr(overview.data?.habits.length ?? 0)} description="Preferências aprendidas" />
              </div>

              <div className="grid gap-4 xl:grid-cols-[1.1fr,0.9fr]">
                <Card className="border-0 shadow-sm">
                  <CardHeader>
                    <CardTitle>Equação energética do dia</CardTitle>
                    <CardDescription>Visão direta de meta, consumo alimentar e gasto com exercícios.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      <StatBlock label="Meta" value={formatCalories(overview.data?.today.goal.calories ?? 0)} sublabel="Planejamento do dia" />
                      <StatBlock label="Alimentos" value={formatCalories(overview.data?.today.consumed.calories ?? 0)} sublabel="Consumo alimentar" />
                      <StatBlock label="Exercícios" value={formatCalories(overview.data?.today.burned.calories ?? 0)} sublabel="Gasto energético" />
                      <StatBlock label="Saldo líquido" value={formatCalories(overview.data?.today.net.calories ?? 0)} sublabel={`Restam ${formatCalories(overview.data?.today.net.remainingToGoal ?? 0)}`} />
                    </div>
                    <div className="rounded-2xl border bg-muted/30 p-4">
                      <p className="text-sm font-medium tracking-tight">Leitura do balanço</p>
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">
                        O saldo líquido considera o consumo alimentar descontado do gasto com exercícios. Assim, a meta fica mais legível quando você quer entender se o dia terminou acima, abaixo ou dentro do planejado.
                      </p>
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-0 shadow-sm">
                  <CardHeader>
                    <CardTitle>Resumo líquido da semana</CardTitle>
                    <CardDescription>Consolidação semanal entre meta, consumo e gasto acumulado.</CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-3">
                    <StatBlock label="Meta semanal" value={formatCalories(overview.data?.week.planned.calories ?? 0)} sublabel="Soma das metas planejadas" />
                    <StatBlock label="Consumo semanal" value={formatCalories(overview.data?.week.consumed.calories ?? 0)} sublabel="Alimentos confirmados" />
                    <StatBlock label="Exercícios" value={formatCalories(overview.data?.week.burned.calories ?? 0)} sublabel="Gasto energético acumulado" />
                    <StatBlock label="Saldo líquido" value={formatCalories(overview.data?.week.net.calories ?? 0)} sublabel={`Restam ${formatCalories(overview.data?.week.net.remainingToGoal ?? 0)}`} />
                  </CardContent>
                </Card>
              </div>

              <Card className="border-0 shadow-sm">
                <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <CardTitle>Visão semanal combinada</CardTitle>
                    <CardDescription>Leitura unificada de calorias líquidas, hidratação e adesão diária à meta.</CardDescription>
                  </div>
                  <Link href="/reports">
                    <Button variant="ghost" className="gap-2 px-0 sm:px-3">
                      Abrir relatórios
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  </Link>
                </CardHeader>
                <CardContent>
                  {weeklyCombined.length ? (
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-7">
                      {weeklyCombined.map(day => {
                        const calorieProgress = macroProgress(day.netCalories ?? 0, day.goalCalories);
                        const waterProgress = macroProgress(day.waterConsumedMl ?? 0, day.waterGoalMl ?? 0);
                        const adherenceProgress = macroProgress(day.calories, day.goalCalories);
                        return (
                          <div key={day.date} className="rounded-2xl border bg-muted/30 p-4">
                            <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">{day.label}</p>
                            <p className="mt-3 text-lg font-semibold tracking-tight">{formatCalories(day.netCalories ?? 0)}</p>
                            <p className="text-xs text-muted-foreground">saldo líquido do dia</p>
                            <div className="mt-4 space-y-3">
                              <MiniProgress label="Líquido" value={formatCalories(day.netCalories ?? 0)} progress={calorieProgress} helper={`Meta ${formatCalories(day.goalCalories)}`} />
                              <MiniProgress label="Água" value={formatCountPtBr(day.waterConsumedMl ?? 0, " ml")} progress={waterProgress} helper={`Meta ${formatCountPtBr(day.waterGoalMl ?? 0, " ml")}`} />
                              <MiniProgress label="Adesão" value={`${formatPercentPtBr(adherenceProgress)}%`} progress={adherenceProgress} helper={`Exercícios ${formatCalories(day.exerciseCalories ?? 0)}`} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <EmptyCopy text="A visão semanal aparecerá aqui conforme os dias ganharem registros de refeição, água e exercícios." />
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="routine" className="space-y-4">
              <div className="grid gap-4 xl:grid-cols-[1fr,1fr]">
                <Card className="border-0 shadow-sm">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Activity className="h-5 w-5 text-primary" />
                      Registrar exercício
                    </CardTitle>
                    <CardDescription>Primeira versão do registro manual de gasto energético.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <form className="space-y-3" onSubmit={handleExerciseSubmit}>
                      <label className="block space-y-2 text-sm">
                        <span className="text-muted-foreground">Atividade</span>
                        <input
                          className="w-full rounded-xl border bg-background px-3 py-2 outline-none transition focus:border-primary"
                          value={exerciseForm.activityType}
                          onChange={event => setExerciseForm(current => ({ ...current, activityType: event.target.value }))}
                          placeholder="Ex.: Corrida leve"
                        />
                      </label>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="block space-y-2 text-sm">
                          <span className="text-muted-foreground">Duração (min)</span>
                          <input
                            type="text"
                            inputMode="numeric"
                            className="w-full rounded-xl border bg-background px-3 py-2 outline-none transition focus:border-primary"
                            value={exerciseForm.durationMinutes}
                            onChange={event =>
                              setExerciseForm(current => ({
                                ...current,
                                durationMinutes: formatIntegerInputPtBr(event.target.value),
                              }))
                            }
                          />
                        </label>
                        <label className="block space-y-2 text-sm">
                          <span className="text-muted-foreground">Gasto estimado (kcal)</span>
                          <input
                            type="text"
                            inputMode="numeric"
                            className="w-full rounded-xl border bg-background px-3 py-2 outline-none transition focus:border-primary"
                            value={exerciseForm.caloriesBurned}
                            onChange={event =>
                              setExerciseForm(current => ({
                                ...current,
                                caloriesBurned: formatIntegerInputPtBr(event.target.value),
                              }))
                            }
                          />
                        </label>
                      </div>
                      <label className="block space-y-2 text-sm">
                        <span className="text-muted-foreground">Data e hora</span>
                        <input
                          type="datetime-local"
                          className="w-full rounded-xl border bg-background px-3 py-2 outline-none transition focus:border-primary"
                          value={exerciseForm.occurredAt}
                          onChange={event => setExerciseForm(current => ({ ...current, occurredAt: event.target.value }))}
                        />
                      </label>
                      <label className="block space-y-2 text-sm">
                        <span className="text-muted-foreground">Observações</span>
                        <textarea
                          rows={3}
                          className="w-full rounded-xl border bg-background px-3 py-2 outline-none transition focus:border-primary"
                          value={exerciseForm.notes}
                          onChange={event => setExerciseForm(current => ({ ...current, notes: event.target.value }))}
                          placeholder="Opcional: pace, modalidade, intensidade, local..."
                        />
                      </label>
                      <Button type="submit" className="w-full" disabled={createExercise.isPending}>
                        {createExercise.isPending ? "Salvando exercício..." : "Salvar exercício"}
                      </Button>
                    </form>

                    <div className="space-y-3">
                      <p className="text-sm font-medium tracking-tight">Exercícios recentes</p>
                      {overview.data?.exercises?.length ? (
                        overview.data.exercises.map(exercise => (
                          <div key={exercise.id} className="rounded-2xl border bg-muted/30 p-4">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <p className="font-medium tracking-tight">{exercise.activityType}</p>
                                {editingExerciseId === exercise.id ? (
                                  <div className="mt-3 space-y-3">
                                    <input
                                      className="w-full rounded-xl border bg-background px-3 py-2 text-sm outline-none transition focus:border-primary"
                                      value={editingExerciseForm.activityType}
                                      onChange={event => setEditingExerciseForm(current => ({ ...current, activityType: event.target.value }))}
                                    />
                                    <div className="grid gap-3 sm:grid-cols-2">
                                      <input
                                        type="text"
                                        inputMode="numeric"
                                        className="w-full rounded-xl border bg-background px-3 py-2 text-sm outline-none transition focus:border-primary"
                                        value={editingExerciseForm.durationMinutes}
                                        onChange={event =>
                                          setEditingExerciseForm(current => ({
                                            ...current,
                                            durationMinutes: formatIntegerInputPtBr(event.target.value),
                                          }))
                                        }
                                      />
                                      <input
                                        type="text"
                                        inputMode="numeric"
                                        className="w-full rounded-xl border bg-background px-3 py-2 text-sm outline-none transition focus:border-primary"
                                        value={editingExerciseForm.caloriesBurned}
                                        onChange={event =>
                                          setEditingExerciseForm(current => ({
                                            ...current,
                                            caloriesBurned: formatIntegerInputPtBr(event.target.value),
                                          }))
                                        }
                                      />
                                    </div>
                                    <input
                                      type="datetime-local"
                                      className="w-full rounded-xl border bg-background px-3 py-2 text-sm outline-none transition focus:border-primary"
                                      value={editingExerciseForm.occurredAt}
                                      onChange={event => setEditingExerciseForm(current => ({ ...current, occurredAt: event.target.value }))}
                                    />
                                    <textarea
                                      rows={2}
                                      className="w-full rounded-xl border bg-background px-3 py-2 text-sm outline-none transition focus:border-primary"
                                      value={editingExerciseForm.notes}
                                      onChange={event => setEditingExerciseForm(current => ({ ...current, notes: event.target.value }))}
                                    />
                                  </div>
                                ) : (
                                  <>
                                    <p className="text-sm text-muted-foreground">
                                      {formatCountPtBr(exercise.durationMinutes, " min")} · {formatCalories(exercise.caloriesBurned)}
                                    </p>
                                    <p className="text-xs text-muted-foreground">{new Date(Number(exercise.occurredAt)).toLocaleString("pt-BR")}</p>
                                    {exercise.notes ? <p className="mt-2 text-sm text-muted-foreground">{exercise.notes}</p> : null}
                                  </>
                                )}
                              </div>
                              <div className="flex shrink-0 flex-col gap-2">
                                {editingExerciseId === exercise.id ? (
                                  <>
                                    <Button
                                      type="button"
                                      variant="outline"
                                      onClick={() =>
                                        updateExercise.mutate({
                                          exerciseId: exercise.id,
                                          activityType: editingExerciseForm.activityType.trim(),
                                          durationMinutes: parseIntegerInputPtBr(editingExerciseForm.durationMinutes),
                                          caloriesBurned: parseIntegerInputPtBr(editingExerciseForm.caloriesBurned),
                                          occurredAt: zonedDateTimeLocalToIso(editingExerciseForm.occurredAt),
                                          notes: editingExerciseForm.notes.trim() || undefined,
                                        })
                                      }
                                      disabled={updateExercise.isPending}
                                    >
                                      {updateExercise.isPending ? "Salvando..." : "Salvar"}
                                    </Button>
                                    <Button
                                      type="button"
                                      size="icon"
                                      variant="ghost"
                                      onClick={() => {
                                        setEditingExerciseId(null);
                                        setEditingExerciseForm(buildDefaultExerciseForm());
                                      }}
                                    >
                                      <X className="h-4 w-4" />
                                    </Button>
                                  </>
                                ) : (
                                  <>
                                    <Button
                                      type="button"
                                      size="icon"
                                      variant="ghost"
                                      onClick={() => {
                                        setEditingExerciseId(exercise.id);
                                        setEditingExerciseForm(buildExerciseEditForm(exercise));
                                      }}
                                    >
                                      <PencilLine className="h-4 w-4" />
                                    </Button>
                                    <Button
                                      type="button"
                                      size="icon"
                                      variant="ghost"
                                      onClick={() => removeExercise.mutate({ exerciseId: exercise.id })}
                                      disabled={removeExercise.isPending}
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                        ))
                      ) : (
                        <EmptyCopy text="Nenhum exercício foi registrado ainda. Use o formulário acima para começar a calcular o saldo líquido do dia e da semana." />
                      )}
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-0 shadow-sm">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Droplets className="h-5 w-5 text-primary" />
                      Água do dia
                    </CardTitle>
                    <CardDescription>Meta diária e registros rápidos de consumo para acompanhar hidratação diária e semanal.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid gap-3 sm:grid-cols-3">
                      <StatBlock label="Consumido" value={formatCountPtBr(overview.data?.today.water.consumedMl ?? 0, " ml")} sublabel="Registrado hoje" />
                      <StatBlock label="Meta" value={formatCountPtBr(overview.data?.today.water.goalMl ?? 0, " ml")} sublabel="Objetivo diário" />
                      <StatBlock label="Restante" value={formatCountPtBr(overview.data?.today.water.remainingMl ?? 0, " ml")} sublabel="Para bater a meta" />
                    </div>

                    <form className="space-y-3" onSubmit={handleWaterSubmit}>
                      <label className="block space-y-2 text-sm">
                        <span className="text-muted-foreground">Meta diária (ml)</span>
                        <div className="flex flex-col gap-2 sm:flex-row">
                          <input
                            type="text"
                            inputMode="numeric"
                            className={`w-full rounded-xl border bg-background px-3 py-2 outline-none transition focus:border-primary ${isWaterGoalInvalid ? "border-amber-500 ring-1 ring-amber-200" : ""}`}
                            value={waterForm.dailyTargetMl}
                            onFocus={event => event.currentTarget.select()}
                            onChange={event =>
                              setWaterForm(current => ({
                                ...current,
                                dailyTargetMl: formatIntegerInputPtBr(event.target.value),
                              }))
                            }
                          />
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => updateWaterGoal.mutate({ dailyTargetMl: waterGoalValue })}
                            disabled={updateWaterGoal.isPending || isWaterGoalInvalid}
                          >
                            {updateWaterGoal.isPending ? "Salvando..." : "Salvar meta"}
                          </Button>
                        </div>
                        {isWaterGoalInvalid ? <p className="text-xs text-amber-600">Use uma meta diária entre 250 ml e 10.000 ml.</p> : null}
                      </label>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="block space-y-2 text-sm">
                          <span className="text-muted-foreground">Consumo (ml)</span>
                          <input
                            type="text"
                            inputMode="numeric"
                            className={`w-full rounded-xl border bg-background px-3 py-2 outline-none transition focus:border-primary ${isWaterAmountInvalid ? "border-amber-500 ring-1 ring-amber-200" : ""}`}
                            value={waterForm.amountMl}
                            onFocus={event => event.currentTarget.select()}
                            onChange={event =>
                              setWaterForm(current => ({
                                ...current,
                                amountMl: formatIntegerInputPtBr(event.target.value),
                              }))
                            }
                          />
                        </label>
                        <label className="block space-y-2 text-sm">
                          <span className="text-muted-foreground">Data e hora</span>
                          <input
                            type="datetime-local"
                            className="w-full rounded-xl border bg-background px-3 py-2 outline-none transition focus:border-primary"
                            value={waterForm.occurredAt}
                            onChange={event => setWaterForm(current => ({ ...current, occurredAt: event.target.value }))}
                          />
                        </label>
                      </div>
                      {isWaterAmountInvalid ? <p className="text-xs text-amber-600">Informe um consumo entre 50 ml e 5.000 ml por registro.</p> : null}
                      <div className="grid gap-2 sm:grid-cols-3">
                        {[200, 300, 500].map(shortcut => (
                          <Button key={shortcut} type="button" variant="outline" onClick={() => handleQuickWater(shortcut)} disabled={createWaterLog.isPending}>
                            + {formatCountPtBr(shortcut, " ml")}
                          </Button>
                        ))}
                      </div>
                      <Button type="submit" className="w-full" disabled={createWaterLog.isPending || isWaterAmountInvalid}>
                        {createWaterLog.isPending ? "Salvando consumo..." : "Registrar água"}
                      </Button>
                    </form>

                    <div className="space-y-3">
                      <p className="text-sm font-medium tracking-tight">Registros recentes</p>
                      {overview.data?.water.logs?.length ? (
                        overview.data.water.logs.map(log => (
                          <div key={log.id} className="rounded-2xl border bg-muted/30 p-4">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="font-medium tracking-tight">{formatCountPtBr(log.amountMl, " ml")}</p>
                                <p className="text-xs text-muted-foreground">{new Date(Number(log.occurredAt)).toLocaleString("pt-BR")}</p>
                              </div>
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                onClick={() => removeWaterLog.mutate({ waterLogId: log.id })}
                                disabled={removeWaterLog.isPending}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        ))
                      ) : (
                        <EmptyCopy text="Nenhum consumo de água foi registrado ainda. Use o formulário acima para iniciar o acompanhamento diário." />
                      )}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="history" className="space-y-4">
              <div className="grid gap-4 xl:grid-cols-[1.35fr,0.65fr]">
                <Card className="border-0 shadow-sm">
                  <CardHeader>
                    <CardTitle>Refeições recentes</CardTitle>
                    <CardDescription>Histórico consolidado após confirmação do usuário.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {overview.data?.meals.length ? (
                      overview.data.meals.map(meal => (
                        <div key={meal.id} className="rounded-2xl border bg-background p-4 shadow-sm">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <p className="font-medium tracking-tight">{meal.mealLabel}</p>
                              <p className="text-sm text-muted-foreground">{new Date(meal.occurredAt).toLocaleString("pt-BR")}</p>
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge variant="secondary">{meal.source === "web" ? "Web" : "WhatsApp"}</Badge>
                              <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">{formatCalories(meal.totals.calories)}</Badge>
                            </div>
                          </div>
                          <div className="mt-4 flex flex-wrap gap-2">
                            {meal.items.map(item => (
                              <Badge key={`${meal.id}-${item.foodName}`} variant="outline" className="rounded-full px-3 py-1 text-xs">
                                {item.foodName} · {item.portionText}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      ))
                    ) : (
                      <EmptyCopy text="Nenhuma refeição foi confirmada ainda. Comece pelo fluxo de registro multimodal." />
                    )}
                  </CardContent>
                </Card>

                <Card className="border-0 shadow-sm">
                  <CardHeader>
                    <CardTitle>Progresso de macronutrientes</CardTitle>
                    <CardDescription>Comparação direta entre consumo atual e objetivo definido.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-5">
                    <MacroBar label="Proteínas" consumed={overview.data?.today.consumed.protein ?? 0} goal={overview.data?.today.goal.protein ?? 0} />
                    <MacroBar label="Carboidratos" consumed={overview.data?.today.consumed.carbs ?? 0} goal={overview.data?.today.goal.carbs ?? 0} />
                    <MacroBar label="Gorduras" consumed={overview.data?.today.consumed.fat ?? 0} goal={overview.data?.today.goal.fat ?? 0} />
                    <StatBlock
                      label="Calorias restantes"
                      value={formatCalories(positiveRemaining(remainingCalories))}
                      sublabel={remainingCalories < 0 ? "Meta já ultrapassada hoje" : "Disponíveis para próximos registros"}
                    />
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
          </Tabs>
        </section>
      </div>
    </DashboardLayout>
  );
}

function SectionHeading({ title, description }: { title: string; description: string }) {
  return (
    <div className="space-y-1">
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{description}</p>
    </div>
  );
}

function MetricCard({
  icon: Icon,
  title,
  value,
  description,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  value: string;
  description: string;
}) {
  return (
    <Card className="border-0 bg-card shadow-sm">
      <CardContent className="flex items-start justify-between gap-4 p-5">
        <div>
          <p className="text-sm text-muted-foreground">{title}</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </div>
      </CardContent>
    </Card>
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
    "Explique meu resumo semanal em linguagem simples.",
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

function MiniProgress({ label, value, progress, helper }: { label: string; value: string; progress: number; helper: string }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
        <p className="text-xs font-semibold tracking-tight">{value}</p>
      </div>
      <Progress value={progress} className="h-2" />
      <p className="text-[11px] text-muted-foreground">{helper}</p>
    </div>
  );
}

function EmptyCopy({ text }: { text: string }) {
  return <UXState compact description={text} />;
}
