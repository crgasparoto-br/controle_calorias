import React from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
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
import { trpc } from "@/lib/trpc";
import { buildDailyNutritionStatus, SAFE_NUTRITION_MESSAGES } from "@shared/safeMessages";
import { Activity, AlertCircle, ArrowRight, Award, BrainCircuit, Droplets, Dumbbell, Flame, PencilLine, Salad, Target, Trash2, X } from "lucide-react";
import { Link } from "wouter";

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
    occurredAt: new Date().toISOString().slice(0, 16),
    notes: "",
  };
}

function buildDefaultWaterForm() {
  return {
    amountMl: formatIntegerInputPtBr(300),
    occurredAt: new Date().toISOString().slice(0, 16),
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
    occurredAt: new Date(Number(exercise.occurredAt)).toISOString().slice(0, 16),
    notes: exercise.notes ?? "",
  };
}

export default function Home() {
  const utils = trpc.useUtils();
  const overview = trpc.nutrition.dashboard.overview.useQuery();
  const waterGoal = trpc.nutrition.water.goal.useQuery();
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
      setWaterForm(current => ({ ...current, amountMl: formatIntegerInputPtBr(300), occurredAt: new Date().toISOString().slice(0, 16) }));
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

  const handleExerciseSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    createExercise.mutate({
      activityType: exerciseForm.activityType.trim(),
      durationMinutes: parseIntegerInputPtBr(exerciseForm.durationMinutes),
      caloriesBurned: parseIntegerInputPtBr(exerciseForm.caloriesBurned),
      occurredAt: new Date(exerciseForm.occurredAt).toISOString(),
      notes: exerciseForm.notes.trim() || undefined,
    });
  };

  const handleWaterSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    createWaterLog.mutate({
      amountMl: parseIntegerInputPtBr(waterForm.amountMl),
      occurredAt: new Date(waterForm.occurredAt).toISOString(),
    });
  };

  const handleQuickWater = (amountMl: number) => {
    createWaterLog.mutate({
      amountMl,
      occurredAt: new Date().toISOString(),
    });
  };

  const weeklyCombined = overview.data?.weekly ?? [];
  const waterGoalValue = parseIntegerInputPtBr(waterForm.dailyTargetMl);
  const waterAmountValue = parseIntegerInputPtBr(waterForm.amountMl);
  const isWaterGoalInvalid = waterGoalValue < 250 || waterGoalValue > 10000;
  const isWaterAmountInvalid = waterAmountValue < 50 || waterAmountValue > 5000;
  const todayKey = new Date().toISOString().slice(0, 10);
  const todaysMeals = (overview.data?.meals ?? []).filter(meal => new Date(meal.occurredAt).toISOString().slice(0, 10) === todayKey);
  const consumedCalories = overview.data?.today.consumed.calories ?? 0;
  const calorieGoal = overview.data?.today.goal.calories ?? 0;
  const remainingCalories = overview.data?.today.remaining.calories ?? 0;
  const dailyStatus = buildDailyNutritionStatus(consumedCalories, calorieGoal, overview.data?.today.remaining.protein ?? 0);

  if (overview.isLoading) {
    return (
      <DashboardLayout>
        <div className="space-y-6">
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
        <Card className="border-0 shadow-sm">
          <CardContent className="flex items-start gap-3 p-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
              <AlertCircle className="h-5 w-5" />
            </div>
            <div>
              <p className="font-semibold tracking-tight">Não foi possível carregar o dashboard agora.</p>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                Tente atualizar a página em instantes. Seus registros seguem sendo a base para acompanhar próximos passos com calma.
              </p>
            </div>
          </CardContent>
        </Card>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <section className="space-y-4">
          <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
            <div className="space-y-2">
              <Badge variant="secondary" className="w-fit">Dashboard diário</Badge>
              <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Resumo de hoje</h1>
              <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
                Acompanhe calorias, macronutrientes, exercícios e saldo energético em um só painel.
              </p>
            </div>
            <Link href="/log-meal">
              <Button className="rounded-full">
                Registrar refeição
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
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
              title="Meta calórica do dia"
              value={formatCalories(calorieGoal)}
              helper={overview.data?.today.goal.label ?? "Planejamento diário"}
              icon={Target}
            />
          </div>

          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle>Qualidade alimentar de hoje</CardTitle>
              <CardDescription>Indicadores simples a partir dos alimentos classificados e dos registros de água.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatBlock label="Fibras" value={formatGrams(overview.data?.today.quality?.fiberGrams ?? 0)} sublabel="Quando disponível no alimento" />
              <StatBlock label="Frutas" value={formatNumberPtBr(overview.data?.today.quality?.fruitServings ?? 0, { maximumFractionDigits: 1 })} sublabel="Porções registradas" />
              <StatBlock label="Vegetais" value={formatNumberPtBr(overview.data?.today.quality?.vegetableServings ?? 0, { maximumFractionDigits: 1 })} sublabel="Porções registradas" />
              <StatBlock label="Regularidade" value={`${formatIntegerPtBr(overview.data?.today.quality?.regularityScore ?? 0)}%`} sublabel={`${formatCountPtBr(overview.data?.today.quality?.mealCount ?? 0)} refeições hoje`} />
              <StatBlock label="Proteína" value={formatGrams(overview.data?.today.quality?.proteinGrams ?? 0)} sublabel="Total do dia" />
              <StatBlock label="Água" value={`${formatIntegerPtBr(overview.data?.today.quality?.waterMl ?? 0)} ml`} sublabel="Total registrado" />
              <StatBlock label="Ultraprocessados" value={formatNumberPtBr(overview.data?.today.quality?.ultraProcessedServings ?? 0, { maximumFractionDigits: 1 })} sublabel="Porções registradas" />
            </CardContent>
          </Card>

          <div className="grid gap-4 xl:grid-cols-[1.1fr,0.9fr]">
            <Card className="border-0 shadow-sm">
              <CardHeader>
                <CardTitle>Progresso por macro</CardTitle>
                <CardDescription>Consumo atual comparado à meta de hoje.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-3">
                <MacroBar label="Proteínas" consumed={overview.data?.today.consumed.protein ?? 0} goal={overview.data?.today.goal.protein ?? 0} />
                <MacroBar label="Carboidratos" consumed={overview.data?.today.consumed.carbs ?? 0} goal={overview.data?.today.goal.carbs ?? 0} />
                <MacroBar label="Gorduras" consumed={overview.data?.today.consumed.fat ?? 0} goal={overview.data?.today.goal.fat ?? 0} />
              </CardContent>
            </Card>

            <Card className="border-0 shadow-sm">
              <CardHeader>
                <CardTitle>Status do dia</CardTitle>
                <CardDescription>Uma leitura rápida para orientar próximos passos.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-2xl border bg-muted/30 p-4">
                  <p className="text-sm leading-6 text-muted-foreground">{dailyStatus}</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <StatBlock label="Proteína" value={formatGrams(overview.data?.today.consumed.protein ?? 0)} sublabel={`Meta ${formatGrams(overview.data?.today.goal.protein ?? 0)}`} />
                  <StatBlock label="Carboidratos" value={formatGrams(overview.data?.today.consumed.carbs ?? 0)} sublabel={`Meta ${formatGrams(overview.data?.today.goal.carbs ?? 0)}`} />
                  <StatBlock label="Gorduras" value={formatGrams(overview.data?.today.consumed.fat ?? 0)} sublabel={`Meta ${formatGrams(overview.data?.today.goal.fat ?? 0)}`} />
                  <StatBlock label="Refeições" value={formatCountPtBr(todaysMeals.length)} sublabel="Registradas hoje" />
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle>Refeições do dia</CardTitle>
              <CardDescription>Registros confirmados hoje, com calorias e macros por refeição.</CardDescription>
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
                        <p className="text-sm text-muted-foreground">{new Date(meal.occurredAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</p>
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
        </section>

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
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {overview.data.gamification.earnedBadges.slice(0, 8).map(badge => (
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

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard icon={Flame} title="Líquido de hoje" value={formatCalories(overview.data?.today.net.calories ?? 0)} description="Consumo menos exercícios" />
          <MetricCard icon={Dumbbell} title="Gasto com exercícios" value={formatCalories(overview.data?.today.burned.calories ?? 0)} description="Queimadas hoje" />
          <MetricCard icon={Droplets} title="Água hoje" value={formatCountPtBr(overview.data?.today.water.consumedMl ?? 0, " ml")} description={`Meta ${formatCountPtBr(overview.data?.today.water.goalMl ?? 0, " ml")}`} />
          <MetricCard icon={BrainCircuit} title="Hábitos lembrados" value={formatCountPtBr(overview.data?.habits.length ?? 0)} description="Preferências aprendidas" />
        </section>

        <section className="grid gap-4 xl:grid-cols-[1.2fr,1fr]">
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle>Equação energética do dia</CardTitle>
              <CardDescription>Visão direta de Meta - Alimentos (Consumo) + Exercícios (Gastos).</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-4">
                <StatBlock label="Meta" value={formatCalories(overview.data?.today.goal.calories ?? 0)} sublabel="Planejamento do dia" />
                <StatBlock label="Alimentos" value={formatCalories(overview.data?.today.consumed.calories ?? 0)} sublabel="Consumo alimentar" />
                <StatBlock label="Exercícios" value={formatCalories(overview.data?.today.burned.calories ?? 0)} sublabel="Gasto energético" />
                <StatBlock label="Saldo líquido" value={formatCalories(overview.data?.today.net.calories ?? 0)} sublabel={`Restam ${formatCalories(overview.data?.today.net.remainingToGoal ?? 0)}`} />
              </div>
              <div className="rounded-2xl border bg-muted/30 p-4">
                <p className="text-sm font-medium tracking-tight">Leitura do balanço</p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  O saldo líquido considera o consumo alimentar descontado do gasto com exercícios. Assim, a meta fica mais
                  legível quando você quer entender se o dia terminou acima, abaixo ou dentro do planejado.
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
        </section>

        <section className="grid gap-4 xl:grid-cols-[1.35fr,1fr,1fr]">
          <Card className="border-0 shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between gap-4">
              <div>
                <CardTitle>Visão semanal combinada</CardTitle>
                <CardDescription>Leitura unificada de calorias líquidas, hidratação e adesão diária à meta.</CardDescription>
              </div>
              <Link href="/reports">
                <Button variant="ghost" className="gap-2">
                  Abrir relatórios
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-7">
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
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle>Registrar exercício</CardTitle>
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
                        <div>
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
                              <p className="text-xs text-muted-foreground">
                                {new Date(Number(exercise.occurredAt)).toLocaleString("pt-BR")}
                              </p>
                              {exercise.notes ? <p className="mt-2 text-sm text-muted-foreground">{exercise.notes}</p> : null}
                            </>
                          )}
                        </div>
                        <div className="flex flex-col gap-2">
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
                                    occurredAt: new Date(editingExerciseForm.occurredAt).toISOString(),
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
              <CardTitle>Água do dia</CardTitle>
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
                  <div className="flex gap-2">
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
        </section>

        <section className="grid gap-4 xl:grid-cols-[1.4fr,1fr]">
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
            </CardContent>
          </Card>
        </section>
      </div>
    </DashboardLayout>
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
  return (
    <div className="rounded-2xl border border-dashed bg-muted/20 p-6 text-sm leading-6 text-muted-foreground">
      {text}
    </div>
  );
}
