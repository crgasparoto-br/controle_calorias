import React from "react";
import PageIntro from "@/components/PageIntro";
import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { DisclosureToggle } from "@/components/ui/disclosure-toggle";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCalories, formatNumberPtBr } from "@/lib/numberFormat";
import { trpc } from "@/lib/trpc";
import {
  ArrowRight,
  BarChart3,
  CalendarDays,
  Clock3,
  Droplets,
  Dumbbell,
  Flame,
  Lightbulb,
  Scale,
  TrendingUp,
  UtensilsCrossed,
} from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Link } from "wouter";

const WEEKDAY_NAMES = ["Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado", "Domingo"];

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

function formatDateHeading(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "short",
  });
}

function formatCalendarDay(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
  });
}

function progressPercent(value: number, goal: number) {
  if (!goal) return 0;
  return Math.min(Math.max((value / goal) * 100, 0), 100);
}

export default function ReportsPage() {
  const reportBundle = trpc.nutrition.reports.bundle.useQuery();

  const caloricTrend = reportBundle.data?.weekly ?? [];
  const progress = reportBundle.data?.progress;
  const weeklyInsights = reportBundle.data?.insights;
  const detailedMealsByDate = reportBundle.data?.mealsByDate ?? [];
  const weeklyQuality = reportBundle.data?.quality ?? {
    proteinGrams: 0,
    fiberGrams: 0,
    waterMl: 0,
    fruitServings: 0,
    vegetableServings: 0,
    ultraProcessedServings: 0,
    mealCount: 0,
    regularityScore: 0,
  };
  const macroTrend = caloricTrend.map(day => ({
    label: day.label,
    protein: Math.round(day.protein),
    carbs: Math.round(day.carbs),
    fat: Math.round(day.fat),
  }));

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {reportBundle.isLoading ? (
          <div className="grid gap-4 lg:grid-cols-3">
            <Skeleton className="h-32 rounded-2xl" />
            <Skeleton className="h-32 rounded-2xl" />
            <Skeleton className="h-32 rounded-2xl" />
          </div>
        ) : reportBundle.isError ? (
          <div className="rounded-2xl border bg-muted/20 p-6 text-sm leading-6 text-muted-foreground">
            Não foi possível carregar o resumo semanal agora. Tente novamente em instantes para ver tendência e contexto da semana.
          </div>
        ) : null}

        {progress ? (
          <section className="space-y-4">
            <PageIntro
              eyebrow="Relatórios"
              title="Progresso nutricional da semana"
              description={progress.summary.message}
              stats={
                <div className="grid gap-4 lg:grid-cols-4">
                  <HighlightCard title="Média semanal" value={formatCalories(progress.summary.averageCalories)} description="Média diária na semana atual." />
                  <HighlightCard title="Total semanal" value={formatCalories(progress.summary.totalCalories)} description={`Meta semanal ${formatCalories(progress.summary.totalGoalCalories)}.`} />
                  <HighlightCard title="Média de proteína" value={`${formatMacro(progress.summary.averageProtein)} g`} description="Média diária de proteína registrada." />
                  <HighlightCard title="Calorias líquidas" value={formatCalories(progress.summary.totalNetCalories)} description={`Exercícios registrados: ${formatCalories(progress.summary.totalExerciseCalories)}.`} />
                </div>
              }
              actions={
                <div className="flex flex-wrap items-center gap-2">
                  <div className="rounded-2xl border bg-card px-4 py-3 text-sm text-muted-foreground shadow-sm">
                    Saldo semanal: <span className="font-semibold text-foreground">{formatCalories(progress.summary.balanceCalories)}</span>
                  </div>
                  <Link href="/log-meal">
                    <Button className="rounded-full">
                      Registrar refeição
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                  </Link>
                </div>
              }
            />

            <Card className="border-0 shadow-sm">
              <CardHeader>
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <CalendarDays className="h-5 w-5 text-primary" />
                      Semana em formato de calendário
                    </CardTitle>
                    <CardDescription>
                      Visual compacto inspirado em calendário: dias da semana em colunas e totais semanais na lateral.
                    </CardDescription>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs text-muted-foreground lg:max-w-[520px] lg:justify-end">
                    <CalendarLegend tone="bg-emerald-500" label="dentro" />
                    <CalendarLegend tone="bg-amber-500" label="acima" />
                    <CalendarLegend tone="bg-sky-500" label="abaixo" />
                    <CalendarLegend tone="bg-muted-foreground" label="sem registro" />
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <WeeklyCalendarBoard progress={progress} caloricTrend={caloricTrend} />

                <div className="grid gap-4 xl:grid-cols-[1.2fr,0.8fr]">
                  <Card className="border bg-muted/10 shadow-none">
                    <CardHeader>
                      <CardTitle>Dias da semana</CardTitle>
                      <CardDescription>Dias sem registro ficam separados para não distorcer a leitura de consistência.</CardDescription>
                    </CardHeader>
                    <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <StatusTile label="Dentro da meta" value={progress.summary.daysWithinGoal} />
                      <StatusTile label="Acima da meta" value={progress.summary.daysAboveGoal} />
                      <StatusTile label="Abaixo da meta" value={progress.summary.daysBelowGoal} />
                      <StatusTile label="Sem registro" value={progress.summary.daysWithoutRecords} />
                    </CardContent>
                  </Card>

                  <Card className="border bg-muted/10 shadow-none">
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
                        <div className="rounded-2xl border border-dashed bg-background/70 p-5 text-sm leading-6 text-muted-foreground">
                          Nenhum peso registrado ainda. Quando houver dados, a tendência aparece aqui junto do contexto semanal.
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </CardContent>
            </Card>
          </section>
        ) : null}

        <section className="space-y-4">
          <SectionHeading
            title="Resumo do período"
            description="Esses números dão uma leitura rápida da semana antes de abrir os blocos mais analíticos."
          />
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
        </section>

        <CollapsibleSection
          title="Insights e qualidade alimentar"
          description="Relatório automático, indicadores de qualidade e sinais práticos ficam agrupados porque explicam o comportamento da semana."
          defaultOpen
          aside={<Lightbulb className="h-5 w-5 text-primary" />}
        >
          <div className="space-y-4">
            <div>
              <div className="mb-3 flex items-center gap-2">
                <Lightbulb className="h-5 w-5 text-primary" />
                <h2 className="text-lg font-semibold tracking-tight">Insights alimentares da semana</h2>
              </div>
              {reportBundle.isLoading ? (
                <div className="grid gap-4 lg:grid-cols-2">
                  <Skeleton className="h-40 rounded-2xl" />
                  <Skeleton className="h-40 rounded-2xl" />
                </div>
              ) : weeklyInsights?.insights.length ? (
                <div className="grid gap-4 lg:grid-cols-2">
                  {weeklyInsights.insights.map(insight => (
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
            </div>

            <div className="rounded-3xl border bg-muted/10 p-4">
              <div className="mb-3">
                <h2 className="text-lg font-semibold tracking-tight">Indicadores de qualidade da semana</h2>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">Proteína, fibra, água, frutas, vegetais, ultraprocessados e regularidade em um só bloco.</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <StatusTile label="Proteína" value={`${formatMacro(weeklyQuality.proteinGrams)} g`} />
                <StatusTile label="Fibra" value={`${formatMacro(weeklyQuality.fiberGrams)} g`} />
                <StatusTile label="Água" value={`${Math.round(weeklyQuality.waterMl).toLocaleString("pt-BR")} ml`} />
                <StatusTile label="Frutas" value={formatMacro(weeklyQuality.fruitServings)} />
                <StatusTile label="Vegetais" value={formatMacro(weeklyQuality.vegetableServings)} />
                <StatusTile label="Ultraprocessados" value={formatMacro(weeklyQuality.ultraProcessedServings)} />
                <StatusTile label="Refeições" value={String(weeklyQuality.mealCount)} />
                <StatusTile label="Regularidade" value={`${Math.round(weeklyQuality.regularityScore)}%`} />
              </div>
            </div>
          </div>
        </CollapsibleSection>

        <CollapsibleSection
          title="Refeições detalhadas"
          description="Lista completa recolhida por padrão para reduzir ruído visual; os alimentos ficam agrupados por data e refeição."
          aside={<UtensilsCrossed className="h-5 w-5 text-primary" />}
        >
          {detailedMealsByDate.length ? (
            <div className="space-y-5">
              {detailedMealsByDate.map(group => {
                const dayCalories = group.items.reduce((acc, meal) => acc + meal.totals.calories, 0);
                return (
                  <div key={group.date} className="rounded-3xl border bg-muted/10 p-4">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-base font-semibold tracking-tight capitalize">{formatDateHeading(group.date)}</p>
                        <p className="text-sm text-muted-foreground">{group.items.length} refeições detalhadas neste dia.</p>
                      </div>
                      <Badge variant="secondary" className="w-fit">{formatCalories(dayCalories)}</Badge>
                    </div>

                    <div className="mt-4 space-y-4">
                      {group.items.map(meal => (
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
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed bg-muted/10 p-6 text-sm text-muted-foreground">
              Nenhuma refeição confirmada foi encontrada para detalhamento no relatório.
            </div>
          )}
        </CollapsibleSection>

        <CollapsibleSection
          title="Gráficos e leitura analítica"
          description="Gráficos de tendência e comparativos ficam recolhidos para consulta quando for necessário investigar desvios."
          aside={<BarChart3 className="h-5 w-5 text-primary" />}
        >
          <div className="space-y-6">
            <div className="grid gap-6 xl:grid-cols-[1.2fr,0.8fr]">
              <Card className="border bg-muted/10 shadow-none">
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

              <Card className="border bg-muted/10 shadow-none">
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
                      <div key={day.date} className="rounded-2xl border bg-background p-4">
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

            <Card className="border bg-muted/10 shadow-none">
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
        </CollapsibleSection>
      </div>
    </DashboardLayout>
  );
}

function WeeklyCalendarBoard({ progress, caloricTrend }: { progress: any; caloricTrend: any[] }) {
  const totals = progress.days.reduce(
    (acc: { calories: number; goal: number; net: number; exercise: number; water: number; meals: number; protein: number; carbs: number; fat: number }, day: any) => {
      const trendDay = caloricTrend.find(item => item.date === day.date);
      acc.calories += day.calories ?? 0;
      acc.goal += day.goalCalories ?? 0;
      acc.net += day.netCalories ?? 0;
      acc.exercise += trendDay?.exerciseCalories ?? 0;
      acc.water += trendDay?.quality?.waterMl ?? 0;
      acc.meals += trendDay?.quality?.mealCount ?? 0;
      acc.protein += trendDay?.protein ?? 0;
      acc.carbs += trendDay?.carbs ?? 0;
      acc.fat += trendDay?.fat ?? 0;
      return acc;
    },
    { calories: 0, goal: 0, net: 0, exercise: 0, water: 0, meals: 0, protein: 0, carbs: 0, fat: 0 },
  );

  return (
    <div className="overflow-x-auto rounded-3xl border bg-background shadow-sm">
      <div className="min-w-[1180px]">
        <div className="grid grid-cols-[repeat(7,minmax(135px,1fr))_210px] border-b bg-muted/40 text-xs font-semibold text-foreground">
          {WEEKDAY_NAMES.map(dayName => (
            <div key={dayName} className="border-r px-3 py-2 text-center">
              {dayName}
            </div>
          ))}
          <div className="bg-foreground/70 px-4 py-2 text-center text-background">Totais semanais</div>
        </div>

        <div className="grid grid-cols-[repeat(7,minmax(135px,1fr))_210px]">
          {progress.days.map((day: any) => {
            const trendDay = caloricTrend.find(item => item.date === day.date);
            const delta = day.calories - day.goalCalories;
            return (
              <div key={day.date} className={`min-h-[420px] border-r p-2 ${calendarCellTone(day.status)}`}>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div>
                    <p className="text-xs text-muted-foreground">{formatCalendarDay(day.date)}</p>
                    <p className="text-sm font-semibold tracking-tight">{day.label}</p>
                  </div>
                  <span className={`h-2.5 w-2.5 rounded-full ${statusDotTone(day.status)}`} />
                </div>

                <div className="space-y-2">
                  <CalendarEvent tone="border-l-emerald-500" icon={Flame} title="Calorias" value={formatCalories(day.calories)} detail={`Meta ${formatCalories(day.goalCalories)}`} />
                  <CalendarEvent tone={delta > 0 ? "border-l-amber-500" : "border-l-sky-500"} icon={TrendingUp} title="Saldo" value={formatCalories(day.netCalories)} detail={`${delta > 0 ? "+" : ""}${formatNumberPtBr(Math.round(delta))} kcal vs. meta`} />
                  <CalendarEvent tone="border-l-orange-500" icon={Dumbbell} title="Exercícios" value={formatCalories(trendDay?.exerciseCalories ?? 0)} detail="Gasto energético" />
                  <CalendarEvent tone="border-l-blue-500" icon={Droplets} title="Água" value={`${Math.round(trendDay?.quality?.waterMl ?? 0).toLocaleString("pt-BR")} ml`} detail="Hidratação" />
                  <div className="rounded-xl border bg-background/85 p-2 text-xs">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="font-medium">Aderência</span>
                      <span className="text-muted-foreground">{formatNumberPtBr(Math.round(progressPercent(day.calories, day.goalCalories)))}%</span>
                    </div>
                    <Progress className="h-1.5" value={progressPercent(day.calories, day.goalCalories)} />
                  </div>
                  <div className="rounded-xl border bg-background/85 p-2 text-xs leading-5 text-muted-foreground">
                    <p className="font-medium text-foreground">Macros</p>
                    <p>P {formatMacro(trendDay?.protein ?? 0)} g</p>
                    <p>C {formatMacro(trendDay?.carbs ?? 0)} g</p>
                    <p>G {formatMacro(trendDay?.fat ?? 0)} g</p>
                  </div>
                </div>
              </div>
            );
          })}

          <div className="min-h-[420px] bg-foreground/70 p-4 text-background">
            <p className="mb-4 text-sm font-semibold tracking-tight">Resumo acumulado</p>
            <WeeklyTotalItem label="Calorias" value={formatCalories(totals.calories)} />
            <WeeklyTotalItem label="Meta" value={formatCalories(totals.goal)} />
            <WeeklyTotalItem label="Saldo líquido" value={formatCalories(totals.net)} />
            <WeeklyTotalItem label="Exercícios" value={formatCalories(totals.exercise)} />
            <WeeklyTotalItem label="Água" value={`${Math.round(totals.water).toLocaleString("pt-BR")} ml`} />
            <WeeklyTotalItem label="Refeições" value={String(totals.meals)} />
            <div className="mt-4 border-t border-background/25 pt-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-background/70">Macros</p>
              <p className="mt-2 text-sm">Proteínas: {formatMacro(totals.protein)} g</p>
              <p className="text-sm">Carboidratos: {formatMacro(totals.carbs)} g</p>
              <p className="text-sm">Gorduras: {formatMacro(totals.fat)} g</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function CalendarEvent({ tone, icon: Icon, title, value, detail }: { tone: string; icon: React.ElementType; title: string; value: string; detail: string }) {
  return (
    <div className={`rounded-xl border border-l-4 bg-background/90 p-2 text-xs shadow-sm ${tone}`}>
      <div className="flex items-center gap-1.5 font-medium text-foreground">
        <Icon className="h-3.5 w-3.5" />
        {title}
      </div>
      <p className="mt-1 font-semibold tracking-tight">{value}</p>
      <p className="text-muted-foreground">{detail}</p>
    </div>
  );
}

function WeeklyTotalItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="mb-3">
      <p className="text-xs font-semibold text-background/75">{label}:</p>
      <p className="text-sm font-semibold leading-5">{value}</p>
    </div>
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

function CollapsibleSection({
  title,
  description,
  defaultOpen = false,
  aside,
  children,
}: {
  title: string;
  description: string;
  defaultOpen?: boolean;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(defaultOpen);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card className="border-0 shadow-sm">
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex gap-3">
            {aside ? <div className="mt-1">{aside}</div> : null}
            <div>
              <CardTitle>{title}</CardTitle>
              <CardDescription>{description}</CardDescription>
            </div>
          </div>
          <CollapsibleTrigger asChild>
            <button type="button" className="w-fit rounded-full">
              <DisclosureToggle expanded={open} />
            </button>
          </CollapsibleTrigger>
        </CardHeader>
        <CollapsibleContent>
          <CardContent>{children}</CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
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

function CalendarLegend({ tone, label }: { tone: string; label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-full border bg-background px-3 py-2">
      <span className={`h-2.5 w-2.5 rounded-full ${tone}`} />
      <span className="font-medium">{label}</span>
    </div>
  );
}

function statusDotTone(status: "within" | "above" | "below" | "no_data") {
  const tones = {
    within: "bg-emerald-500",
    above: "bg-amber-500",
    below: "bg-sky-500",
    no_data: "bg-muted-foreground",
  };
  return tones[status];
}

function calendarCellTone(status: "within" | "above" | "below" | "no_data") {
  const tones = {
    within: "bg-emerald-50/50",
    above: "bg-amber-50/50",
    below: "bg-sky-50/50",
    no_data: "bg-muted/20",
  };
  return tones[status];
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
