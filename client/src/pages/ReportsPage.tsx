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
  Droplets,
  Dumbbell,
  Lightbulb,
  Scale,
  TrendingUp,
  UtensilsCrossed,
} from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Link } from "wouter";

type MealDateGroup = {
  date: string;
  items: StoredMeal[];
};

type ReportTotals = {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
};

type TrendPoint = ReportTotals & {
  date: string;
  label: string;
  mealCount: number;
  goalCalories: number;
};

type MacroKey = "protein" | "carbs" | "fat";

type DailyMacroSource = {
  date: string;
  label: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  goalCalories: number;
  adjustedGoalCalories?: number;
  goalProtein?: number;
  goalCarbs?: number;
  goalFat?: number;
};

type WeightPoint = {
  date: string;
  weightKg: number | null;
};

type MacroMetric = {
  key: "calories" | MacroKey;
  title: string;
  unit: "kcal" | "g";
  planned: number;
  realized: number;
  percent: number;
  difference: number;
  plannedPerKgDay: number | null;
  realizedPerKgDay: number | null;
  weightDays: number;
};

const EMPTY_TOTALS: ReportTotals = { calories: 0, protein: 0, carbs: 0, fat: 0 };
const MACRO_META: Array<{ key: MacroKey; title: string; goalKey: "goalProtein" | "goalCarbs" | "goalFat" }> = [
  { key: "protein", title: "Proteínas", goalKey: "goalProtein" },
  { key: "carbs", title: "Carboidratos", goalKey: "goalCarbs" },
  { key: "fat", title: "Gorduras", goalKey: "goalFat" },
];

function formatMacro(value: number) {
  return formatNumberPtBr(value, {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 1,
    maximumFractionDigits: 1,
  });
}

function formatPercent(value: number) {
  return `${formatNumberPtBr(Math.round(value))}%`;
}

function formatMacroGrams(value: number) {
  return `${formatMacro(value)} g`;
}

function formatSigned(value: number, unit: "kcal" | "g") {
  const prefix = value > 0 ? "+" : "";
  return unit === "kcal" ? `${prefix}${formatCalories(value)}` : `${prefix}${formatMacro(value)} g`;
}

function formatPerKgDay(value: number | null) {
  if (value === null) return null;
  return `${formatNumberPtBr(value, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} g/kg/dia`;
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

function formatChartDateLabel(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

function getCalorieBarColor(calories: number, goalCalories: number) {
  return goalCalories > 0 && calories > goalCalories ? "#dc2626" : "#10b981";
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

function buildWeeklyDayGroups(mealsByDate: MealDateGroup[]): DateGroupedRegisteredMealsViewModel[] {
  return mealsByDate.slice().reverse().map(group => {
    const meals = group.items;

    return {
      date: group.date,
      meals,
      mealCount: meals.length,
      itemCount: meals.reduce((total, meal) => total + (meal.items?.length ?? 0), 0),
      totals: sumMealTotals(meals),
      groups: buildRegisteredMealGroups(meals),
    };
  });
}

function getPreviousMonthValue(monthValue: string) {
  const [year, month] = monthValue.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, 1));
  date.setUTCMonth(date.getUTCMonth() - 1);
  return date.toISOString().slice(0, 7);
}

function findExtreme<T>(items: T[], getValue: (item: T) => number, direction: "min" | "max") {
  return items.reduce<T | null>((current, item) => {
    if (!current) return item;
    const nextValue = getValue(item);
    const currentValue = getValue(current);
    return direction === "max" ? (nextValue > currentValue ? item : current) : (nextValue < currentValue ? item : current);
  }, null);
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
        description: "A semana continua sendo a leitura mais completa de consistência, saldo energético, hidratação e atividade física.",
      };
    case "month":
      return {
        title: "Tendência mensal",
        description: "O mês agora também ajuda a enxergar aderência de água, frequência de exercícios e concentração dos registros ao longo dos dias.",
      };
    case "range":
      return {
        title: "Resumo analítico por período",
        description: "Use um intervalo configurável para consolidar refeições, hidratação e atividade física com uma leitura mais comparativa.",
      };
  }
}

function toTrendData(groups: DateGroupedRegisteredMealsViewModel[], goalCalories: number): TrendPoint[] {
  return groups.map(group => ({
    date: group.date,
    label: formatChartDateLabel(group.date),
    calories: Math.round(group.totals.calories),
    protein: Math.round(group.totals.protein),
    carbs: Math.round(group.totals.carbs),
    fat: Math.round(group.totals.fat),
    mealCount: group.mealCount,
    goalCalories,
  }));
}

function toMacroTrend(days: Array<{ label: string; protein: number; carbs: number; fat: number }>) {
  return days.map(day => ({
    label: day.label,
    protein: Math.round(day.protein),
    carbs: Math.round(day.carbs),
    fat: Math.round(day.fat),
  }));
}

function averageValue(total: number, count: number) {
  if (!count) return 0;
  return total / count;
}

function resolveWeightForDate(date: string, weights: WeightPoint[]) {
  const usableWeights = weights
    .filter(weight => weight.date && Number(weight.weightKg) > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  const exact = usableWeights.find(weight => weight.date === date);
  if (exact) return Number(exact.weightKg);

  const previous = usableWeights.filter(weight => weight.date < date).at(-1);
  return previous ? Number(previous.weightKg) : null;
}

function calculateMacroMetrics(days: DailyMacroSource[], weights: WeightPoint[]): MacroMetric[] {
  const normalizedDays = days.filter(day => day.date);
  const caloriesPlanned = normalizedDays.reduce((total, day) => total + (day.adjustedGoalCalories ?? day.goalCalories ?? 0), 0);
  const caloriesRealized = normalizedDays.reduce((total, day) => total + (day.calories ?? 0), 0);

  const metrics: MacroMetric[] = [
    {
      key: "calories",
      title: "Calorias",
      unit: "kcal",
      planned: caloriesPlanned,
      realized: caloriesRealized,
      percent: progressPercent(caloriesRealized, caloriesPlanned),
      difference: caloriesRealized - caloriesPlanned,
      plannedPerKgDay: null,
      realizedPerKgDay: null,
      weightDays: 0,
    },
  ];

  MACRO_META.forEach(macro => {
    const planned = normalizedDays.reduce((total, day) => total + Number(day[macro.goalKey] ?? 0), 0);
    const realized = normalizedDays.reduce((total, day) => total + Number(day[macro.key] ?? 0), 0);
    const perKg = normalizedDays.reduce(
      (acc, day) => {
        const weightKg = resolveWeightForDate(day.date, weights);
        if (!weightKg) return acc;
        acc.planned += Number(day[macro.goalKey] ?? 0) / weightKg;
        acc.realized += Number(day[macro.key] ?? 0) / weightKg;
        acc.days += 1;
        return acc;
      },
      { planned: 0, realized: 0, days: 0 },
    );

    metrics.push({
      key: macro.key,
      title: macro.title,
      unit: "g",
      planned,
      realized,
      percent: progressPercent(realized, planned),
      difference: realized - planned,
      plannedPerKgDay: perKg.days ? perKg.planned / perKg.days : null,
      realizedPerKgDay: perKg.days ? perKg.realized / perKg.days : null,
      weightDays: perKg.days,
    });
  });

  return metrics;
}

function normalizeWeeklyDays(days: any[]): DailyMacroSource[] {
  return days.map(day => ({
    date: day.date,
    label: day.label,
    calories: Number(day.calories ?? 0),
    protein: Number(day.protein ?? 0),
    carbs: Number(day.carbs ?? 0),
    fat: Number(day.fat ?? 0),
    goalCalories: Number(day.goalCalories ?? 0),
    adjustedGoalCalories: Number(day.adjustedGoalCalories ?? day.goalCalories ?? 0),
    goalProtein: Number(day.goalProtein ?? 0),
    goalCarbs: Number(day.goalCarbs ?? 0),
    goalFat: Number(day.goalFat ?? 0),
  }));
}

function normalizePeriodDays(days: any[], fallbackGoal: any): DailyMacroSource[] {
  return days.map(day => ({
    date: day.date,
    label: day.label,
    calories: Number(day.calories ?? 0),
    protein: Number(day.protein ?? 0),
    carbs: Number(day.carbs ?? 0),
    fat: Number(day.fat ?? 0),
    goalCalories: Number(day.goalCalories ?? fallbackGoal?.calories ?? 0),
    adjustedGoalCalories: Number(day.adjustedGoalCalories ?? day.goalCalories ?? fallbackGoal?.calories ?? 0),
    goalProtein: Number(day.goalProtein ?? fallbackGoal?.protein ?? 0),
    goalCarbs: Number(day.goalCarbs ?? fallbackGoal?.carbs ?? 0),
    goalFat: Number(day.goalFat ?? fallbackGoal?.fat ?? 0),
  }));
}

function normalizeWeightPoints(value: any): WeightPoint[] {
  return (value?.entries ?? value?.points ?? [])
    .map((entry: any) => ({ date: entry.date, weightKg: Number(entry.weightKg ?? 0) || null }))
    .filter((entry: WeightPoint) => entry.date);
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

function MacroMetricCard({ metric, showPerKg = false }: { metric: MacroMetric; showPerKg?: boolean }) {
  const plannedValue = metric.unit === "kcal" ? formatCalories(metric.planned) : formatMacroGrams(metric.planned);
  const realizedValue = metric.unit === "kcal" ? formatCalories(metric.realized) : formatMacroGrams(metric.realized);
  const plannedPerKg = formatPerKgDay(metric.plannedPerKgDay);
  const realizedPerKg = formatPerKgDay(metric.realizedPerKgDay);

  return (
    <Card className="border bg-muted/10 shadow-none">
      <CardHeader className="space-y-2">
        <CardTitle className="text-base">{metric.title}</CardTitle>
        <CardDescription>{formatPercent(metric.percent)} realizado vs planejado</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Progress className="h-2" value={metric.percent} />
        <div className="grid gap-3 sm:grid-cols-3">
          <CompactMetric label="Planejado" value={plannedValue} />
          <CompactMetric label="Realizado" value={realizedValue} />
          <CompactMetric label="Diferença" value={formatSigned(metric.difference, metric.unit)} />
        </div>
        {showPerKg && metric.unit === "g" ? (
          plannedPerKg && realizedPerKg ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <CompactMetric label="Planejado" value={plannedPerKg} />
              <CompactMetric label="Realizado" value={realizedPerKg} />
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed bg-background/70 p-4 text-sm leading-6 text-muted-foreground">
              Informe um peso para calcular g/kg/dia deste período.
            </div>
          )
        ) : null}
      </CardContent>
    </Card>
  );
}

function MacroAdherenceSection({ title, description, metrics }: { title: string; description: string; metrics: MacroMetric[] }) {
  return (
    <Card className="border-0 shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarDays className="h-5 w-5 text-primary" />
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
        {metrics.map(metric => <MacroMetricCard key={metric.key} metric={metric} />)}
      </CardContent>
    </Card>
  );
}

function PlannedVsRealizedMacrosSection({ metrics }: { metrics: MacroMetric[] }) {
  const macroMetrics = metrics.filter(metric => metric.unit === "g");
  return (
    <Card className="border-0 shadow-sm">
      <CardHeader>
        <CardTitle>Macronutrientes planejados vs realizados</CardTitle>
        <CardDescription>
          Totais do período e média ponderada por peso de referência em g/kg/dia.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 xl:grid-cols-3">
        {macroMetrics.map(metric => <MacroMetricCard key={metric.key} metric={metric} showPerKg />)}
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
  trendData: TrendPoint[];
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
                  <Cell key={day.date} fill={getCalorieBarColor(day.calories, day.goalCalories)} />
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

function DailyDetailsSections({ groups, userTimeZone }: { groups: DateGroupedRegisteredMealsViewModel[]; userTimeZone: string }) {
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

function AnalyticsHeader({ icon, title, scopeLabel, description }: { icon: React.ReactNode; title: string; scopeLabel: string; description: string }) {
  return (
    <CardHeader className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <CardTitle className="flex items-center gap-2">
          {icon}
          {title}
        </CardTitle>
        <Badge variant="outline" className="rounded-full px-3 py-1 text-xs uppercase tracking-wide">
          {scopeLabel}
        </Badge>
      </div>
      <CardDescription>{description}</CardDescription>
    </CardHeader>
  );
}

function AnalyticsReading({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border bg-background px-4 py-3 text-sm leading-6 text-muted-foreground">{children}</div>;
}

function WaterAnalyticsCard({
  title,
  scopeLabel,
  description,
  totalConsumedMl,
  totalGoalMl,
  goalHitDays,
  totalDays,
  averageDailyMl,
  lowestDay,
  reading,
}: {
  title: string;
  scopeLabel: string;
  description: string;
  totalConsumedMl: number;
  totalGoalMl: number;
  goalHitDays: number;
  totalDays: number;
  averageDailyMl: number;
  lowestDay: string;
  reading: string;
}) {
  return (
    <Card className="border-0 shadow-sm">
      <AnalyticsHeader icon={<Droplets className="h-5 w-5 text-primary" />} title={title} scopeLabel={scopeLabel} description={description} />
      <CardContent className="space-y-4">
        <div className="rounded-3xl border bg-muted/20 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-sm font-medium tracking-tight">Aderência à meta de água</p>
            <p className="text-sm text-muted-foreground">{formatPercent(progressPercent(totalConsumedMl, totalGoalMl))}</p>
          </div>
          <Progress className="h-2" value={progressPercent(totalConsumedMl, totalGoalMl)} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <CompactMetric label="Meta do período" value={formatCountPtBr(Math.round(totalGoalMl), " ml")} />
          <CompactMetric label="Consumo acumulado" value={formatCountPtBr(Math.round(totalConsumedMl), " ml")} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <StatusTile label="Meta batida" value={`${goalHitDays}/${totalDays} dias`} />
          <StatusTile label="Média diária" value={formatCountPtBr(Math.round(averageDailyMl), " ml")} />
          <StatusTile label="Total consumido" value={formatCountPtBr(Math.round(totalConsumedMl), " ml")} />
          <StatusTile label="Menor dia" value={lowestDay} />
        </div>
        <AnalyticsReading>{reading}</AnalyticsReading>
      </CardContent>
    </Card>
  );
}

function ExerciseAnalyticsCard({
  title,
  scopeLabel,
  description,
  activeDays,
  totalDays,
  totalCalories,
  detailLabel,
  detailValue,
  averageCaloriesPerActiveDay,
  highestDay,
  reading,
}: {
  title: string;
  scopeLabel: string;
  description: string;
  activeDays: number;
  totalDays: number;
  totalCalories: number;
  detailLabel: string;
  detailValue: string;
  averageCaloriesPerActiveDay: number;
  highestDay: string;
  reading: string;
}) {
  return (
    <Card className="border-0 shadow-sm">
      <AnalyticsHeader icon={<Dumbbell className="h-5 w-5 text-primary" />} title={title} scopeLabel={scopeLabel} description={description} />
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <CompactMetric label="Dias ativos" value={`${activeDays}/${totalDays}`} />
          <CompactMetric label="Gasto total" value={formatCalories(totalCalories)} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <StatusTile label={detailLabel} value={detailValue} />
          <StatusTile label="Média por dia ativo" value={activeDays ? formatCalories(averageCaloriesPerActiveDay) : "0 kcal"} />
          <StatusTile label="Maior dia" value={highestDay} />
        </div>
        <AnalyticsReading>{reading}</AnalyticsReading>
      </CardContent>
    </Card>
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
  const reportBundle = trpc.nutrition.reports.bundle.useQuery({ weekOffset }, { enabled: periodScope === "week" });
  const periodBundle = trpc.nutrition.reports.periodBundle.useQuery(
    { startDate: activeRange.start, endDate: activeRange.end },
    { enabled: periodScope !== "week" },
  );
  const previousMonth = React.useMemo(() => getPreviousMonthValue(selectedMonth), [selectedMonth]);
  const previousMonthRange = React.useMemo(() => getMonthRange(previousMonth), [previousMonth]);
  const previousMonthBundle = trpc.nutrition.reports.periodBundle.useQuery(
    { startDate: previousMonthRange.start, endDate: previousMonthRange.end },
    { enabled: periodScope === "month" },
  );

  const periodMeals = React.useMemo(
    () => (periodBundle.data?.mealsByDate ?? []).flatMap((group: any) => group.items as StoredMeal[]),
    [periodBundle.data?.mealsByDate],
  );
  const goalCalories = periodScope === "week"
    ? reportBundle.data?.weekly?.[0]?.goalCalories ?? 0
    : periodBundle.data?.goal.calories ?? 0;
  const localTotals = periodScope === "week"
    ? {
        calories: reportBundle.data?.progress.summary.totalCalories ?? 0,
        protein: reportBundle.data?.weekly.reduce((total: number, day: any) => total + day.protein, 0) ?? 0,
        carbs: reportBundle.data?.weekly.reduce((total: number, day: any) => total + day.carbs, 0) ?? 0,
        fat: reportBundle.data?.weekly.reduce((total: number, day: any) => total + day.fat, 0) ?? 0,
      }
    : periodBundle.data?.totals ?? EMPTY_TOTALS;
  const localDayGroupsAsc = React.useMemo(
    () => periodScope === "week"
      ? buildWeeklyDayGroups((reportBundle.data?.mealsByDate ?? []) as MealDateGroup[])
      : buildDateGroupedMealGroups(periodMeals, { timeZone: userTimeZone, sortDirection: "asc" }),
    [periodMeals, periodScope, reportBundle.data?.mealsByDate, userTimeZone],
  );
  const localDayGroupsDesc = React.useMemo(() => [...localDayGroupsAsc].reverse(), [localDayGroupsAsc]);
  const localTrendData = React.useMemo(() => toTrendData(localDayGroupsAsc, goalCalories), [goalCalories, localDayGroupsAsc]);
  const localDayMealGroups = React.useMemo(() => buildRegisteredMealGroups(periodMeals), [periodMeals]);
  const previousMonthTotals = previousMonthBundle.data?.totals ?? EMPTY_TOTALS;

  const localAverageCalories = averageValue(localTotals.calories, Math.max(localDayGroupsAsc.length, 1));
  const longestRangeDays = countDaysInRange(activeRange);
  const highestDay = findExtreme(localTrendData, day => day.calories, "max");
  const daysAboveGoal = localTrendData.filter(day => goalCalories && day.calories > day.goalCalories).length;
  const reportsHeading = buildReportsHeading(periodScope);
  const periodScopeLabel = periodScope === "month" ? "Mensal" : "Período";

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
  const macroTrend = toMacroTrend(caloricTrend);
  const mealGroupsByDate = React.useMemo(
    () => detailedMealsByDate.map((group: any) => ({
      date: group.date,
      groups: buildRegisteredMealGroups(group.items as StoredMeal[]),
    })),
    [detailedMealsByDate],
  );

  const weeklyWeightPoints = normalizeWeightPoints(progress?.weight);
  const periodWeightPoints = normalizeWeightPoints(periodBundle.data?.weightTrend);
  const metricDays = periodScope === "week"
    ? normalizeWeeklyDays(caloricTrend)
    : normalizePeriodDays(periodBundle.data?.daily ?? [], periodBundle.data?.goal);
  const macroMetrics = calculateMacroMetrics(metricDays, periodScope === "week" ? weeklyWeightPoints : periodWeightPoints);

  const weeklyWaterTotal = caloricTrend.reduce((total: number, day: any) => total + (day.waterConsumedMl ?? 0), 0);
  const weeklyWaterGoalTotal = caloricTrend.reduce((total: number, day: any) => total + (day.waterGoalMl ?? 0), 0);
  const weeklyWaterGoalHitDays = caloricTrend.filter((day: any) => (day.waterGoalMl ?? 0) > 0 && (day.waterConsumedMl ?? 0) >= (day.waterGoalMl ?? 0)).length;
  const weeklyAverageWater = averageValue(weeklyWaterTotal, caloricTrend.length);
  const lowestWaterDay = findExtreme(caloricTrend, (day: any) => day.waterConsumedMl ?? 0, "min");

  const weeklyExerciseActiveDays = caloricTrend.filter((day: any) => (day.exerciseCalories ?? 0) > 0).length;
  const weeklyAverageExercisePerActiveDay = weeklyExerciseActiveDays ? averageValue(progress?.summary.totalExerciseCalories ?? 0, weeklyExerciseActiveDays) : 0;
  const highestExerciseDay = findExtreme(caloricTrend, (day: any) => day.exerciseCalories ?? 0, "max");

  const hydrationReading = !caloricTrend.length
    ? "Ainda não há dados suficientes para interpretar a hidratação da semana."
    : weeklyWaterGoalHitDays > 0
      ? `${weeklyWaterGoalHitDays} de ${caloricTrend.length} dias bateram a meta de água, o que já permite enxergar consistência semanal.`
      : "Nenhum dia bateu a meta de água nesta semana, então vale olhar distribuição e horários dos registros.";

  const exerciseReading = !caloricTrend.length
    ? "Ainda não há dados suficientes para interpretar a atividade física da semana."
    : weeklyExerciseActiveDays > 1
      ? `Os exercícios ficaram distribuídos em ${weeklyExerciseActiveDays} dias da semana, o que reduz a sensação de esforço concentrado em um único dia.`
      : weeklyExerciseActiveDays === 1
        ? "Toda a atividade física registrada ficou concentrada em um único dia da semana."
        : "Nenhum exercício foi registrado nesta semana.";

  const periodHabitAnalytics = periodBundle.data?.habitAnalytics;
  const periodSupportLoading = periodBundle.isLoading;
  const periodHydrationReading = !periodHabitAnalytics
    ? "Ainda não há dados suficientes para interpretar a hidratação do período."
    : periodHabitAnalytics.water.goalHitDays > 0
      ? `${periodHabitAnalytics.water.goalHitDays} de ${periodHabitAnalytics.range.dayCount} dias bateram a meta diária atual de água, o que já mostra algum padrão de consistência.`
      : "Nenhum dia bateu a meta diária atual de água neste intervalo, então vale revisar distribuição e frequência dos registros.";
  const periodExerciseReading = !periodHabitAnalytics
    ? "Ainda não há dados suficientes para interpretar a atividade física do período."
    : periodHabitAnalytics.exercise.activeDays > 1
      ? `Os exercícios ficaram distribuídos em ${periodHabitAnalytics.exercise.activeDays} de ${periodHabitAnalytics.range.dayCount} dias, o que ajuda a evitar concentração excessiva em um único ponto do período.`
      : periodHabitAnalytics.exercise.activeDays === 1
        ? "Toda a atividade física registrada ficou concentrada em um único dia deste intervalo."
        : "Nenhum exercício foi registrado neste intervalo.";

  const introStats = (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <SummaryPill label="Calorias" value={formatCalories(localTotals.calories)} />
      <SummaryPill label="Proteínas" value={formatMacroGrams(localTotals.protein)} />
      <SummaryPill label="Carboidratos" value={formatMacroGrams(localTotals.carbs)} />
      <SummaryPill label="Gorduras" value={formatMacroGrams(localTotals.fat)} />
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
              <HighlightCard title="Refeições" value={String(periodMeals.length)} description="Quantidade de refeições encontradas na data ativa." />
            </div>

            <MacroAdherenceSection
              title="Aderência diária às metas"
              description="Calorias e macronutrientes usam a mesma lógica: planejado, realizado, aderência e diferença."
              metrics={macroMetrics}
            />
            <PlannedVsRealizedMacrosSection metrics={macroMetrics} />

            <Card className="border-0 shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <UtensilsCrossed className="h-5 w-5 text-primary" />
                  Refeições do dia
                </CardTitle>
                <CardDescription>O detalhamento operacional continua acessível dentro do relatório diário.</CardDescription>
              </CardHeader>
              <CardContent>
                <RegisteredMealGroups groups={localDayMealGroups} userTimeZone={userTimeZone} emptyMessage={periodBundle.isLoading ? "Carregando refeições..." : "Nenhuma refeição encontrada para este dia."} />
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
                  <HighlightCard title="Macros realizados" value={formatMacroGrams(localTotals.protein + localTotals.carbs + localTotals.fat)} description="Soma de proteínas, carboidratos e gorduras no período." />
                  <HighlightCard title="Calorias líquidas" value={formatCalories(progress.summary.totalNetCalories)} description={`Exercícios registrados: ${formatCalories(progress.summary.totalExerciseCalories)}.`} />
                </div>

                <MacroAdherenceSection
                  title="Aderência semanal às metas"
                  description="Proteínas, carboidratos e gorduras agora têm cálculos próprios, com a mesma leitura aplicada às calorias."
                  metrics={macroMetrics}
                />
                <PlannedVsRealizedMacrosSection metrics={macroMetrics} />

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

                <div className="grid gap-6 xl:grid-cols-2">
                  <WaterAnalyticsCard
                    title="Hidratação na semana"
                    scopeLabel="Semanal"
                    description="Esta leitura olha aderência à meta, média diária e o ponto mais fraco da semana."
                    totalConsumedMl={weeklyWaterTotal}
                    totalGoalMl={weeklyWaterGoalTotal}
                    goalHitDays={weeklyWaterGoalHitDays}
                    totalDays={caloricTrend.length || 0}
                    averageDailyMl={weeklyAverageWater}
                    lowestDay={lowestWaterDay ? `${lowestWaterDay.label} · ${formatCountPtBr(lowestWaterDay.waterConsumedMl, " ml")}` : "-"}
                    reading={hydrationReading}
                  />

                  <ExerciseAnalyticsCard
                    title="Atividade física na semana"
                    scopeLabel="Semanal"
                    description="O objetivo aqui é mostrar frequência, distribuição e concentração do gasto ao longo da semana."
                    activeDays={weeklyExerciseActiveDays}
                    totalDays={caloricTrend.length || 0}
                    totalCalories={progress.summary.totalExerciseCalories}
                    detailLabel="Distribuição"
                    detailValue={`${weeklyExerciseActiveDays}/${caloricTrend.length || 0} dias`}
                    averageCaloriesPerActiveDay={weeklyAverageExercisePerActiveDay}
                    highestDay={highestExerciseDay && highestExerciseDay.exerciseCalories > 0 ? `${highestExerciseDay.label} · ${formatCalories(highestExerciseDay.exerciseCalories)}` : "Sem exercício"}
                    reading={exerciseReading}
                  />
                </div>

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
                            {caloricTrend.map((day: any) => (
                              <Cell key={day.date} fill={getCalorieBarColor(day.calories, day.goalCalories)} />
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
                          {weeklyInsights.insights.slice(0, 3).map((insight: any) => (
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
                        {mealGroupsByDate.map((group: any) => (
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

            <MacroAdherenceSection
              title={periodScope === "month" ? "Aderência mensal às metas" : "Aderência do período às metas"}
              description="Calorias e macronutrientes usam metas e consumo próprios para o intervalo ativo."
              metrics={macroMetrics}
            />
            <PlannedVsRealizedMacrosSection metrics={macroMetrics} />

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

            {periodSupportLoading ? (
              <div className="grid gap-4 xl:grid-cols-2">
                <Skeleton className="h-64 rounded-2xl" />
                <Skeleton className="h-64 rounded-2xl" />
              </div>
            ) : (
              <div className="grid gap-6 xl:grid-cols-2">
                <WaterAnalyticsCard
                  title={periodScope === "month" ? "Hidratação no mês" : "Hidratação no período"}
                  scopeLabel={periodScopeLabel}
                  description="Usa a meta diária atual como referência para mostrar consistência, média e dias mais fracos do intervalo."
                  totalConsumedMl={periodHabitAnalytics?.water.totalConsumedMl ?? 0}
                  totalGoalMl={periodHabitAnalytics?.water.totalGoalMl ?? 0}
                  goalHitDays={periodHabitAnalytics?.water.goalHitDays ?? 0}
                  totalDays={periodHabitAnalytics?.range.dayCount ?? 0}
                  averageDailyMl={periodHabitAnalytics?.water.averageDailyMl ?? 0}
                  lowestDay={periodHabitAnalytics?.water.lowestDay ? `${periodHabitAnalytics.water.lowestDay.label} · ${formatCountPtBr(periodHabitAnalytics.water.lowestDay.totalMl, " ml")}` : "-"}
                  reading={periodHydrationReading}
                />

                <ExerciseAnalyticsCard
                  title={periodScope === "month" ? "Atividade física no mês" : "Atividade física no período"}
                  scopeLabel={periodScopeLabel}
                  description="Mostra frequência, distribuição e volume de gasto ao longo do mês ou do intervalo customizado."
                  activeDays={periodHabitAnalytics?.exercise.activeDays ?? 0}
                  totalDays={periodHabitAnalytics?.range.dayCount ?? 0}
                  totalCalories={periodHabitAnalytics?.exercise.totalCalories ?? 0}
                  detailLabel="Minutos totais"
                  detailValue={formatCountPtBr(Math.round(periodHabitAnalytics?.exercise.totalDurationMinutes ?? 0), " min")}
                  averageCaloriesPerActiveDay={periodHabitAnalytics?.exercise.averageCaloriesPerActiveDay ?? 0}
                  highestDay={periodHabitAnalytics?.exercise.highestDay ? `${periodHabitAnalytics.exercise.highestDay.label} · ${formatCalories(periodHabitAnalytics.exercise.highestDay.caloriesBurned)}` : "Sem exercício"}
                  reading={periodExerciseReading}
                />
              </div>
            )}

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
                <StatusTile label="Refeições registradas" value={periodMeals.length} />
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

function CompactMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border bg-muted/10 px-4 py-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold tracking-tight">{value}</p>
    </div>
  );
}
