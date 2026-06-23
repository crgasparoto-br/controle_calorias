import React from "react";
import PageIntro from "@/components/PageIntro";
import { PeriodScopeSelector } from "@/components/PeriodScopeSelector";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { RegisteredMealGroups } from "@/features/meals/components";
import {
  type DateGroupedRegisteredMealsViewModel,
  buildDateGroupedMealGroups,
  buildRegisteredMealGroups,
} from "@/features/meals/mealViewModels";
import type { StoredMeal } from "@/features/meals/types";
import {
  ReportEmptyState,
  ReportExerciseAnalyticsCard,
  ReportStatusTile,
  ReportTrendSection,
  ReportWaterAnalyticsCard,
  averageValue,
  formatMacro,
  formatPercent,
  type ReportTrendDay,
} from "@/features/reports/ReportAnalyticsSections";
import ReportsSupportInsightsSection from "@/features/reports/ReportsSupportInsightsSection";
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
import { formatCalories, formatCountPtBr } from "@/lib/numberFormat";
import { trpc } from "@/lib/trpc";
import {
  calculateCalorieAdherence,
  calculateMacroAdherence,
  calculateMacroDaySummary,
  type FoodQualitySummary,
  type MacroGoalDay,
  type MacroTotals,
} from "@shared/reportsGoalAnalytics";
import { Activity, ChevronDown, Leaf, Target, UtensilsCrossed } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type ReportsExperienceContext = "self" | "professional";
type MealDateGroup = { date: string; items: StoredMeal[] };
type Totals = { calories: number; protein: number; carbs: number; fat: number };
type ReportDay = Totals & {
  date: string;
  label: string;
  goalCalories: number;
  adjustedGoalCalories: number;
  goalProtein: number;
  goalCarbs: number;
  goalFat: number;
  waterConsumedMl: number;
  waterGoalMl: number;
  exerciseCalories: number;
};
type TrendDay = ReportTrendDay & { baseGoalCalories: number; exerciseCalories: number; calorieDelta: number; adherencePercent: number };
type WeightPoint = { date: string; weightKg: number | null };
type MacroGoalDayWithDate = MacroGoalDay & { date: string };
type MacroGoalKey = "goalProtein" | "goalCarbs" | "goalFat";

type QueryLike = { data: unknown; isLoading: boolean; isError: boolean };

export type ReportsExperienceProps = {
  context?: ReportsExperienceContext;
  viewerUserId?: number | null;
  subjectUserId?: number | null;
};

const EMPTY_TOTALS: Totals = { calories: 0, protein: 0, carbs: 0, fat: 0 };
const EMPTY_QUALITY = { proteinGrams: 0, fiberGrams: 0, waterMl: 0, fruitServings: 0, vegetableServings: 0, ultraProcessedServings: 0, mealCount: 0, regularityScore: 0 };
const MACRO_GOAL_KEYS: Record<keyof MacroTotals, MacroGoalKey> = { protein: "goalProtein", carbs: "goalCarbs", fat: "goalFat" };

function numberValue(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatDateHeading(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "short" });
}

function formatChartDateLabel(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

function normalizeDay(day: any, fallbackGoal?: any): ReportDay {
  const goalCalories = numberValue(day.goalCalories ?? fallbackGoal?.calories);
  const adjustedGoalCalories = numberValue(day.adjustedGoalCalories ?? day.goalCalories ?? fallbackGoal?.calories);
  return {
    date: String(day.date ?? ""),
    label: String(day.label ?? (day.date ? formatChartDateLabel(day.date) : "-")),
    calories: numberValue(day.calories),
    protein: numberValue(day.protein),
    carbs: numberValue(day.carbs),
    fat: numberValue(day.fat),
    goalCalories,
    adjustedGoalCalories,
    goalProtein: numberValue(day.goalProtein ?? fallbackGoal?.protein ?? fallbackGoal?.proteinGrams),
    goalCarbs: numberValue(day.goalCarbs ?? fallbackGoal?.carbs ?? fallbackGoal?.carbsGrams),
    goalFat: numberValue(day.goalFat ?? fallbackGoal?.fat ?? fallbackGoal?.fatGrams),
    waterConsumedMl: numberValue(day.waterConsumedMl),
    waterGoalMl: numberValue(day.waterGoalMl),
    exerciseCalories: numberValue(day.exerciseCalories),
  };
}

function toTrendDay(day: ReportDay): TrendDay {
  const adjustedGoalCalories = day.adjustedGoalCalories || day.goalCalories;
  return {
    date: day.date,
    label: day.label || formatChartDateLabel(day.date),
    calories: Math.round(day.calories),
    protein: Math.round(day.protein),
    carbs: Math.round(day.carbs),
    fat: Math.round(day.fat),
    goalCalories: adjustedGoalCalories,
    baseGoalCalories: day.goalCalories,
    exerciseCalories: Math.round(day.exerciseCalories),
    calorieDelta: Math.round(day.calories - adjustedGoalCalories),
    adherencePercent: adjustedGoalCalories > 0 ? (day.calories / adjustedGoalCalories) * 100 : 0,
  };
}

function sumMealTotals(meals: StoredMeal[]): Totals {
  return meals.reduce((totals, meal) => ({
    calories: totals.calories + (meal.totals?.calories ?? 0),
    protein: totals.protein + (meal.totals?.protein ?? 0),
    carbs: totals.carbs + (meal.totals?.carbs ?? 0),
    fat: totals.fat + (meal.totals?.fat ?? 0),
  }), { ...EMPTY_TOTALS });
}

function buildGroupedMealViewModels(mealsByDate: MealDateGroup[]): DateGroupedRegisteredMealsViewModel[] {
  return mealsByDate.slice().reverse().map(group => ({
    date: group.date,
    meals: group.items,
    mealCount: group.items.length,
    itemCount: group.items.reduce((total, meal) => total + (meal.items?.length ?? 0), 0),
    totals: sumMealTotals(group.items),
    groups: buildRegisteredMealGroups(group.items),
  }));
}

function normalizeMealDateGroups(value: any): MealDateGroup[] {
  return (Array.isArray(value) ? value : [])
    .map((group: any) => ({
      date: String(group?.date ?? ""),
      items: ((group?.items ?? group?.meals ?? []) as StoredMeal[]).filter(Boolean),
    }))
    .filter(group => group.date);
}

function extractMeals(bundleData: any, mealDateGroups: MealDateGroup[]): StoredMeal[] {
  const groupedMeals = mealDateGroups.flatMap(group => group.items);
  if (groupedMeals.length) return groupedMeals;

  const candidate = [bundleData?.meals, bundleData?.recentMeals, bundleData?.periodMeals, bundleData?.weeklyMeals]
    .find(value => Array.isArray(value));
  return (candidate ?? []).filter(Boolean) as StoredMeal[];
}

function buildMealsByDate(mealsByDate: MealDateGroup[], periodMeals: StoredMeal[], userTimeZone: string) {
  if (mealsByDate.length) return buildGroupedMealViewModels(mealsByDate);
  return buildDateGroupedMealGroups(periodMeals, { timeZone: userTimeZone, sortDirection: "asc" });
}

function normalizeWeightPoints(value: any): WeightPoint[] {
  return (value?.entries ?? value?.points ?? value?.summary?.entries ?? [])
    .map((entry: any) => ({ date: String(entry.date ?? ""), weightKg: Number(entry.weightKg ?? 0) || null }))
    .filter((entry: WeightPoint) => entry.date);
}

function resolveWeightForDate(date: string, weights: WeightPoint[]) {
  const usableWeights = weights.filter(weight => weight.date && Number(weight.weightKg) > 0).sort((first, second) => first.date.localeCompare(second.date));
  const exact = usableWeights.find(weight => weight.date === date);
  if (exact) return Number(exact.weightKg);
  const previous = usableWeights.filter(weight => weight.date < date).at(-1);
  return previous ? Number(previous.weightKg) : null;
}

function calculateMacroPerKg(key: keyof MacroTotals, days: MacroGoalDayWithDate[], weights: WeightPoint[]) {
  const goalKey = MACRO_GOAL_KEYS[key];
  const perKg = days.reduce((acc, day) => {
    const weightKg = resolveWeightForDate(day.date, weights);
    if (!weightKg) return acc;
    acc.planned += Number(day[goalKey] ?? 0) / weightKg;
    acc.realized += Number(day[key] ?? 0) / weightKg;
    acc.days += 1;
    return acc;
  }, { planned: 0, realized: 0, days: 0 });

  return {
    planned: perKg.days ? perKg.planned / perKg.days : null,
    realized: perKg.days ? perKg.realized / perKg.days : null,
  };
}

function formatPerKgDay(value: number | null) {
  if (value === null) return "Sem peso para g/kg/dia";
  return `${formatMacro(value)} g/kg/dia`;
}

function buildDiagnosis(scope: PeriodScope, adherencePercent: number, daysWithinRange: number, dayCount: number) {
  const periodLabel = scope === "day" ? "O dia" : scope === "week" ? "A semana" : scope === "month" ? "O mês" : "O período";
  if (!dayCount) return `${periodLabel} ainda não tem dados suficientes para um diagnóstico calórico.`;
  if (adherencePercent >= 90 && adherencePercent <= 105) return `${periodLabel} está aderente à meta ajustada, com ${daysWithinRange}/${dayCount} dias dentro da faixa.`;
  if (adherencePercent > 105) return `${periodLabel} ficou acima da meta ajustada; veja qualidade, exercícios e dias detalhados antes de ajustar a rotina.`;
  return `${periodLabel} ficou abaixo da meta ajustada; os blocos abaixo ajudam a separar falta de registro, baixa ingestão e contexto de treino.`;
}

function findExtreme<T>(items: T[], getValue: (item: T) => number, direction: "min" | "max") {
  return items.reduce<T | null>((current, item) => {
    if (!current) return item;
    const nextValue = getValue(item);
    const currentValue = getValue(current);
    return direction === "max" ? (nextValue > currentValue ? item : current) : (nextValue < currentValue ? item : current);
  }, null);
}

function normalizeQueryResult(value: any): QueryLike {
  return {
    data: value?.data ?? null,
    isLoading: Boolean(value?.isLoading),
    isError: Boolean(value?.isError),
  };
}

function MacroValueTile({ label, grams, perKg }: { label: string; grams: number; perKg: number | null }) {
  return <div className="rounded-2xl border bg-background p-4 shadow-sm"><p className="text-sm text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-semibold tracking-tight">{formatMacro(grams)} g</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{formatPerKgDay(perKg)}</p></div>;
}

function MacroDistributionSection({ consumed, planned, dailyMacros, weightPoints }: { consumed: MacroTotals; planned: MacroTotals; dailyMacros: MacroGoalDayWithDate[]; weightPoints: WeightPoint[] }) {
  const analysis = calculateMacroAdherence(consumed, planned);
  const daySummary = calculateMacroDaySummary(dailyMacros);
  const hasMacroGoal = planned.protein > 0 || planned.carbs > 0 || planned.fat > 0;
  const chartData = analysis.items.map(item => ({ macro: item.label, planejado: item.plannedPercent, realizado: item.consumedPercent }));
  const macroDetails = analysis.items.map(item => ({ item, perKg: calculateMacroPerKg(item.key, dailyMacros, weightPoints) }));

  return <Card className="border-0 shadow-sm"><CardHeader><CardTitle className="flex items-center gap-2"><Activity className="h-5 w-5 text-primary" />Macronutrientes planejados vs realizados</CardTitle><CardDescription>Mostra gramas, g/kg/dia e distribuição percentual para avaliar a composição do período, não apenas o total de calorias.</CardDescription></CardHeader><CardContent className="space-y-5">{!hasMacroGoal ? <ReportEmptyState text="Configure metas de proteínas, carboidratos e gorduras para liberar a comparação percentual de macros." /> : <><div className="grid gap-3 md:grid-cols-3"><ReportStatusTile label="Aderência da distribuição" value={formatPercent(analysis.distributionAdherencePercent)} /><ReportStatusTile label="Macro mais distante" value={analysis.mostDistantMacro?.label ?? "-"} /><ReportStatusTile label="Dias com macros" value={daySummary.daysWithMacroRecords} /></div><div className="h-[280px] rounded-2xl border bg-background p-4 shadow-sm"><ResponsiveContainer width="100%" height="100%"><BarChart data={chartData} barSize={32}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="macro" /><YAxis tickFormatter={value => `${value}%`} /><Tooltip formatter={value => formatPercent(Number(value))} /><Legend /><Bar dataKey="planejado" name="Planejado" fill="#94a3b8" radius={[8, 8, 0, 0]} /><Bar dataKey="realizado" name="Realizado" fill="#16a34a" radius={[8, 8, 0, 0]} /></BarChart></ResponsiveContainer></div><div className="grid gap-3 md:grid-cols-3">{macroDetails.map(({ item, perKg }) => <div key={item.key} className="rounded-2xl border bg-background p-4 shadow-sm"><p className="text-sm font-medium">{item.label}</p><div className="mt-3 grid gap-3 sm:grid-cols-2"><MacroValueTile label="Planejado" grams={item.plannedGrams} perKg={perKg.planned} /><MacroValueTile label="Realizado" grams={item.consumedGrams} perKg={perKg.realized} /></div><p className="mt-3 text-sm text-muted-foreground">Distribuição: {formatPercent(item.plannedPercent)} planejado vs {formatPercent(item.consumedPercent)} realizado.</p></div>)}</div></>}</CardContent></Card>;
}

function FoodQualitySection({ quality, simpleQuality, dayCount }: { quality?: FoodQualitySummary; simpleQuality: typeof EMPTY_QUALITY; dayCount: number }) {
  const distribution = quality?.distribution ?? [];
  return <Card className="border-0 shadow-sm"><CardHeader><CardTitle className="flex items-center gap-2"><Leaf className="h-5 w-5 text-primary" />Qualidade alimentar</CardTitle><CardDescription>Indicadores de processamento, fibras, frutas, legumes e regularidade entram como parte central do diagnóstico.</CardDescription></CardHeader><CardContent className="space-y-4"><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4"><ReportStatusTile label="Índice de qualidade" value={quality?.qualityIndex == null ? "-" : formatPercent(quality.qualityIndex)} /><ReportStatusTile label="Ultraprocessados" value={formatPercent(quality?.ultraProcessedCaloriesPercent ?? 0)} /><ReportStatusTile label="In natura/minimamente" value={formatPercent(quality?.naturalOrMinimallyProcessedCaloriesPercent ?? 0)} /><ReportStatusTile label="Não classificados" value={formatPercent(quality?.unclassifiedCaloriesPercent ?? 0)} /></div>{distribution.length ? <div className="grid gap-3 md:grid-cols-3">{distribution.map(item => <div key={item.key} className="rounded-2xl border bg-background p-4 shadow-sm"><div className="mb-3 flex items-center justify-between gap-3"><p className="text-sm font-medium">{item.label}</p><span className="rounded-full border px-3 py-1 text-xs">{formatPercent(item.percent)}</span></div><Progress className="h-2" value={item.percent} /><p className="mt-3 text-sm text-muted-foreground">{formatCalories(item.calories)} no período.</p></div>)}</div> : <ReportEmptyState text="Ainda não há classificação suficiente para montar a distribuição por processamento neste período." />}<div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4"><ReportStatusTile label="Dias com frutas" value={`${quality?.fruitDays ?? 0}/${quality?.dayCount ?? dayCount}`} /><ReportStatusTile label="Dias com legumes/verduras" value={`${quality?.vegetableDays ?? 0}/${quality?.dayCount ?? dayCount}`} /><ReportStatusTile label="Fibras" value={`${formatMacro(simpleQuality.fiberGrams)} g`} /><ReportStatusTile label="Regularidade" value={formatPercent(simpleQuality.regularityScore)} /></div></CardContent></Card>;
}

function CalorieAdherenceSection({ trendData, dayCount }: { trendData: TrendDay[]; dayCount: number }) {
  const summary = calculateCalorieAdherence(trendData, dayCount);
  const totalExerciseCalories = trendData.reduce((total, day) => total + day.exerciseCalories, 0);
  const totalBaseGoalCalories = trendData.reduce((total, day) => total + day.baseGoalCalories, 0);
  return <Card className="border-0 shadow-sm"><CardHeader><CardTitle className="flex items-center gap-2"><Target className="h-5 w-5 text-primary" />Indicadores da meta ajustada</CardTitle><CardDescription>Consolida consumo, meta ajustada, saldo, exercícios e dias fora ou dentro da faixa no período selecionado.</CardDescription></CardHeader><CardContent className="space-y-5"><div className="rounded-3xl border bg-muted/20 p-4"><div className="mb-3 flex items-center justify-between gap-3"><p className="text-sm font-medium tracking-tight">Aderência média do período</p><p className="text-sm text-muted-foreground">{formatPercent(summary.adherencePercent)}</p></div><Progress className="h-2" value={Math.min(summary.adherencePercent, 100)} /></div><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4"><ReportStatusTile label="Consumido" value={formatCalories(summary.totalCalories)} /><ReportStatusTile label="Meta ajustada" value={formatCalories(summary.totalGoalCalories)} /><ReportStatusTile label="Saldo ajustado" value={formatCalories(summary.totalCalories - summary.totalGoalCalories)} /><ReportStatusTile label="Meta base" value={formatCalories(totalBaseGoalCalories)} /></div><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4"><ReportStatusTile label="Exercícios adicionaram" value={formatCalories(totalExerciseCalories)} /><ReportStatusTile label="Dentro da faixa" value={`${summary.daysWithinRange}/${dayCount}`} /><ReportStatusTile label="Acima da faixa" value={summary.daysAboveRange} /><ReportStatusTile label="Abaixo da faixa" value={summary.daysBelowRange} /></div></CardContent></Card>;
}

function DailyDetailsSections({ groups, userTimeZone }: { groups: DateGroupedRegisteredMealsViewModel[]; userTimeZone: string }) {
  return <Card className="border-0 shadow-sm"><CardHeader><CardTitle className="flex items-center gap-2"><UtensilsCrossed className="h-5 w-5 text-primary" />Detalhamento de dias e refeições</CardTitle><CardDescription>Abra apenas os dias que precisar investigar; o diagnóstico principal fica acima.</CardDescription></CardHeader><CardContent className="space-y-4">{groups.length ? groups.map(group => <details key={group.date} className="group rounded-3xl border bg-muted/10 p-4"><summary className="flex cursor-pointer list-none flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-base font-semibold tracking-tight capitalize">{formatDateHeading(group.date)}</p><p className="text-sm text-muted-foreground">{group.mealCount} refeições no dia</p></div><div className="flex items-center gap-3"><span className="rounded-full bg-muted px-3 py-1 text-xs font-medium">{formatCalories(group.totals.calories)}</span><ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" /></div></summary><div className="pt-4"><RegisteredMealGroups groups={group.groups} userTimeZone={userTimeZone} emptyMessage="Nenhuma refeição encontrada para este dia." /></div></details>) : <ReportEmptyState text="Nenhuma refeição confirmada foi encontrada para detalhamento neste intervalo." />}</CardContent></Card>;
}

export function ReportsExperience({ context = "self", subjectUserId }: ReportsExperienceProps) {
  const isProfessional = context === "professional";
  const userTimeZone = React.useMemo(() => getBrowserTimeZone(), []);
  const [periodScope, setPeriodScope] = React.useState<PeriodScope>("week");
  const [selectedDay, setSelectedDay] = React.useState(() => toDateInputValue());
  const [selectedMonth, setSelectedMonth] = React.useState(() => toMonthInputValue(new Date(), userTimeZone));
  const [rangeStart, setRangeStart] = React.useState(() => toDateInputValue(new Date(Date.now() - 13 * 24 * 60 * 60 * 1000), userTimeZone));
  const [rangeEnd, setRangeEnd] = React.useState(() => toDateInputValue());

  const activeRange = React.useMemo(() => {
    if (periodScope === "day") return { start: selectedDay, end: selectedDay };
    if (periodScope === "week") return getWeekRange(selectedDay);
    if (periodScope === "month") return getMonthRange(selectedMonth);
    return normalizeDateRange(rangeStart, rangeEnd);
  }, [periodScope, rangeEnd, rangeStart, selectedDay, selectedMonth]);
  const weekOffset = React.useMemo(() => getWeekOffsetFromToday(selectedDay, userTimeZone), [selectedDay, userTimeZone]);

  const selfWeeklyBundle = normalizeQueryResult(trpc.nutrition.reports.bundle.useQuery({ weekOffset }, { enabled: !isProfessional && periodScope === "week" }));
  const selfPeriodBundle = normalizeQueryResult(trpc.nutrition.reports.periodBundle.useQuery({ startDate: activeRange.start, endDate: activeRange.end }, { enabled: !isProfessional && periodScope !== "week" }));
  const professionalDashboardQuery = trpc.nutrition.professionals?.patientDashboard;
  const professionalPeriodQuery = trpc.nutrition.professionals?.patientPeriodBundle;
  const professionalWeeklyBundle = normalizeQueryResult(professionalDashboardQuery?.useQuery({ patientId: subjectUserId ?? 0, weekOffset }, { enabled: isProfessional && Boolean(subjectUserId) && periodScope === "week" }));
  const professionalPeriodBundle = normalizeQueryResult(professionalPeriodQuery?.useQuery({ patientId: subjectUserId ?? 0, startDate: activeRange.start, endDate: activeRange.end }, { enabled: isProfessional && Boolean(subjectUserId) && periodScope !== "week" }));
  const isWeek = periodScope === "week";
  const activeBundle = isProfessional ? (isWeek ? professionalWeeklyBundle : professionalPeriodBundle) : (isWeek ? selfWeeklyBundle : selfPeriodBundle);
  const bundleData = activeBundle.data as any;

  const metricDays = React.useMemo(() => {
    const rawDays = isWeek ? (bundleData?.weekly ?? bundleData?.weeklyReport ?? []) : (bundleData?.daily ?? []);
    return (rawDays as any[]).map(day => normalizeDay(day, bundleData?.goal));
  }, [bundleData, isWeek]);
  const dayCount = metricDays.length || countDaysInRange(activeRange);
  const trendData = metricDays.map(toTrendDay);
  const adherence = calculateCalorieAdherence(trendData, dayCount);
  const diagnosis = buildDiagnosis(periodScope, adherence.adherencePercent, adherence.daysWithinRange, dayCount);
  const totals = metricDays.length ? metricDays.reduce<Totals>((acc, day) => ({ calories: acc.calories + day.calories, protein: acc.protein + day.protein, carbs: acc.carbs + day.carbs, fat: acc.fat + day.fat }), { ...EMPTY_TOTALS }) : bundleData?.totals ?? EMPTY_TOTALS;
  const consumedMacros: MacroTotals = { protein: totals.protein, carbs: totals.carbs, fat: totals.fat };
  const plannedMacros: MacroTotals = { protein: metricDays.reduce((total, day) => total + day.goalProtein, 0), carbs: metricDays.reduce((total, day) => total + day.goalCarbs, 0), fat: metricDays.reduce((total, day) => total + day.goalFat, 0) };
  const dailyMacros: MacroGoalDayWithDate[] = metricDays.map(day => ({ date: day.date, protein: day.protein, carbs: day.carbs, fat: day.fat, goalProtein: day.goalProtein, goalCarbs: day.goalCarbs, goalFat: day.goalFat }));
  const supportWeight = isWeek ? (bundleData?.progress?.weight ?? bundleData?.weight) : (bundleData?.weightTrend ?? bundleData?.progress?.weight);
  const weightPoints = normalizeWeightPoints(supportWeight);
  const simpleQuality = bundleData?.quality ?? EMPTY_QUALITY;
  const foodQuality = bundleData?.quality?.foodQuality as FoodQualitySummary | undefined;
  const waterConsumedMl = isWeek ? metricDays.reduce((total, day) => total + day.waterConsumedMl, 0) : numberValue(bundleData?.habitAnalytics?.water?.totalConsumedMl);
  const waterGoalMl = isWeek ? metricDays.reduce((total, day) => total + day.waterGoalMl, 0) : numberValue(bundleData?.habitAnalytics?.water?.totalGoalMl);
  const waterHitDays = isWeek ? metricDays.filter(day => day.waterGoalMl > 0 && day.waterConsumedMl >= day.waterGoalMl).length : numberValue(bundleData?.habitAnalytics?.water?.goalHitDays);
  const lowestWaterDay = findExtreme(metricDays, day => day.waterConsumedMl, "min");
  const exerciseActiveDays = isWeek ? metricDays.filter(day => day.exerciseCalories > 0).length : numberValue(bundleData?.habitAnalytics?.exercise?.activeDays);
  const exerciseCalories = isWeek ? metricDays.reduce((total, day) => total + day.exerciseCalories, 0) : numberValue(bundleData?.habitAnalytics?.exercise?.totalCalories);
  const highestExerciseDay = findExtreme(metricDays, day => day.exerciseCalories, "max");
  const mealDateGroups = React.useMemo(() => normalizeMealDateGroups(bundleData?.mealsByDate ?? bundleData?.mealsByDay ?? bundleData?.dailyMealsByDate), [bundleData]);
  const periodMeals = React.useMemo(() => extractMeals(bundleData, mealDateGroups), [bundleData, mealDateGroups]);
  const mealGroupsAsc = React.useMemo(() => buildMealsByDate(mealDateGroups, periodMeals, userTimeZone), [mealDateGroups, periodMeals, userTimeZone]);
  const mealGroupsDesc = React.useMemo(() => [...mealGroupsAsc].reverse(), [mealGroupsAsc]);
  const scopeLabel = periodScope === "day" ? "Dia" : periodScope === "week" ? "Semana" : periodScope === "month" ? "Mês" : "Período";

  if (isProfessional && !subjectUserId) {
    return <ReportEmptyState text="Escolha uma pessoa autorizada para revisar relatórios, metas e evolução no período selecionado." />;
  }

  return <div className="space-y-6"><PageIntro eyebrow="Relatórios" title="Diagnóstico nutricional do período" description={`${diagnosis} Intervalo ativo: ${formatRangeLabel(activeRange)}.`} actions={<PeriodScopeSelector scope={periodScope} onScopeChange={setPeriodScope} selectedDay={selectedDay} onSelectedDayChange={setSelectedDay} selectedMonth={selectedMonth} onSelectedMonthChange={setSelectedMonth} rangeStart={rangeStart} onRangeStartChange={setRangeStart} rangeEnd={rangeEnd} onRangeEndChange={setRangeEnd} />} />{activeBundle.isLoading ? <div className="grid gap-4 lg:grid-cols-3"><Skeleton className="h-32 rounded-2xl" /><Skeleton className="h-32 rounded-2xl" /><Skeleton className="h-32 rounded-2xl" /></div> : null}{activeBundle.isError ? <ReportEmptyState text={isProfessional ? "Não foi possível carregar os relatórios autorizados. Tente novamente em instantes." : "Não foi possível carregar os relatórios agora. Tente novamente em instantes."} /> : null}{!activeBundle.isLoading && !activeBundle.isError ? <><CalorieAdherenceSection trendData={trendData} dayCount={dayCount} /><ReportTrendSection title="Consumo diário vs meta ajustada" description="Cada dia usa a meta ajustada como referência; a meta base fica apenas no resumo explicativo acima." days={trendData} /><FoodQualitySection quality={foodQuality} simpleQuality={simpleQuality} dayCount={dayCount} /><MacroDistributionSection consumed={consumedMacros} planned={plannedMacros} dailyMacros={dailyMacros} weightPoints={weightPoints} /><ReportsSupportInsightsSection scopeLabel={scopeLabel} trendData={trendData} dayCount={dayCount} weight={supportWeight} /><div className="grid gap-6 xl:grid-cols-2"><ReportWaterAnalyticsCard title="Hidratação como contexto" scopeLabel={isWeek ? "Semanal" : "Período"} description="Mostra consistência de água sem competir com o diagnóstico calórico." totalConsumedMl={waterConsumedMl} totalGoalMl={waterGoalMl} goalHitDays={waterHitDays} totalDays={dayCount} averageDailyMl={averageValue(waterConsumedMl, Math.max(dayCount, 1))} lowestDay={lowestWaterDay ? `${lowestWaterDay.label} · ${formatCountPtBr(lowestWaterDay.waterConsumedMl, " ml")}` : "-"} reading={waterHitDays > 0 ? `${waterHitDays} de ${dayCount} dias bateram a meta de água.` : "Ainda não há dias com meta de água batida neste intervalo."} /><ReportExerciseAnalyticsCard title="Exercícios e meta ajustada" scopeLabel={isWeek ? "Semanal" : "Período"} description="Explica quanto os exercícios adicionaram à meta e como se distribuíram no período." activeDays={exerciseActiveDays} totalDays={dayCount} totalCalories={exerciseCalories} detailLabel="Impacto na meta" detailValue={formatCalories(exerciseCalories)} averageCaloriesPerActiveDay={exerciseActiveDays ? averageValue(exerciseCalories, exerciseActiveDays) : 0} highestDay={highestExerciseDay && highestExerciseDay.exerciseCalories > 0 ? `${highestExerciseDay.label} · ${formatCalories(highestExerciseDay.exerciseCalories)}` : "Sem exercício"} reading={exerciseActiveDays > 0 ? `Os exercícios apareceram em ${exerciseActiveDays} de ${dayCount} dias e foram incorporados à meta ajustada.` : "Nenhum exercício foi registrado neste intervalo."} /></div><DailyDetailsSections groups={mealGroupsDesc} userTimeZone={userTimeZone} /></> : null}</div>;
}

export default ReportsExperience;
