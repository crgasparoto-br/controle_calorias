import React from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  formatCalories,
  formatCountPtBr,
  formatGrams,
  formatIntegerInputPtBr,
  formatIntegerPtBr,
  formatPercentPtBr,
  parseIntegerInputPtBr,
} from "@/lib/numberFormat";
import { trpc } from "@/lib/trpc";
import { Activity, ArrowRight, BrainCircuit, Droplets, Dumbbell, Flame, PencilLine, Salad, Target, Trash2, X } from "lucide-react";
import { Link } from "wouter";

function macroProgress(consumed: number, goal: number) {
  if (!goal) return 0;
  return Math.min((consumed / goal) * 100, 100);
}

function buildDefaultExerciseForm() {
  return {
    activityType: "Corrida",
    durationMinutes: "45",
    caloriesBurned: "450",
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
    durationMinutes: String(exercise.durationMinutes),
    caloriesBurned: String(exercise.caloriesBurned),
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

  const handleExerciseSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    createExercise.mutate({
      activityType: exerciseForm.activityType.trim(),
      durationMinutes: Number(exerciseForm.durationMinutes || 0),
      caloriesBurned: Number(exerciseForm.caloriesBurned || 0),
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

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <section className="grid gap-4 xl:grid-cols-[1.5fr,1fr]">
          <Card className="overflow-hidden border-0 bg-gradient-to-br from-emerald-500 via-teal-500 to-cyan-600 text-white shadow-xl shadow-emerald-500/15">
            <CardContent className="relative p-6 sm:p-8">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.2),transparent_40%)]" />
              <div className="relative space-y-5">
                <Badge className="bg-white/12 text-white hover:bg-white/12">IA multimodal ativa</Badge>
                <div className="space-y-2">
                  <h1 className="max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">
                    Acompanhe calorias, macronutrientes, exercícios e saldo energético em um só painel.
                  </h1>
                  <p className="max-w-2xl text-sm leading-6 text-white/85 sm:text-base">
                    Registre refeições por texto, imagem ou áudio, inclua exercícios manualmente e acompanhe a equação
                    entre meta planejada, consumo alimentar e gasto energético ao longo da semana.
                  </p>
                </div>
                <div className="flex flex-wrap gap-3">
                  <Link href="/log-meal">
                    <Button size="lg" variant="secondary" className="rounded-full bg-white text-emerald-700 hover:bg-white/90">
                      Registrar refeição
                    </Button>
                  </Link>
                  <Link href="/reports">
                    <Button size="lg" variant="outline" className="rounded-full border-white/30 bg-white/10 text-white hover:bg-white/15">
                      Ver relatórios
                    </Button>
                  </Link>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 bg-card shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Target className="h-5 w-5 text-primary" />
                Resumo de hoje
              </CardTitle>
              <CardDescription>Saldo diário com base na meta planejada e no consumo registrado.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-2xl bg-muted/50 p-4">
                <p className="text-sm text-muted-foreground">Calorias consumidas</p>
                <div className="mt-2 flex items-end justify-between gap-4">
                  <div>
                    <p className="text-3xl font-semibold tracking-tight">
                      {overview.data ? formatIntegerPtBr(overview.data.today.consumed.calories) : "--"}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      de {overview.data ? formatCalories(overview.data.today.goal.calories) : "--"} planejadas
                    </p>
                  </div>
                  <Badge variant="secondary">{formatPercentPtBr(overview.data?.today.adherence ?? 0)}% da meta</Badge>
                </div>
                <Progress className="mt-4 h-2" value={overview.data?.today.adherence ?? 0} />
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <StatBlock
                  label="Proteínas"
                  value={formatGrams(overview.data?.today.consumed.protein ?? 0)}
                  sublabel={`Restam ${formatGrams(overview.data?.today.remaining.protein ?? 0)}`}
                />
                <StatBlock
                  label="Carboidratos"
                  value={formatGrams(overview.data?.today.consumed.carbs ?? 0)}
                  sublabel={`Restam ${formatGrams(overview.data?.today.remaining.carbs ?? 0)}`}
                />
                <StatBlock
                  label="Gorduras"
                  value={formatGrams(overview.data?.today.consumed.fat ?? 0)}
                  sublabel={`Restam ${formatGrams(overview.data?.today.remaining.fat ?? 0)}`}
                />
              </div>
            </CardContent>
          </Card>
        </section>

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
                      type="number"
                      min={1}
                      className="w-full rounded-xl border bg-background px-3 py-2 outline-none transition focus:border-primary"
                      value={exerciseForm.durationMinutes}
                      onChange={event => setExerciseForm(current => ({ ...current, durationMinutes: event.target.value }))}
                    />
                  </label>
                  <label className="block space-y-2 text-sm">
                    <span className="text-muted-foreground">Gasto estimado (kcal)</span>
                    <input
                      type="number"
                      min={1}
                      className="w-full rounded-xl border bg-background px-3 py-2 outline-none transition focus:border-primary"
                      value={exerciseForm.caloriesBurned}
                      onChange={event => setExerciseForm(current => ({ ...current, caloriesBurned: event.target.value }))}
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
                                  type="number"
                                  min={1}
                                  className="w-full rounded-xl border bg-background px-3 py-2 text-sm outline-none transition focus:border-primary"
                                  value={editingExerciseForm.durationMinutes}
                                  onChange={event => setEditingExerciseForm(current => ({ ...current, durationMinutes: event.target.value }))}
                                />
                                <input
                                  type="number"
                                  min={1}
                                  className="w-full rounded-xl border bg-background px-3 py-2 text-sm outline-none transition focus:border-primary"
                                  value={editingExerciseForm.caloriesBurned}
                                  onChange={event => setEditingExerciseForm(current => ({ ...current, caloriesBurned: event.target.value }))}
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
                                    durationMinutes: Number(editingExerciseForm.durationMinutes || 0),
                                    caloriesBurned: Number(editingExerciseForm.caloriesBurned || 0),
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
                      className="w-full rounded-xl border bg-background px-3 py-2 outline-none transition focus:border-primary"
                      value={waterForm.dailyTargetMl}
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
                      onClick={() => updateWaterGoal.mutate({ dailyTargetMl: parseIntegerInputPtBr(waterForm.dailyTargetMl) })}
                      disabled={updateWaterGoal.isPending}
                    >
                      {updateWaterGoal.isPending ? "Salvando..." : "Salvar meta"}
                    </Button>
                  </div>
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block space-y-2 text-sm">
                    <span className="text-muted-foreground">Consumo (ml)</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      className="w-full rounded-xl border bg-background px-3 py-2 outline-none transition focus:border-primary"
                      value={waterForm.amountMl}
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
                <div className="grid gap-2 sm:grid-cols-3">
                  {[200, 300, 500].map(shortcut => (
                    <Button key={shortcut} type="button" variant="outline" onClick={() => handleQuickWater(shortcut)} disabled={createWaterLog.isPending}>
                      + {formatCountPtBr(shortcut, " ml")}
                    </Button>
                  ))}
                </div>
                <Button type="submit" className="w-full" disabled={createWaterLog.isPending}>
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
  return (
    <div className="space-y-2 rounded-2xl border bg-muted/30 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="font-medium tracking-tight">{label}</p>
        <p className="text-sm text-muted-foreground">
          {formatGrams(consumed)} / {formatGrams(goal)}
        </p>
      </div>
      <Progress value={progress} className="h-2" />
      <p className="text-xs text-muted-foreground">{formatPercentPtBr(progress)}% da meta atingida hoje.</p>
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
