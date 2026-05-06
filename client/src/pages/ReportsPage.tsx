import React from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCalories, formatNumberPtBr } from "@/lib/numberFormat";
import { trpc } from "@/lib/trpc";
import { BarChart3, Clock3, Lightbulb, Scale, TrendingUp, UtensilsCrossed } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

function formatMacro(value: number) {
  return formatNumberPtBr(value, {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 1,
    maximumFractionDigits: 1,
  });
}

function formatMealTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function ReportsPage() {
  const weekly = trpc.nutrition.reports.weekly.useQuery();
  const weeklyProgress = trpc.nutrition.reports.weeklyProgress.useQuery();
  const weeklyInsights = trpc.nutrition.reports.weeklyInsights.useQuery();
  const meals = trpc.nutrition.meals.list.useQuery();

  const caloricTrend = weekly.data ?? [];
  const progress = weeklyProgress.data;
  const macroTrend = (weekly.data ?? []).map(day => ({
    label: day.label,
    protein: Math.round(day.protein),
    carbs: Math.round(day.carbs),
    fat: Math.round(day.fat),
  }));
  const detailedMeals = (meals.data ?? []).filter(meal => meal.items?.length);
  const weeklyQuality = (weekly.data ?? []).reduce(
    (acc, day) => ({
      proteinGrams: acc.proteinGrams + (day.quality?.proteinGrams ?? 0),
      fiberGrams: acc.fiberGrams + (day.quality?.fiberGrams ?? 0),
      waterMl: acc.waterMl + (day.quality?.waterMl ?? 0),
      fruitServings: acc.fruitServings + (day.quality?.fruitServings ?? 0),
      vegetableServings: acc.vegetableServings + (day.quality?.vegetableServings ?? 0),
      ultraProcessedServings: acc.ultraProcessedServings + (day.quality?.ultraProcessedServings ?? 0),
      mealCount: acc.mealCount + (day.quality?.mealCount ?? 0),
      regularityScore: acc.regularityScore + ((day.quality?.regularityScore ?? 0) / 7),
    }),
    { proteinGrams: 0, fiberGrams: 0, waterMl: 0, fruitServings: 0, vegetableServings: 0, ultraProcessedServings: 0, mealCount: 0, regularityScore: 0 },
  );

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {weeklyProgress.isLoading ? (
          <div className="grid gap-4 lg:grid-cols-3">
            <Skeleton className="h-32 rounded-2xl" />
            <Skeleton className="h-32 rounded-2xl" />
            <Skeleton className="h-32 rounded-2xl" />
          </div>
        ) : weeklyProgress.isError ? (
          <div className="rounded-2xl border bg-muted/20 p-6 text-sm leading-6 text-muted-foreground">
            Não foi possível carregar o resumo semanal agora. Tente novamente em instantes para ver tendência e contexto da semana.
          </div>
        ) : null}

        {progress ? (
          <section className="space-y-4">
            <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-end">
              <div>
                <Badge variant="secondary" className="mb-2">Visão semanal</Badge>
                <h1 className="text-3xl font-semibold tracking-tight">Progresso nutricional da semana</h1>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                  {progress.summary.message}
                </p>
              </div>
              <div className="rounded-2xl border bg-card px-4 py-3 text-sm text-muted-foreground shadow-sm">
                Saldo semanal: <span className="font-semibold text-foreground">{formatCalories(progress.summary.balanceCalories)}</span>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-4">
              <HighlightCard title="Média semanal" value={formatCalories(progress.summary.averageCalories)} description="Média diária na semana atual." />
              <HighlightCard title="Total semanal" value={formatCalories(progress.summary.totalCalories)} description={`Meta semanal ${formatCalories(progress.summary.totalGoalCalories)}.`} />
              <HighlightCard title="Média de proteína" value={`${formatMacro(progress.summary.averageProtein)} g`} description="Média diária de proteína registrada." />
              <HighlightCard title="Calorias líquidas" value={formatCalories(progress.summary.totalNetCalories)} description={`Exercícios registrados: ${formatCalories(progress.summary.totalExerciseCalories)}.`} />
            </div>

            <div className="grid gap-4 xl:grid-cols-[1.2fr,0.8fr]">
              <Card className="border-0 shadow-sm">
                <CardHeader>
                  <CardTitle>Dias da semana</CardTitle>
                  <CardDescription>Dias sem registro ficam separados para não distorcer a leitura de consistência.</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3 sm:grid-cols-4">
                  <StatusTile label="Dentro da meta" value={progress.summary.daysWithinGoal} />
                  <StatusTile label="Acima da meta" value={progress.summary.daysAboveGoal} />
                  <StatusTile label="Abaixo da meta" value={progress.summary.daysBelowGoal} />
                  <StatusTile label="Sem registro" value={progress.summary.daysWithoutRecords} />
                </CardContent>
              </Card>

              <Card className="border-0 shadow-sm">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Scale className="h-5 w-5 text-primary" />
                    Evolução de peso
                  </CardTitle>
                  <CardDescription>Exibida quando houver registros disponíveis.</CardDescription>
                </CardHeader>
                <CardContent>
                  {progress.weight.hasData ? (
                    <div className="space-y-3">
                      <div className="grid gap-3 sm:grid-cols-3">
                        <StatusTile label="Inicial" value={`${formatMacro(progress.weight.firstWeightKg ?? 0)} kg`} />
                        <StatusTile label="Atual" value={`${formatMacro(progress.weight.lastWeightKg ?? 0)} kg`} />
                        <StatusTile label="Variação" value={`${formatMacro(progress.weight.deltaKg ?? 0)} kg`} />
                      </div>
                      <p className="text-sm leading-6 text-muted-foreground">
                        Peso é melhor lido como tendência. Oscilações de curto prazo podem refletir hidratação, rotina e horários de medição.
                      </p>
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-dashed bg-muted/10 p-5 text-sm leading-6 text-muted-foreground">
                      Nenhum peso registrado ainda. Quando houver dados, a tendência aparece aqui junto do contexto semanal.
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            <Card className="border-0 shadow-sm">
              <CardHeader>
                <CardTitle>Tendência diária</CardTitle>
                <CardDescription>Comparação diária com foco na tendência da semana, não em um dia isolado.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-7">
                {progress.days.map(day => (
                  <div key={day.date} className="rounded-2xl border bg-muted/20 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold tracking-tight">{day.label}</p>
                      <Badge variant="outline">{statusLabel(day.status)}</Badge>
                    </div>
                    <p className="mt-3 text-xl font-semibold tracking-tight">{formatCalories(day.calories)}</p>
                    <p className="text-xs text-muted-foreground">Meta {formatCalories(day.goalCalories)}</p>
                    <Progress className="mt-3 h-2" value={day.goalCalories ? Math.min((day.calories / day.goalCalories) * 100, 100) : 0} />
                    <p className="mt-2 text-xs text-muted-foreground">
                      Saldo líquido {formatCalories(day.netCalories)}
                    </p>
                  </div>
                ))}
              </CardContent>
            </Card>
          </section>
        ) : null}

        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lightbulb className="h-5 w-5 text-primary" />
              Insights alimentares da semana
            </CardTitle>
            <CardDescription>
              Relatório automático com contexto semanal e sugestões pequenas para a próxima semana.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {weeklyInsights.isLoading ? (
              <div className="grid gap-4 lg:grid-cols-2">
                <Skeleton className="h-40 rounded-2xl" />
                <Skeleton className="h-40 rounded-2xl" />
              </div>
            ) : weeklyInsights.isError ? (
              <div className="rounded-2xl border bg-muted/20 p-5 text-sm leading-6 text-muted-foreground">
                Não foi possível carregar os insights agora. Os registros continuam disponíveis para gerar o relatório novamente em instantes.
              </div>
            ) : weeklyInsights.data?.insights.length ? (
              <div className="grid gap-4 lg:grid-cols-2">
                {weeklyInsights.data.insights.map(insight => (
                  <div key={insight.title} className="rounded-2xl border bg-background p-4 shadow-sm">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <Badge className={insightTone(insight.severity)}>{severityLabel(insight.severity)}</Badge>
                        <h3 className="mt-3 text-base font-semibold tracking-tight">{insight.title}</h3>
                      </div>
                    </div>
                    <p className="mt-3 text-sm leading-6 text-muted-foreground">{insight.description}</p>
                    <div className="mt-4 rounded-xl bg-muted/30 p-3">
                      <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Sugestão prática</p>
                      <p className="mt-2 text-sm leading-6 text-foreground">{insight.suggestion}</p>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {Object.entries(insight.data).map(([key, value]) => (
                        <Badge key={key} variant="outline" className="rounded-full">
                          {formatInsightKey(key)}: {String(value ?? "-")}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed bg-muted/10 p-6 text-sm leading-6 text-muted-foreground">
                Ainda não há dados suficientes para gerar insights. Alguns registros de refeição já criam uma base útil.
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle>Indicadores de qualidade da semana</CardTitle>
            <CardDescription>Resumo simples de proteína, fibra, água, frutas, vegetais, ultraprocessados e regularidade.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatusTile label="Proteína" value={`${formatMacro(weeklyQuality.proteinGrams)} g`} />
            <StatusTile label="Fibra" value={`${formatMacro(weeklyQuality.fiberGrams)} g`} />
            <StatusTile label="Água" value={`${Math.round(weeklyQuality.waterMl).toLocaleString("pt-BR")} ml`} />
            <StatusTile label="Frutas" value={formatMacro(weeklyQuality.fruitServings)} />
            <StatusTile label="Vegetais" value={formatMacro(weeklyQuality.vegetableServings)} />
            <StatusTile label="Ultraprocessados" value={formatMacro(weeklyQuality.ultraProcessedServings)} />
            <StatusTile label="Refeições" value={String(weeklyQuality.mealCount)} />
            <StatusTile label="Regularidade" value={`${Math.round(weeklyQuality.regularityScore)}%`} />
          </CardContent>
        </Card>

        <div className="grid gap-4 lg:grid-cols-3">
          <HighlightCard
            title="Consumo semanal"
            value={formatCalories(caloricTrend.reduce((acc, day) => acc + day.calories, 0))}
            description="Soma do período monitorado nos últimos sete dias."
          />
          <HighlightCard
            title="Média diária"
            value={formatCalories(caloricTrend.reduce((acc, day) => acc + day.calories, 0) / Math.max(caloricTrend.length, 1))}
            description="Média simples de calorias ingeridas por dia."
          />
          <HighlightCard
            title="Maior consumo"
            value={formatCalories(Math.max(...caloricTrend.map(day => day.calories), 0))}
            description="Pico calórico identificado na janela semanal atual."
          />
        </div>

        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UtensilsCrossed className="h-5 w-5 text-primary" />
              Alimentos registrados por refeição
            </CardTitle>
            <CardDescription>
              Visualização detalhada dos alimentos confirmados, com horário do registro e composição nutricional de cada item.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {detailedMeals.length ? (
              detailedMeals.map(meal => (
                <div key={meal.id} className="rounded-2xl border border-border/70 bg-card p-4 shadow-sm">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-1">
                      <p className="text-base font-semibold tracking-tight text-foreground">{meal.mealLabel}</p>
                      <p className="text-sm text-muted-foreground">
                        Total da refeição: {formatMacro(meal.totals.calories)} kcal · {formatMacro(meal.totals.protein)} g proteína · {formatMacro(meal.totals.carbs)} g carboidratos · {formatMacro(meal.totals.fat)} g gorduras
                      </p>
                    </div>
                    <div className="inline-flex w-fit items-center gap-2 rounded-full bg-muted px-3 py-1 text-sm font-medium text-foreground">
                      <Clock3 className="h-4 w-4" />
                      Registro às {formatMealTime(meal.occurredAt)}
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {meal.items.map((item, index) => (
                      <div key={`${meal.id}-${item.foodName}-${index}`} className="rounded-xl border border-border/70 bg-muted/20 p-4">
                        <div className="space-y-1">
                          <p className="font-semibold text-foreground">{item.foodName}</p>
                          <p className="text-sm font-medium text-muted-foreground">Porção: {item.portionText}</p>
                        </div>
                        <div className="mt-3 space-y-2 text-sm text-foreground">
                          <div className="flex items-center justify-between gap-3"><span>Proteínas</span><span className="font-medium">{formatMacro(item.protein)} g</span></div>
                          <div className="flex items-center justify-between gap-3"><span>Carboidratos</span><span className="font-medium">{formatMacro(item.carbs)} g</span></div>
                          <div className="flex items-center justify-between gap-3"><span>Gorduras</span><span className="font-medium">{formatMacro(item.fat)} g</span></div>
                          <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-2"><span>Calorias</span><span className="font-semibold">{formatMacro(item.calories)} kcal</span></div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-2xl border border-dashed bg-muted/10 p-6 text-sm text-muted-foreground">
                Nenhuma refeição confirmada foi encontrada para detalhamento no relatório.
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-6 xl:grid-cols-[1.2fr,0.8fr]">
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-primary" />
                Calorias consumidas versus meta
              </CardTitle>
              <CardDescription>
                Compare o volume de ingestão de cada dia com a meta calórica diária configurada para o usuário.
              </CardDescription>
            </CardHeader>
            <CardContent className="h-[360px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={caloricTrend} barSize={28}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="goalCalories" name="Meta" fill="#cbd5e1" radius={[8, 8, 0, 0]} />
                  <Bar dataKey="calories" name="Consumido" fill="#10b981" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-primary" />
                Leitura da semana
              </CardTitle>
              <CardDescription>Resumo analítico do comportamento alimentar observado no período.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {caloricTrend.map(day => {
                const delta = day.calories - day.goalCalories;
                return (
                  <div key={day.date} className="rounded-2xl border bg-muted/20 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-medium tracking-tight">{day.label}</p>
                      <p className={`text-sm font-medium ${delta > 0 ? "text-amber-600" : "text-emerald-600"}`}>
                        {delta > 0 ? `+${formatNumberPtBr(Math.round(delta))}` : formatNumberPtBr(Math.round(delta))} kcal
                      </p>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">
                      Proteínas {formatMacro(day.protein)} g · Carboidratos {formatMacro(day.carbs)} g · Gorduras {formatMacro(day.fat)} g
                    </p>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>

        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle>Distribuição de macronutrientes</CardTitle>
            <CardDescription>
              Evolução agregada de proteínas, carboidratos e gorduras ao longo da semana. Útil para avaliar consistência alimentar e desvios de estratégia.
            </CardDescription>
          </CardHeader>
          <CardContent className="h-[360px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={macroTrend}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="protein" name="Proteínas" stroke="#10b981" strokeWidth={3} dot={{ r: 4 }} />
                <Line type="monotone" dataKey="carbs" name="Carboidratos" stroke="#0ea5e9" strokeWidth={3} dot={{ r: 4 }} />
                <Line type="monotone" dataKey="fat" name="Gorduras" stroke="#f59e0b" strokeWidth={3} dot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

      </div>
    </DashboardLayout>
  );
}

function HighlightCard({ title, value, description }: { title: string; value: string; description: string }) {
  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="p-5">
        <p className="text-sm text-muted-foreground">{title}</p>
        <p className="mt-2 text-3xl font-semibold tracking-tight">{value}</p>
        <p className="mt-2 text-sm text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}

function StatusTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border bg-background p-4 shadow-sm">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
    </div>
  );
}

function statusLabel(status: "within" | "above" | "below" | "no_data") {
  const labels = {
    within: "dentro",
    above: "acima",
    below: "abaixo",
    no_data: "sem registro",
  };
  return labels[status];
}

function severityLabel(severity: "info" | "positive" | "warning") {
  const labels = {
    info: "contexto",
    positive: "bom sinal",
    warning: "atenção leve",
  };
  return labels[severity];
}

function insightTone(severity: "info" | "positive" | "warning") {
  const tones = {
    info: "bg-blue-100 text-blue-700 hover:bg-blue-100",
    positive: "bg-emerald-100 text-emerald-700 hover:bg-emerald-100",
    warning: "bg-amber-100 text-amber-700 hover:bg-amber-100",
  };
  return tones[severity];
}

function formatInsightKey(key: string) {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, value => value.toUpperCase());
}
