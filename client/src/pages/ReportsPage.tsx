import React from "react";
import DashboardLayout from "@/components/DashboardLayout";
import PageIntro from "@/components/PageIntro";
import { PeriodScopeSelector } from "@/components/PeriodScopeSelector";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { RegisteredMealGroups, SummaryPill } from "@/features/meals/components";
import {
  type DateGroupedRegisteredMealsViewModel,
  buildDateGroupedMealGroups,
  buildRegisteredMealGroups,
  filterMealsByDateRange,
  sumStoredMealTotals,
} from "@/features/meals/mealViewModels";
import type { StoredMeal } from "@/features/meals/types";
import {
  countDaysInRange,
  formatMonthLabel,
  formatRangeLabel,
  getMonthRange,
  getWeekOffsetFromToday,
  getWeekRange,
  normalizeDateRange,
  toMonthInputValue,
  type PeriodScope,
} from "@/lib/dateRanges";
import { getBrowserTimeZone, toDateInputValue } from "@/lib/dateTime";
import { formatCalories, formatCountPtBr, formatNumberPtBr } from "@/lib/numberFormat";
import { trpc } from "@/lib/trpc";
import {
  ArrowRight,
  BarChart3,
  CalendarDays,
  ChevronDown,
  Lightbulb,
  Scale,
  TrendingUp,
  UtensilsCrossed,
} from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Link } from "wouter";

function formatMacro(value: number) {
  return formatNumberPtBr(value, {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 1,
    maximumFractionDigits: 1,
  });
}

function progressPercent(value: number, goal: number) {
  if (!goal) return 0;
  return Math.min(Math.max((value / goal) * 100, 0), 100);
}

function formatDateHeading(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "short",
  });
}

function buildReportsHeading(scope: PeriodScope) {
  switch (scope) {
    case "day":
      return {
        title: "Análise diária contra a meta",
        description: "Veja o dia em detalhe, com comparação direta entre consumo, meta atual e refeições lançadas.",
      };
    case "week":
      return {
        title: "Evolução e aderência semanal",
        description: "A semana continua sendo a leitura mais completa de consistência, saldo energético e qualidade alimentar.",
      };
    case "month":
      return {
        title: "Tendência mensal",
        description: "O mês resume padrão por dia, médias e comparação com o mês anterior sempre que houver histórico suficiente.",
      };
    case "range":
      return {
        title: "Resumo analítico por período",
        description: "Use um intervalo configurável para consolidar médias, tendência e dias que merecem revisão mais detalhada.",
      };
  }
}

function toTrendData(groups: DateGroupedRegisteredMealsViewModel[], goalCalories: number) {
  return groups.map(group => ({
    date: group.date,
    label: new Date(`${group.date}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }),
    calories: Math.round(group.totals.calories),
    protein: Math.round(group.totals.protein),
    carbs: Math.round(group.totals.carbs),
    fat: Math.round(group.totals.fat),
    mealCount: group.mealCount,
    goalCalories,
  }));
}

function averageValue(total: number, count: number) {
  if (!count) return 0;
  return total / count;
}

function MonthComparisonCard({
  currentCalories,
  previousCalories,
  currentMonth,
  previousMonth,
}: {
  currentCalories: number;
  previousCalories: number;
  currentMonth: string;
  previousMonth: string;
}) {
  const delta = currentCalories - previousCalories;
  const tone = delta >= 0 ? "text-amber-600" : "text-emerald-600";

  return (
    <Card className="border bg-muted/10 shadow-none">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Scale className="h-5 w-5 text-primary" />
          Comparativo mensal
        </CardTitle>
        <CardDescription>Leitura simples para comparar o volume total do mês com o mês anterior.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <StatusTile label={formatMonthLabel(currentMonth)} value={formatCalories(currentCalories)} />
        <StatusTile label={formatMonthLabel(previousMonth)} value={formatCalories(previousCalories)} />
        <div className="rounded-2xl border bg-background p-4">
          <p className="text-sm text-muted-foreground">Diferença entre os períodos</p>
          <p className={`mt-2 text-2xl font-semibold tracking-tight ${tone}`}>
            {delta > 0 ? "+" : ""}
            {formatCalories(delta)}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function LocalTrendSection({
  title,
  description,
  trendData,
}: {
  title: string;
  description: string;
  trendData: Array<{
    date: string;
    label: string;
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    goalCalories: number;
  }>;
}) {
  if (!trendData.length) {
    return (
      <div className="rounded-2xl border border-dashed bg-muted/10 p-6 text-sm text-muted-foreground">
        Ainda não há dados suficientes no intervalo para desenhar a tendência.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="border bg-muted/10 shadow-none">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary" />
            {title}
          </CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="h-[320px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={trendData} barSize={24}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Bar dataKey="goalCalories" name="Meta" fill="#cbd5e1" radius={[8, 8, 0, 0]} />
              <Bar dataKey="calories" name="Consumido" radius={[8, 8, 0, 0]}>
                {trendData.map(day => (
                  <Cell key={day.date} fill={day.goalCalories && day.calories > day.goalCalories ? "#dc2626" : "#10b981"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card className="border bg-muted/10 shadow-none">
        <CardHeader>
          <CardTitle>Distribuição de macronutrientes</CardTitle>
          <CardDescription>Proteínas, carboidratos e gorduras agregados por dia no intervalo ativo.</CardDescription>
        </CardHeader>
        <CardContent className="h-[320px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={trendData}>
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
  );
}

function DailyDetailsSections({
  groups,
  userTimeZone,
}: {
  groups: DateGroupedRegisteredMealsViewModel[];
  userTimeZone: string;
}) {
  if (!groups.length) {
    return (
      <div className="rounded-2xl border border-dashed bg-muted/10 p-6 text-sm text-muted-foreground">
        Nenhuma refeição confirmada foi encontrada para detalhamento neste intervalo.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {groups.map(group => (
        <details key={group.date} className="group rounded-3xl border bg-muted/10 p-4">
          <summary className="flex cursor-pointer list-none flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-base font-semibold tracking-tight capitalize">{formatDateHeading(group.date)}</p>
              <p className="text-sm text-muted-foreground">{group.mealCount} refeições no dia</p>
            </div>
            <div className="flex items-center gap-3">
              <Badge variant="secondary" className="w-fit">
                {formatCalories(group.totals.calories)}
              </Badge>
              <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
            </div>
          </summary>
          <div className="pt-4">
            <RegisteredMealGroups groups={group.groups} userTimeZone={userTimeZone} emptyMessage="Nenhuma refeição encontrada para este dia." />
          </div>
        </details>
      ))}
    </div>
  );
}

export default function ReportsPage() {
  const userTimeZone = React.useMemo(() => getBrowserTimeZone(), []);
  const [periodScope, setPeriodScope] = React.useState<PeriodScope>("week");
  const [selectedDay, setSelectedDay] = React.useState(() => toDateInputValue());
  const [selectedMonth, setSelectedMonth] = React.useState(() => toMonthInputValue(new Date(), userTimeZone));
  const [rangeStart, setRangeStart] = React.useState(() => toDateInputValue(new Date(Date.now() - 13 * 24 * 60 * 60 * 1000), userTimeZone));
  const [rangeEnd, setRangeEnd] = React.useState(() => toDateInputValue());

  const activeRange = React.useMemo(() => {
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

  const weekOffset = React.useMemo(() => getWeekOffsetFromToday(selectedDay, userTimeZone), [selectedDay, userTimeZone]);
  const reportBundle = trpc.nutrition.reports.bundle.useQuery(
    { weekOffset },
    { enabled: periodScope === "week" },
  );
  const dashboardOverview = trpc.nutrition.dashboard.overview.useQuery();
  const mealsQuery = trpc.nutrition.meals.list.useQuery();

  const goalCalories = dashboardOverview.data?.today?.goal.calories ?? 0;
  const allMeals = (mealsQuery.data ?? []) as StoredMeal[];
  const filteredMeals = React.useMemo(
    () => filterMealsByDateRange(allMeals, { startDate: activeRange.start, endDate: activeRange.end, timeZone: userTimeZone }),
    [activeRange.end, activeRange.start, allMeals, userTimeZone],
  );
  const localTotals = React.useMemo(() => sumStoredMealTotals(filteredMeals), [filteredMeals]);
  const localDayGroupsAsc = React.useMemo(
    () => buildDateGroupedMealGroups(filteredMeals, { timeZone: userTimeZone, sortDirection: "asc" }),
    [filteredMeals, userTimeZone],
  );
  const localDayGroupsDesc = React.useMemo(() => [...localDayGroupsAsc].reverse(), [localDayGroupsAsc]);
  const localTrendData = React.useMemo(() => toTrendData(localDayGroupsAsc, goalCalories), [goalCalories, localDayGroupsAsc]);
  const localDayMealGroups = React.useMemo(() => buildRegisteredMealGroups(filteredMeals), [filteredMeals]);

  const previousMonth = React.useMemo(() => {
    const [year, month] = selectedMonth.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, 1));
    date.setUTCMonth(date.getUTCMonth() - 1);
    return date.toISOString().slice(0, 7);
  }, [selectedMonth]);
  const previousMonthMeals = React.useMemo(() => {
    const range = getMonthRange(previousMonth);
    return filterMealsByDateRange(allMeals, { startDate: range.start, endDate: range.end, timeZone: userTimeZone });
  }, [allMeals, previousMonth, userTimeZone]);
  const previousMonthTotals = React.useMemo(() => sumStoredMealTotals(previousMonthMeals), [previousMonthMeals]);

  const localAverageCalories = averageValue(localTotals.calories, Math.max(localDayGroupsAsc.length, 1));
  const longestRangeDays = countDaysInRange(activeRange);
  const highestDay = localTrendData.reduce<(typeof localTrendData)[number] | null>((current, day) => {
    if (!current || day.calories > current.calories) {
      return day;
    }
    return current;
  }, null);
  const daysAboveGoal = localTrendData.filter(day => goalCalories && day.calories > goalCalories).length;
  const reportsHeading = buildReportsHeading(periodScope);

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
  const mealGroupsByDate = React.useMemo(
    () => detailedMealsByDate.map(group => ({
      date: group.date,
      groups: buildRegisteredMealGroups(group.items as StoredMeal[]),
    })),
    [detailedMealsByDate],
  );

  const introStats = (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <SummaryPill label="Calorias" value={formatCalories(localTotals.calories)} />
      <SummaryPill label="Proteínas" value={formatMacro(localTotals.protein)} />
      <SummaryPill label="Dias com dados" value={String(localDayGroupsAsc.length)} />
      <SummaryPill label="Média diária" value={formatCalories(localAverageCalories)} />
      <SummaryPill label="Intervalo" value={`${longestRangeDays} dias`} />
    </div>
  );

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <PageIntro
          eyebrow="Relatórios"
          title={reportsHeading.title}
          description={`${reportsHeading.description} Intervalo ativo: ${formatRangeLabel(activeRange)}.`}
          stats={introStats}
          actions={
            <PeriodScopeSelector
              scope={periodScope}
              onScopeChange={setPeriodScope}
              selectedDay={selectedDay}
              onSelectedDayChange={setSelectedDay}
              selectedMonth={selectedMonth}
              onSelectedMonthChange={setSelectedMonth}
              rangeStart={rangeStart}
              onRangeStartChange={setRangeStart}
              rangeEnd={rangeEnd}
              onRangeEndChange={setRangeEnd}
            />
          }
        />

        {periodScope === "day" ? (
          <>
            <div className="grid gap-4 lg:grid-cols-4">
              <HighlightCard title="Meta atual" value={formatCalories(goalCalories)} description="Meta líquida usada como referência para o comparativo." />
              <HighlightCard title="Consumo do dia" value={formatCalories(localTotals.calories)} description="Soma das refeições registradas na data selecionada." />
              <HighlightCard title="Saldo contra meta" value={formatCalories(localTotals.calories - goalCalories)} description="Diferença simples entre consumo e meta atual." />
              <HighlightCard title="Refeições" value={String(filteredMeals.length)} description="Quantidade de refeições encontradas na data ativa." />
            </div>

            <Card className="border-0 shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CalendarDays className="h-5 w-5 text-primary" />
                  Leitura do dia
                </CardTitle>
                <CardDescription>Um resumo objetivo para responder como o dia está em relação à meta atual.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-2xl border bg-muted/20 p-4">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <p className="text-sm font-medium tracking-tight">Aderência calórica</p>
                    <p className="text-sm text-muted-foreground">{formatNumberPtBr(Math.round(progressPercent(localTotals.calories, goalCalories)))}%</p>
                  </div>
                  <Progress className="h-2" value={progressPercent(localTotals.calories, goalCalories)} />
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <StatusTile label="Proteínas" value={`${formatMacro(localTotals.protein)} g`} />
                  <StatusTile label="Carboidratos" value={`${formatMacro(localTotals.carbs)} g`} />
                  <StatusTile label="Gorduras" value={`${formatMacro(localTotals.fat)} g`} />
                </div>
              </CardContent>
            </Card>

            <Card className="border-0 shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <UtensilsCrossed className="h-5 w-5 text-primary" />
                  Refeições do dia
                </CardTitle>
                <CardDescription>O detalhamento operacional continua acessível dentro do relatório diário.</CardDescription>
              </CardHeader>
              <CardContent>
                <RegisteredMealGroups groups={localDayMealGroups} userTimeZone={userTimeZone} emptyMessage={mealsQuery.isLoading ? "Carregando refeições..." : "Nenhuma refeição encontrada para este dia."} />
              </CardContent>
            </Card>
          </>
        ) : null}

        {periodScope === "week" ? (
          <>
            {reportBundle.isLoading ? (
              <div className="grid gap-4 lg:grid-cols-3">
                <Skeleton className="h-32 rounded-2xl" />
                <Skeleton className="h-32 rounded-2xl" />
                <Skeleton className="h-32 rounded-2xl" />
              </div>
            ) : reportBundle.isError ? (
              <div className="rounded-2xl border bg-muted/20 p-6 text-sm leading-6 text-muted-foreground">
                Não foi possível carregar o resumo semanal agora. Tente novamente em instantes para ver a tendência e o contexto da semana.
              </div>
            ) : null}

            {progress ? (
              <>
                <div className="grid gap-4 lg:grid-cols-4">
                  <HighlightCard title="Média semanal" value={formatCalories(progress.summary.averageCalories)} description="Média diária no período selecionado." />
                  <HighlightCard title="Total da semana" value={formatCalories(progress.summary.totalCalories)} description={`Meta semanal: ${formatCalories(progress.summary.totalGoalCalories)}.`} />
                  <HighlightCard title="Proteína média" value={`${formatMacro(progress.summary.averageProtein)} g`} description="Média diária de proteína registrada." />
                  <HighlightCard title="Calorias líquidas" value={formatCalories(progress.summary.totalNetCalories)} description={`Exercícios registrados: ${formatCalories(progress.summary.totalExerciseCalories)}.`} />
                </div>

                <Card className="border-0 shadow-sm">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <CalendarDays className="h-5 w-5 text-primary" />
                      Dias da semana
                    </CardTitle>
                    <CardDescription>{formatRangeLabel(getWeekRange(selectedDay))}</CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-4 xl:grid-cols-[1.2fr,0.8fr]">
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <StatusTile label="Dentro da meta" value={progress.summary.daysWithinGoal} />
                      <StatusTile label="Acima da meta" value={progress.summary.daysAboveGoal} />
                      <StatusTile label="Abaixo da meta" value={progress.summary.daysBelowGoal} />
                      <StatusTile label="Sem registro" value={progress.summary.daysWithoutRecords} />
                    </div>
                    <Card className="border bg-muted/10 shadow-none">
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                          <Scale className="h-5 w-5 text-primary" />
                          Evolução do peso
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        {progress.weight.hasData ? (
                          <div className="grid gap-3 sm:grid-cols-3">
                            <StatusTile label="Inicial" value={`${formatMacro(progress.weight.firstWeightKg ?? 0)} kg`} />
                            <StatusTile label="Atual" value={`${formatMacro(progress.weight.lastWeightKg ?? 0)} kg`} />
                            <StatusTile label="Variação" value={`${formatMacro(progress.weight.deltaKg ?? 0)} kg`} />
                          </div>
                        ) : (
                          <div className="rounded-2xl border border-dashed bg-background/70 p-5 text-sm leading-6 text-muted-foreground">
                            Ainda não há peso registrado para compor a leitura da semana.
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </CardContent>
                </Card>

                <div className="grid gap-6 xl:grid-cols-[1.2fr,0.8fr]">
                  <Card className="border-0 shadow-sm">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <BarChart3 className="h-5 w-5 text-primary" />
                        Calorias consumidas em relação à meta
                      </CardTitle>
                      <CardDescription>Comparativo diário dentro da semana selecionada.</CardDescription>
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
                          <Bar dataKey="calories" name="Consumido" radius={[8, 8, 0, 0]}>
                            {caloricTrend.map(day => (
                              <Cell key={day.date} fill={day.calories > day.goalCalories ? "#dc2626" : "#10b981"} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>

                  <Card className="border-0 shadow-sm">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Lightbulb className="h-5 w-5 text-primary" />
                        Qualidade e insights
                      </CardTitle>
                      <CardDescription>A semana segue como a visão mais rica de aderência e consistência.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <StatusTile label="Proteína" value={`${formatMacro(weeklyQuality.proteinGrams)} g`} />
                        <StatusTile label="Fibras" value={`${formatMacro(weeklyQuality.fiberGrams)} g`} />
                        <StatusTile label="Água" value={formatCountPtBr(Math.round(weeklyQuality.waterMl), " ml")} />
                        <StatusTile label="Regularidade" value={`${Math.round(weeklyQuality.regularityScore)}%`} />
                      </div>
                      {weeklyInsights?.insights.length ? (
                        <div className="space-y-3">
                          {weeklyInsights.insights.slice(0, 3).map(insight => (
                            <div key={insight.title} className="rounded-2xl border bg-muted/10 p-4">
                              <p className="text-sm font-semibold tracking-tight">{insight.title}</p>
                              <p className="mt-2 text-sm leading-6 text-muted-foreground">{insight.description}</p>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="rounded-2xl border border-dashed bg-muted/10 p-6 text-sm leading-6 text-muted-foreground">
                          Ainda não há dados suficientes para gerar insights automáticos nesta semana.
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>

                <Card className="border-0 shadow-sm">
                  <CardHeader>
                    <CardTitle>Distribuição de macronutrientes</CardTitle>
                    <CardDescription>Evolução agregada de proteínas, carboidratos e gorduras ao longo da semana.</CardDescription>
                  </CardHeader>
                  <CardContent className="h-[320px]">
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

                <Card className="border-0 shadow-sm">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <UtensilsCrossed className="h-5 w-5 text-primary" />
                      Refeições detalhadas
                    </CardTitle>
                    <CardDescription>As refeições continuam acessíveis, agrupadas por dia, para apoiar a leitura analítica semanal.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {mealGroupsByDate.length ? (
                      <div className="space-y-4">
                        {mealGroupsByDate.map(group => (
                          <details key={group.date} className="group rounded-3xl border bg-muted/10 p-4">
                            <summary className="flex cursor-pointer list-none flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                              <div>
                                <p className="text-base font-semibold tracking-tight capitalize">{formatDateHeading(group.date)}</p>
                                <p className="text-sm text-muted-foreground">Toque para abrir as refeições deste dia.</p>
                              </div>
                              <div className="flex items-center gap-3">
                                <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
                              </div>
                            </summary>
                            <div className="pt-4">
                              <RegisteredMealGroups groups={group.groups} userTimeZone={userTimeZone} emptyMessage="Nenhuma refeição encontrada para este dia." />
                            </div>
                          </details>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-dashed bg-muted/10 p-6 text-sm text-muted-foreground">
                        Nenhuma refeição confirmada foi encontrada para detalhamento no relatório.
                      </div>
                    )}
                  </CardContent>
                </Card>
              </>
            ) : null}
          </>
        ) : null}

        {periodScope === "month" || periodScope === "range" ? (
          <>
            <div className="grid gap-4 lg:grid-cols-4">
              <HighlightCard title="Consumo total" value={formatCalories(localTotals.calories)} description="Soma das calorias registradas no intervalo ativo." />
              <HighlightCard title="Média por dia com registros" value={formatCalories(localAverageCalories)} description="Média simples considerando apenas dias com alimentação registrada." />
              <HighlightCard title="Dias acima da meta" value={String(daysAboveGoal)} description="Comparação usando a meta atual como referência visual." />
              <HighlightCard title="Maior dia" value={highestDay ? highestDay.label : "-"} description={highestDay ? formatCalories(highestDay.calories) : "Sem dados suficientes."} />
            </div>

            {periodScope === "month" ? (
              <MonthComparisonCard
                currentCalories={localTotals.calories}
                previousCalories={previousMonthTotals.calories}
                currentMonth={selectedMonth}
                previousMonth={previousMonth}
              />
            ) : null}

            <LocalTrendSection
              title={periodScope === "month" ? "Tendência diária do mês" : "Tendência diária do período"}
              description={periodScope === "month" ? "Cada barra representa um dia do mês ativo." : "O gráfico ajuda a enxergar picos, vazios e consistência ao longo do intervalo escolhido."}
              trendData={localTrendData}
            />

            <Card className="border-0 shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-primary" />
                  Leitura do período
                </CardTitle>
                <CardDescription>Um bloco curto com os principais sinais antes de abrir os dias detalhados.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <StatusTile label="Dias no intervalo" value={longestRangeDays} />
                <StatusTile label="Dias com refeições" value={localDayGroupsAsc.length} />
                <StatusTile label="Refeições registradas" value={filteredMeals.length} />
                <StatusTile label="Meta de referência" value={formatCalories(goalCalories)} />
              </CardContent>
            </Card>

            <Card className="border-0 shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <UtensilsCrossed className="h-5 w-5 text-primary" />
                  Dias detalhados
                </CardTitle>
                <CardDescription>Abra apenas os dias que precisar investigar para manter a navegação leve em períodos mais longos.</CardDescription>
              </CardHeader>
              <CardContent>
                <DailyDetailsSections groups={localDayGroupsDesc} userTimeZone={userTimeZone} />
              </CardContent>
            </Card>
          </>
        ) : null}

        <Link href="/registrar">
          <Button className="rounded-full">
            Registrar refeição
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </Link>
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
