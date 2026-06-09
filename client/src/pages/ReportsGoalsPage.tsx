import React from "react";
import DashboardLayout from "@/components/DashboardLayout";
import PageIntro from "@/components/PageIntro";
import { PeriodScopeSelector } from "@/components/PeriodScopeSelector";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { SummaryPill } from "@/features/meals/components";
import type { StoredMeal } from "@/features/meals/types";
import {
  countDaysInRange,
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
  Activity,
  ArrowRight,
  BarChart3,
  Droplets,
  Dumbbell,
  Leaf,
  Scale,
  Target,
  TrendingUp,
} from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Link } from "wouter";
import {
  calculateCalorieAdherence,
  calculateMacroAdherence,
  type CalorieGoalDay,
  type MacroTotals,
} from "@shared/reportsGoalAnalytics";

type ReportTotals = MacroTotals & {
  calories: number;
};

type TrendPoint = CalorieGoalDay & {
  date: string;
  label: string;
};

const EMPTY_TOTALS: ReportTotals = { calories: 0, protein: 0, carbs: 0, fat: 0 };
const MACRO_COLORS: Record<keyof MacroTotals, string> = {
  protein: "#16a34a",
  carbs: "#0284c7",
  fat: "#d97706",
};

function formatMacro(value: number) {
  return formatNumberPtBr(value, {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 1,
    maximumFractionDigits: 1,
  });
}

function formatPercent(value: number) {
  return `${formatNumberPtBr(value, { maximumFractionDigits: 1 })}%`;
}

function formatChartDateLabel(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

function progressPercent(value: number, goal: number) {
  if (!goal) return 0;
  return Math.min(Math.max((value / goal) * 100, 0), 100);
}

function getCalorieBarColor(calories: number, goalCalories: number) {
  if (!goalCalories || !calories) return "#cbd5e1";
  const ratio = calories / goalCalories;
  if (ratio > 1.05) return "#dc2626";
  if (ratio < 0.9) return "#f59e0b";
  return "#16a34a";
}

function sumMealTotals(meals: StoredMeal[]): ReportTotals {
  return meals.reduce(
    (totals, meal) => ({
      calories: totals.calories + (meal.totals?.calories ?? 0),
      protein: totals.protein + (meal.totals?.protein ?? 0),
      carbs: totals.carbs + (meal.totals?.carbs ?? 0),
      fat: totals.fat + (meal.totals?.fat ?? 0),
    }),
    { ...EMPTY_TOTALS },
  );
}

function buildPeriodTrend(
  mealsByDate: Array<{ date: string; items: StoredMeal[] }>,
  goalCalories: number,
): TrendPoint[] {
  return mealsByDate
    .slice()
    .reverse()
    .map(group => {
      const totals = sumMealTotals(group.items);
      return {
        date: group.date,
        label: formatChartDateLabel(group.date),
        calories: Math.round(totals.calories),
        goalCalories,
      };
    });
}

function buildReportsHeading(scope: PeriodScope) {
  switch (scope) {
    case "day":
      return {
        title: "Relatório diário de metas",
        description: "Compare o consumo do dia com a meta ajustada, macros planejados e hábitos de apoio.",
      };
    case "week":
      return {
        title: "Aderência semanal às metas",
        description: "Veja calorias, macronutrientes, peso, qualidade alimentar, água e exercícios no mesmo contexto.",
      };
    case "month":
      return {
        title: "Acompanhamento mensal de metas",
        description: "Entenda tendência, consistência e sinais de apoio sem abrir detalhe alimento por alimento.",
      };
    case "range":
      return {
        title: "Acompanhamento por período",
        description: "Consolide um intervalo customizado para avaliar evolução contra metas e hábitos registrados.",
      };
  }
}

function MetricCard({ title, value, description }: { title: string; value: string; description: string }) {
  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="p-5">
        <p className="text-sm text-muted-foreground">{title}</p>
        <p className="mt-2 text-3xl font-semibold tracking-tight">{value}</p>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}

function StatusTile({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-2xl border bg-background p-4 shadow-sm">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
      {hint ? <p className="mt-2 text-xs leading-5 text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function SectionHeader({
  icon,
  title,
  description,
  badge,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  badge?: string;
}) {
  return (
    <CardHeader className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <CardTitle className="flex items-center gap-2">{icon}{title}</CardTitle>
        {badge ? <Badge variant="outline" className="rounded-full px-3 py-1 text-xs uppercase">{badge}</Badge> : null}
      </div>
      <CardDescription>{description}</CardDescription>
    </CardHeader>
  );
}

function CalorieAdherenceCard({
  trendData,
  dayCount,
}: {
  trendData: TrendPoint[];
  dayCount: number;
}) {
  const summary = calculateCalorieAdherence(trendData, dayCount);

  return (
    <Card className="border-0 shadow-sm">
      <SectionHeader
        icon={<Target className="h-5 w-5 text-primary" />}
        title="Aderência à meta calórica"
        description="Compara calorias consumidas com a meta ajustada do dia. A faixa ideal considera 90% a 105% da meta."
        badge="Meta ajustada"
      />
      <CardContent className="space-y-5">
        <div className="rounded-3xl border bg-muted/20 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-sm font-medium tracking-tight">Aderência média do período</p>
            <p className="text-sm text-muted-foreground">{formatPercent(summary.adherencePercent)}</p>
          </div>
          <Progress className="h-2" value={Math.min(summary.adherencePercent, 100)} />
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <StatusTile label="Média consumida" value={formatCalories(summary.averageCalories)} />
          <StatusTile label="Média da meta" value={formatCalories(summary.averageGoalCalories)} />
          <StatusTile label="Desvio médio" value={formatCalories(summary.averageDeltaCalories)} />
          <StatusTile label="Dias na faixa" value={`${summary.daysWithinRange}/${dayCount}`} />
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <StatusTile label="Abaixo da faixa" value={summary.daysBelowRange} />
          <StatusTile label="Acima da faixa" value={summary.daysAboveRange} />
          <StatusTile label="Sem registros" value={summary.daysWithoutRecords} />
        </div>
      </CardContent>
    </Card>
  );
}

function CalorieTrendChart({ trendData }: { trendData: TrendPoint[] }) {
  if (!trendData.length) {
    return (
      <Card className="border-0 shadow-sm">
        <CardContent className="p-6 text-sm text-muted-foreground">Ainda não há registros suficientes para desenhar o gráfico de aderência calórica.</CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-0 shadow-sm">
      <SectionHeader
        icon={<BarChart3 className="h-5 w-5 text-primary" />}
        title="Consumido vs meta ajustada"
        description="Cada barra compara o total consumido com a meta ajustada daquele dia."
      />
      <CardContent className="h-[340px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={trendData} barSize={28}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Bar dataKey="goalCalories" name="Meta ajustada" fill="#cbd5e1" radius={[8, 8, 0, 0]} />
            <Bar dataKey="calories" name="Consumido" radius={[8, 8, 0, 0]}>
              {trendData.map(day => (
                <Cell key={day.date} fill={getCalorieBarColor(day.calories, day.goalCalories)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

function MacroAdherenceCard({ consumed, planned }: { consumed: MacroTotals; planned: MacroTotals }) {
  const analysis = calculateMacroAdherence(consumed, planned);
  const hasMacroGoal = planned.protein > 0 || planned.carbs > 0 || planned.fat > 0;

  return (
    <Card className="border-0 shadow-sm">
      <SectionHeader
        icon={<Activity className="h-5 w-5 text-primary" />}
        title="Macronutrientes planejados vs realizados"
        description="Compara gramas e distribuição percentual para mostrar se a composição acompanha a meta, não só as calorias."
        badge={hasMacroGoal ? `${formatPercent(analysis.distributionAdherencePercent)} aderência` : "Sem meta"}
      />
      <CardContent className="space-y-4">
        {!hasMacroGoal ? (
          <div className="rounded-2xl border border-dashed bg-muted/10 p-5 text-sm leading-6 text-muted-foreground">
            Configure metas de proteínas, carboidratos e gorduras para liberar a comparação completa de macros.
          </div>
        ) : (
          <>
            <div className="grid gap-3 md:grid-cols-3">
              {analysis.items.map(item => (
                <div key={item.key} className="rounded-2xl border bg-background p-4 shadow-sm">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <p className="text-sm font-medium">{item.label}</p>
                    <span className="h-3 w-3 rounded-full" style={{ backgroundColor: MACRO_COLORS[item.key] }} />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-1 xl:grid-cols-2">
                    <StatusTile label="Planejado" value={`${formatMacro(item.plannedGrams)} g`} hint={`${formatPercent(item.plannedPercent)} das kcal`} />
                    <StatusTile label="Realizado" value={`${formatMacro(item.consumedGrams)} g`} hint={`${formatPercent(item.consumedPercent)} das kcal`} />
                  </div>
                  <p className="mt-3 text-sm text-muted-foreground">
                    Desvio: {item.percentPointDelta > 0 ? "+" : ""}{formatPercent(item.percentPointDelta)} e {item.gramDelta > 0 ? "+" : ""}{formatMacro(item.gramDelta)} g.
                  </p>
                </div>
              ))}
            </div>
            <div className="rounded-2xl border bg-muted/10 p-4 text-sm leading-6 text-muted-foreground">
              Macro mais distante da meta: <strong className="text-foreground">{analysis.mostDistantMacro?.label ?? "-"}</strong>.
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function QualityCard({
  proteinGrams,
  fiberGrams,
  fruitServings,
  vegetableServings,
  ultraProcessedServings,
  regularityScore,
}: {
  proteinGrams?: number;
  fiberGrams?: number;
  fruitServings?: number;
  vegetableServings?: number;
  ultraProcessedServings?: number;
  regularityScore?: number;
}) {
  const hasQuality = [proteinGrams, fiberGrams, fruitServings, vegetableServings, ultraProcessedServings].some(value => Number(value ?? 0) > 0);

  return (
    <Card className="border-0 shadow-sm">
      <SectionHeader
        icon={<Leaf className="h-5 w-5 text-primary" />}
        title="Qualidade alimentar agregada"
        description="Mostra sinais de qualidade sem detalhar alimento por alimento. Alimentos sem classificação não entram nos indicadores específicos."
        badge="Agregado"
      />
      <CardContent className="space-y-4">
        {hasQuality ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <StatusTile label="Proteína" value={`${formatMacro(proteinGrams ?? 0)} g`} />
            <StatusTile label="Fibras" value={`${formatMacro(fiberGrams ?? 0)} g`} />
            <StatusTile label="Frutas" value={formatMacro(fruitServings ?? 0)} />
            <StatusTile label="Legumes/verduras" value={formatMacro(vegetableServings ?? 0)} />
            <StatusTile label="Ultraprocessados" value={formatMacro(ultraProcessedServings ?? 0)} />
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed bg-muted/10 p-5 text-sm leading-6 text-muted-foreground">
            Ainda não há classificação alimentar suficiente para gerar indicadores de qualidade neste período.
          </div>
        )}
        <div className="rounded-2xl border bg-background p-4">
          <p className="text-sm text-muted-foreground">Regularidade das refeições</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight">{formatPercent(regularityScore ?? 0)}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function WeightCard({ weight }: { weight?: { hasData: boolean; firstWeightKg?: number | null; lastWeightKg?: number | null; deltaKg?: number | null } }) {
  return (
    <Card className="border-0 shadow-sm">
      <SectionHeader
        icon={<Scale className="h-5 w-5 text-primary" />}
        title="Evolução do peso"
        description="A leitura de peso entra como apoio à aderência calórica. Com poucos registros, evite concluir tendência."
      />
      <CardContent>
        {weight?.hasData ? (
          <div className="grid gap-3 md:grid-cols-3">
            <StatusTile label="Peso inicial" value={`${formatMacro(weight.firstWeightKg ?? 0)} kg`} />
            <StatusTile label="Último peso" value={`${formatMacro(weight.lastWeightKg ?? 0)} kg`} />
            <StatusTile label="Variação" value={`${formatMacro(weight.deltaKg ?? 0)} kg`} />
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed bg-muted/10 p-5 text-sm leading-6 text-muted-foreground">
            Ainda não há registros de peso suficientes para relacionar evolução corporal e aderência calórica.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SupportHabitsCard({
  waterConsumedMl,
  waterGoalMl,
  waterHitDays,
  exerciseActiveDays,
  exerciseCalories,
  dayCount,
}: {
  waterConsumedMl: number;
  waterGoalMl: number;
  waterHitDays: number;
  exerciseActiveDays: number;
  exerciseCalories: number;
  dayCount: number;
}) {
  return (
    <Card className="border-0 shadow-sm">
      <SectionHeader
        icon={<TrendingUp className="h-5 w-5 text-primary" />}
        title="Água e exercícios como apoio"
        description="Hábitos de suporte aparecem junto da meta para mostrar contexto, não como métricas soltas."
      />
      <CardContent className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border bg-background p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="flex items-center gap-2 text-sm font-medium"><Droplets className="h-4 w-4 text-primary" /> Água vs meta</p>
            <span className="text-sm text-muted-foreground">{formatPercent(progressPercent(waterConsumedMl, waterGoalMl))}</span>
          </div>
          <Progress className="h-2" value={progressPercent(waterConsumedMl, waterGoalMl)} />
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <StatusTile label="Consumido" value={formatCountPtBr(Math.round(waterConsumedMl), " ml")} />
            <StatusTile label="Meta batida" value={`${waterHitDays}/${dayCount} dias`} />
          </div>
        </div>
        <div className="rounded-2xl border bg-background p-4 shadow-sm">
          <p className="mb-4 flex items-center gap-2 text-sm font-medium"><Dumbbell className="h-4 w-4 text-primary" /> Frequência de exercícios</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <StatusTile label="Dias ativos" value={`${exerciseActiveDays}/${dayCount}`} />
            <StatusTile label="Gasto estimado" value={formatCalories(exerciseCalories)} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function ReportsGoalsPage() {
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
  const reportBundle = trpc.nutrition.reports.bundle.useQuery({ weekOffset }, { enabled: periodScope === "week" });
  const periodBundle = trpc.nutrition.reports.periodBundle.useQuery(
    { startDate: activeRange.start, endDate: activeRange.end },
    { enabled: periodScope !== "week" },
  );

  const dayCount = periodScope === "week" ? 7 : countDaysInRange(activeRange);
  const weeklyDays = reportBundle.data?.weekly ?? [];
  const periodMealsByDate = (periodBundle.data?.mealsByDate ?? []) as Array<{ date: string; items: StoredMeal[] }>;
  const periodTotals = periodBundle.data?.totals ?? EMPTY_TOTALS;
  const periodGoal = periodBundle.data?.goal ?? EMPTY_TOTALS;

  const trendData = periodScope === "week"
    ? weeklyDays.map(day => ({ date: day.date, label: day.label, calories: day.calories, goalCalories: day.goalCalories }))
    : buildPeriodTrend(periodMealsByDate, periodGoal.calories);

  const consumedMacros: MacroTotals = periodScope === "week"
    ? {
        protein: weeklyDays.reduce((total, day) => total + day.protein, 0),
        carbs: weeklyDays.reduce((total, day) => total + day.carbs, 0),
        fat: weeklyDays.reduce((total, day) => total + day.fat, 0),
      }
    : {
        protein: periodTotals.protein,
        carbs: periodTotals.carbs,
        fat: periodTotals.fat,
      };

  const plannedMacros: MacroTotals = periodScope === "week"
    ? {
        protein: weeklyDays.reduce((total, day) => total + day.goalProtein, 0),
        carbs: weeklyDays.reduce((total, day) => total + day.goalCarbs, 0),
        fat: weeklyDays.reduce((total, day) => total + day.goalFat, 0),
      }
    : {
        protein: periodGoal.protein * dayCount,
        carbs: periodGoal.carbs * dayCount,
        fat: periodGoal.fat * dayCount,
      };

  const totalCalories = periodScope === "week"
    ? weeklyDays.reduce((total, day) => total + day.calories, 0)
    : periodTotals.calories;
  const totalGoalCalories = periodScope === "week"
    ? weeklyDays.reduce((total, day) => total + day.goalCalories, 0)
    : periodGoal.calories * dayCount;
  const adjustedGoalLabel = periodScope === "week" ? "metas ajustadas por dia" : "meta atual multiplicada pelo período";
  const reportsHeading = buildReportsHeading(periodScope);

  const waterConsumedMl = periodScope === "week"
    ? weeklyDays.reduce((total, day) => total + (day.waterConsumedMl ?? 0), 0)
    : periodBundle.data?.habitAnalytics.water.totalConsumedMl ?? 0;
  const waterGoalMl = periodScope === "week"
    ? weeklyDays.reduce((total, day) => total + (day.waterGoalMl ?? 0), 0)
    : periodBundle.data?.habitAnalytics.water.totalGoalMl ?? 0;
  const waterHitDays = periodScope === "week"
    ? weeklyDays.filter(day => (day.waterGoalMl ?? 0) > 0 && (day.waterConsumedMl ?? 0) >= (day.waterGoalMl ?? 0)).length
    : periodBundle.data?.habitAnalytics.water.goalHitDays ?? 0;
  const exerciseActiveDays = periodScope === "week"
    ? weeklyDays.filter(day => (day.exerciseCalories ?? 0) > 0).length
    : periodBundle.data?.habitAnalytics.exercise.activeDays ?? 0;
  const exerciseCalories = periodScope === "week"
    ? weeklyDays.reduce((total, day) => total + (day.exerciseCalories ?? 0), 0)
    : periodBundle.data?.habitAnalytics.exercise.totalCalories ?? 0;

  const weeklyQuality = reportBundle.data?.quality;
  const isLoading = periodScope === "week" ? reportBundle.isLoading : periodBundle.isLoading;
  const isError = periodScope === "week" ? reportBundle.isError : periodBundle.isError;

  const introStats = (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <SummaryPill label="Consumido" value={formatCalories(totalCalories)} />
      <SummaryPill label="Meta" value={formatCalories(totalGoalCalories)} />
      <SummaryPill label="Aderência" value={formatPercent(calculateCalorieAdherence(trendData, dayCount).adherencePercent)} />
      <SummaryPill label="Dias analisados" value={String(dayCount)} />
      <SummaryPill label="Macros" value={`${formatMacro(consumedMacros.protein)} g prot.`} />
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

        {isLoading ? (
          <div className="grid gap-4 lg:grid-cols-4">
            <Skeleton className="h-32 rounded-2xl" />
            <Skeleton className="h-32 rounded-2xl" />
            <Skeleton className="h-32 rounded-2xl" />
            <Skeleton className="h-32 rounded-2xl" />
          </div>
        ) : null}

        {isError ? (
          <div className="rounded-2xl border bg-muted/20 p-6 text-sm leading-6 text-muted-foreground">
            Não foi possível carregar os relatórios agora. Tente novamente em instantes.
          </div>
        ) : null}

        {!isLoading && !isError ? (
          <>
            <div className="grid gap-4 lg:grid-cols-4">
              <MetricCard title="Consumo total" value={formatCalories(totalCalories)} description="Soma das refeições registradas no período ativo." />
              <MetricCard title="Meta do período" value={formatCalories(totalGoalCalories)} description={`Referência baseada em ${adjustedGoalLabel}.`} />
              <MetricCard title="Desvio total" value={formatCalories(totalCalories - totalGoalCalories)} description="Diferença entre consumido e meta no intervalo." />
              <MetricCard title="Exercícios" value={formatCalories(exerciseCalories)} description="Gasto estimado usado como contexto da meta ajustada." />
            </div>

            <CalorieAdherenceCard trendData={trendData} dayCount={dayCount} />
            <CalorieTrendChart trendData={trendData} />
            <MacroAdherenceCard consumed={consumedMacros} planned={plannedMacros} />

            <div className="grid gap-6 xl:grid-cols-[1fr,0.85fr]">
              <QualityCard
                proteinGrams={weeklyQuality?.proteinGrams ?? consumedMacros.protein}
                fiberGrams={weeklyQuality?.fiberGrams}
                fruitServings={weeklyQuality?.fruitServings}
                vegetableServings={weeklyQuality?.vegetableServings}
                ultraProcessedServings={weeklyQuality?.ultraProcessedServings}
                regularityScore={weeklyQuality?.regularityScore}
              />
              <WeightCard weight={reportBundle.data?.progress.weight} />
            </div>

            <SupportHabitsCard
              waterConsumedMl={waterConsumedMl}
              waterGoalMl={waterGoalMl}
              waterHitDays={waterHitDays}
              exerciseActiveDays={exerciseActiveDays}
              exerciseCalories={exerciseCalories}
              dayCount={dayCount}
            />

            <Card className="border-0 shadow-sm">
              <SectionHeader
                icon={<TrendingUp className="h-5 w-5 text-primary" />}
                title="Leitura e próximos passos"
                description="O relatório prioriza sinais agregados. Para auditar refeições específicas, use a tela de refeições registradas."
              />
              <CardContent className="flex flex-wrap gap-3">
                <Link href="/meals">
                  <Button variant="outline" className="rounded-full">
                    Abrir refeições registradas
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </Link>
                <Link href="/registrar">
                  <Button className="rounded-full">
                    Registrar refeição
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </Link>
              </CardContent>
            </Card>
          </>
        ) : null}
      </div>
    </DashboardLayout>
  );
}
