import React from "react";
import DashboardLayout from "@/components/DashboardLayout";
import PageIntro from "@/components/PageIntro";
import { PeriodScopeSelector } from "@/components/PeriodScopeSelector";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { SummaryPill } from "@/features/meals/components";
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
import { BarChart3, CalendarDays, Droplets, Dumbbell, Leaf, Scale, Target, TrendingUp } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  calculateCalorieAdherence,
  calculateWeightTrendSummary,
  type FoodQualityDistributionItem,
  type FoodQualitySummary,
  type MacroTotals,
  type WeightTrendPoint,
} from "@shared/reportsGoalAnalytics";

type ReportTotals = MacroTotals & { calories: number };
type MacroKey = "protein" | "carbs" | "fat";
type Metric = { title: string; value: string; description: string };

type PeriodReportDay = Record<string, any> & {
  date: string;
  label: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  goalCalories: number;
  adjustedGoalCalories?: number | null;
  goalProtein?: number | null;
  goalCarbs?: number | null;
  goalFat?: number | null;
};

type TrendPoint = {
  date: string;
  label: string;
  calories: number;
  goalCalories: number;
  baseGoalCalories: number;
  exerciseCalories: number;
  calorieDelta: number;
  adherencePercent: number;
};

type DailyMacroSource = {
  date: string;
  label: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  goalCalories: number;
  adjustedGoalCalories: number;
  goalProtein: number;
  goalCarbs: number;
  goalFat: number;
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
};

type WeightEntryPoint = WeightTrendPoint & { notes?: string | null };
type ExistingWeightSummary = {
  hasData?: boolean;
  entries?: WeightEntryPoint[];
  firstWeightKg?: number | null;
  lastWeightKg?: number | null;
};
type WeightTrendBundle = { points?: WeightEntryPoint[]; summary?: ExistingWeightSummary };
type WeightPoint = { date: string; weightKg: number | null };

const EMPTY_TOTALS: ReportTotals = { calories: 0, protein: 0, carbs: 0, fat: 0 };
const MACRO_META: Array<{ key: MacroKey; title: string; goalKey: "goalProtein" | "goalCarbs" | "goalFat" }> = [
  { key: "protein", title: "Proteínas", goalKey: "goalProtein" },
  { key: "carbs", title: "Carboidratos", goalKey: "goalCarbs" },
  { key: "fat", title: "Gorduras", goalKey: "goalFat" },
];
const EMPTY_FOOD_QUALITY_DISTRIBUTION: FoodQualityDistributionItem[] = [
  { key: "naturalOrMinimallyProcessed", label: "In natura/minimamente processados", calories: 0, percent: 0 },
  { key: "ultraProcessed", label: "Ultraprocessados", calories: 0, percent: 0 },
  { key: "unclassified", label: "Não classificados", calories: 0, percent: 0 },
];

function formatMacro(value: number) {
  return formatNumberPtBr(value, { minimumFractionDigits: Number.isInteger(value) ? 0 : 1, maximumFractionDigits: 1 });
}
function formatMacroGrams(value: number) { return `${formatMacro(value)} g`; }
function formatSignedMacro(value: number | null | undefined) { const normalized = Number(value ?? 0); return `${normalized > 0 ? "+" : ""}${formatMacro(normalized)}`; }
function formatPercent(value: number | null | undefined) { return `${formatNumberPtBr(value ?? 0, { maximumFractionDigits: 1 })}%`; }
function formatSigned(value: number, unit: "kcal" | "g") { const prefix = value > 0 ? "+" : ""; return unit === "kcal" ? `${prefix}${formatCalories(value)}` : `${prefix}${formatMacro(value)} g`; }
function formatPerKgDay(value: number | null) { return value == null ? null : `${formatNumberPtBr(value, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} g/kg/dia`; }
function progressPercent(value: number, goal: number) { if (!goal) return 0; return Math.min(Math.max((value / goal) * 100, 0), 100); }
function averageTrendValue(days: TrendPoint[], getValue: (day: TrendPoint) => number) { if (!days.length) return null; return days.reduce((total, day) => total + getValue(day), 0) / days.length; }
function getCalorieBarColor(calories: number, goalCalories: number) { if (!goalCalories || !calories) return "#cbd5e1"; const ratio = calories / goalCalories; if (ratio > 1.05) return "#dc2626"; if (ratio < 0.9) return "#f59e0b"; return "#16a34a"; }

function toTrendPoint(day: PeriodReportDay): TrendPoint {
  const adjustedGoalCalories = Number(day.adjustedGoalCalories ?? day.goalCalories ?? 0);
  const calories = Number(day.calories ?? 0);
  return { date: day.date, label: day.label, calories: Math.round(calories), goalCalories: adjustedGoalCalories, baseGoalCalories: Number(day.goalCalories ?? 0), exerciseCalories: Math.round(Number(day.exerciseCalories ?? 0)), calorieDelta: Number(day.calorieDelta ?? Math.round(calories - adjustedGoalCalories)), adherencePercent: Number(day.adherencePercent ?? (adjustedGoalCalories > 0 ? (calories / adjustedGoalCalories) * 100 : 0)) };
}
function formatWeightDateLabel(date: string) { return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", day: "2-digit", month: "short" }).format(new Date(`${date}T12:00:00Z`)); }
function buildWeightPointsFromEntries(entries?: WeightEntryPoint[], allowedDates?: Set<string>): WeightTrendPoint[] { return (entries ?? []).filter(entry => (!allowedDates || allowedDates.has(entry.date)) && Number.isFinite(entry.weightKg)).map(entry => ({ date: entry.date, label: entry.label ?? formatWeightDateLabel(entry.date), weightKg: entry.weightKg })).sort((first, second) => first.date.localeCompare(second.date)); }
function buildWeightPointsFromSummary(weight?: ExistingWeightSummary, allowedDates?: Set<string>): WeightTrendPoint[] { const entryPoints = buildWeightPointsFromEntries(weight?.entries, allowedDates); if (entryPoints.length) return entryPoints; if (!weight?.hasData || weight.firstWeightKg == null) return []; if (weight.lastWeightKg == null || weight.lastWeightKg === weight.firstWeightKg) return [{ date: "initial", label: "Registro", weightKg: weight.firstWeightKg }]; return [{ date: "initial", label: "Inicial", weightKg: weight.firstWeightKg }, { date: "last", label: "Último", weightKg: weight.lastWeightKg }]; }
function normalizeWeightPoints(value: any): WeightPoint[] { const entries = value?.entries ?? value?.points ?? value?.summary?.entries ?? []; return entries.map((entry: any) => ({ date: entry.date, weightKg: Number(entry.weightKg ?? 0) || null })).filter((entry: WeightPoint) => entry.date); }
function resolveWeightForDate(date: string, weights: WeightPoint[]) { const usableWeights = weights.filter(weight => weight.date && Number(weight.weightKg) > 0).sort((first, second) => first.date.localeCompare(second.date)); const exact = usableWeights.find(weight => weight.date === date); if (exact) return Number(exact.weightKg); const previous = usableWeights.filter(weight => weight.date < date).at(-1); return previous ? Number(previous.weightKg) : null; }
function normalizeMacroDays(days: PeriodReportDay[], fallbackGoal?: ReportTotals): DailyMacroSource[] { return days.map(day => ({ date: day.date, label: day.label, calories: Number(day.calories ?? 0), protein: Number(day.protein ?? 0), carbs: Number(day.carbs ?? 0), fat: Number(day.fat ?? 0), goalCalories: Number(day.goalCalories ?? fallbackGoal?.calories ?? 0), adjustedGoalCalories: Number(day.adjustedGoalCalories ?? day.goalCalories ?? fallbackGoal?.calories ?? 0), goalProtein: Number(day.goalProtein ?? fallbackGoal?.protein ?? 0), goalCarbs: Number(day.goalCarbs ?? fallbackGoal?.carbs ?? 0), goalFat: Number(day.goalFat ?? fallbackGoal?.fat ?? 0) })); }
function calculateMacroMetrics(days: DailyMacroSource[], weights: WeightPoint[]): MacroMetric[] { const caloriesPlanned = days.reduce((total, day) => total + day.adjustedGoalCalories, 0); const caloriesRealized = days.reduce((total, day) => total + day.calories, 0); const metrics: MacroMetric[] = [{ key: "calories", title: "Calorias", unit: "kcal", planned: caloriesPlanned, realized: caloriesRealized, percent: progressPercent(caloriesRealized, caloriesPlanned), difference: caloriesRealized - caloriesPlanned, plannedPerKgDay: null, realizedPerKgDay: null }]; MACRO_META.forEach(macro => { const planned = days.reduce((total, day) => total + Number(day[macro.goalKey] ?? 0), 0); const realized = days.reduce((total, day) => total + Number(day[macro.key] ?? 0), 0); const perKg = days.reduce((acc, day) => { const weightKg = resolveWeightForDate(day.date, weights); if (!weightKg) return acc; acc.planned += Number(day[macro.goalKey] ?? 0) / weightKg; acc.realized += Number(day[macro.key] ?? 0) / weightKg; acc.days += 1; return acc; }, { planned: 0, realized: 0, days: 0 }); metrics.push({ key: macro.key, title: macro.title, unit: "g", planned, realized, percent: progressPercent(realized, planned), difference: realized - planned, plannedPerKgDay: perKg.days ? perKg.planned / perKg.days : null, realizedPerKgDay: perKg.days ? perKg.realized / perKg.days : null }); }); return metrics; }
function buildReportsHeading(scope: PeriodScope) { switch (scope) { case "day": return { title: "Relatório diário de metas", description: "Compare o consumo do dia com a meta ajustada, macros planejados e hábitos de apoio." }; case "week": return { title: "Aderência semanal às metas", description: "Veja calorias, macronutrientes, peso, qualidade alimentar, água e exercícios no mesmo contexto." }; case "month": return { title: "Acompanhamento mensal de metas", description: "Entenda tendência, consistência e sinais de apoio sem abrir detalhe alimento por alimento." }; case "range": return { title: "Acompanhamento por período", description: "Consolide um intervalo customizado para avaliar evolução contra metas e hábitos registrados." }; } }
function MetricGrid({ metrics }: { metrics: Metric[] }) { return <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{metrics.map(metric => <Card key={metric.title} className="border-0 shadow-sm"><CardContent className="p-5"><p className="text-sm text-muted-foreground">{metric.title}</p><p className="mt-2 text-3xl font-semibold tracking-tight">{metric.value}</p><p className="mt-2 text-sm leading-6 text-muted-foreground">{metric.description}</p></CardContent></Card>)}</div>; }
function SectionHeader({ icon, title, description, badge }: { icon: React.ReactNode; title: string; description: string; badge?: string }) { return <CardHeader className="space-y-3"><div className="flex flex-wrap items-center justify-between gap-3"><CardTitle className="flex items-center gap-2">{icon}<span>{title}</span></CardTitle>{badge ? <Badge variant="outline" className="rounded-full px-3 py-1 text-xs uppercase">{badge}</Badge> : null}</div><CardDescription>{description}</CardDescription></CardHeader>; }
function EmptyState({ children }: { children: React.ReactNode }) { return <div className="rounded-2xl border border-dashed bg-muted/10 p-5 text-sm leading-6 text-muted-foreground">{children}</div>; }
function StatusTile({ label, value, hint }: { label: string; value: string | number; hint?: string }) { return <div className="rounded-2xl border bg-background p-4 shadow-sm"><p className="text-sm text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>{hint ? <p className="mt-2 text-xs leading-5 text-muted-foreground">{hint}</p> : null}</div>; }
function CompactMetric({ label, value }: { label: string; value: string | number }) { return <div className="rounded-2xl border bg-muted/10 px-4 py-3"><p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-1 text-lg font-semibold tracking-tight">{value}</p></div>; }
function MacroMetricCard({ metric, showPerKg = false }: { metric: MacroMetric; showPerKg?: boolean }) { const plannedValue = metric.unit === "kcal" ? formatCalories(metric.planned) : formatMacroGrams(metric.planned); const realizedValue = metric.unit === "kcal" ? formatCalories(metric.realized) : formatMacroGrams(metric.realized); const plannedPerKg = formatPerKgDay(metric.plannedPerKgDay); const realizedPerKg = formatPerKgDay(metric.realizedPerKgDay); return <Card className="border bg-muted/10 shadow-none"><CardHeader className="space-y-2"><CardTitle className="text-base">{metric.title}</CardTitle><CardDescription>{formatPercent(metric.percent)} realizado vs planejado</CardDescription></CardHeader><CardContent className="space-y-4"><Progress className="h-2" value={metric.percent} /><div className="grid gap-3 sm:grid-cols-3"><CompactMetric label="Planejado" value={plannedValue} /><CompactMetric label="Realizado" value={realizedValue} /><CompactMetric label="Diferença" value={formatSigned(metric.difference, metric.unit)} /></div>{showPerKg && metric.unit === "g" ? plannedPerKg && realizedPerKg ? <div className="grid gap-3 sm:grid-cols-2"><CompactMetric label="Planejado" value={plannedPerKg} /><CompactMetric label="Realizado" value={realizedPerKg} /></div> : <EmptyState>Informe um peso para calcular g/kg/dia deste período.</EmptyState> : null}</CardContent></Card>; }
function MacroAdherenceSection({ title, description, metrics }: { title: string; description: string; metrics: MacroMetric[] }) { return <Card className="border-0 shadow-sm"><SectionHeader icon={<CalendarDays className="h-5 w-5 text-primary" />} title={title} description={description} /><CardContent className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">{metrics.map(metric => <MacroMetricCard key={metric.key} metric={metric} />)}</CardContent></Card>; }
function PlannedVsRealizedMacrosSection({ metrics }: { metrics: MacroMetric[] }) { return <Card className="border-0 shadow-sm"><SectionHeader icon={<Target className="h-5 w-5 text-primary" />} title="Macronutrientes planejados vs realizados" description="Totais do período e média ponderada por peso de referência em g/kg/dia." /><CardContent className="grid gap-4 xl:grid-cols-3">{metrics.filter(metric => metric.unit === "g").map(metric => <MacroMetricCard key={metric.key} metric={metric} showPerKg />)}</CardContent></Card>; }
function CalorieAdherenceCard({ trendData, dayCount }: { trendData: TrendPoint[]; dayCount: number }) { const summary = calculateCalorieAdherence(trendData, dayCount); return <Card className="border-0 shadow-sm"><SectionHeader icon={<Target className="h-5 w-5 text-primary" />} title="Aderência à meta calórica" description="Compara calorias consumidas com a meta ajustada do dia. A faixa ideal considera 90% a 105% da meta." badge="Meta ajustada" /><CardContent className="space-y-5"><div className="rounded-3xl border bg-muted/20 p-4"><div className="mb-3 flex items-center justify-between gap-3"><p className="text-sm font-medium tracking-tight">Aderência média do período</p><p className="text-sm text-muted-foreground">{formatPercent(summary.adherencePercent)}</p></div><Progress className="h-2" value={Math.min(summary.adherencePercent, 100)} /></div><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4"><StatusTile label="Média consumida" value={formatCalories(summary.averageCalories)} /><StatusTile label="Média da meta ajustada" value={formatCalories(summary.averageGoalCalories)} /><StatusTile label="Desvio médio" value={formatCalories(summary.averageDeltaCalories)} /><StatusTile label="Dias na faixa" value={`${summary.daysWithinRange}/${dayCount}`} /></div><div className="grid gap-3 md:grid-cols-3"><StatusTile label="Abaixo da faixa" value={summary.daysBelowRange} /><StatusTile label="Acima da faixa" value={summary.daysAboveRange} /><StatusTile label="Sem registros" value={summary.daysWithoutRecords} /></div></CardContent></Card>; }
function CalorieTrendChart({ trendData }: { trendData: TrendPoint[] }) { if (!trendData.length) return <Card className="border-0 shadow-sm"><CardContent className="p-6 text-sm text-muted-foreground">Ainda não há registros suficientes para desenhar o gráfico de aderência calórica.</CardContent></Card>; return <Card className="border-0 shadow-sm"><SectionHeader icon={<BarChart3 className="h-5 w-5 text-primary" />} title="Consumido vs meta ajustada" description="Cada barra compara o total consumido com a meta ajustada daquele dia." /><CardContent className="h-[340px]"><ResponsiveContainer width="100%" height="100%"><BarChart data={trendData} barSize={28}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="label" /><YAxis /><Tooltip /><Legend /><Bar dataKey="baseGoalCalories" name="Meta base" fill="#e2e8f0" radius={[8, 8, 0, 0]} /><Bar dataKey="goalCalories" name="Meta ajustada" fill="#94a3b8" radius={[8, 8, 0, 0]} /><Bar dataKey="calories" name="Consumido" radius={[8, 8, 0, 0]}>{trendData.map(day => <Cell key={day.date} fill={getCalorieBarColor(day.calories, day.goalCalories)} />)}</Bar></BarChart></ResponsiveContainer></CardContent></Card>; }
function DailyCalorieBreakdown({ trendData, scope }: { trendData: TrendPoint[]; scope: PeriodScope }) { if (!trendData.length) return null; const totalCalories = trendData.reduce((total, day) => total + day.calories, 0); const totalGoalCalories = trendData.reduce((total, day) => total + day.goalCalories, 0); const totalDeltaCalories = trendData.reduce((total, day) => total + day.calorieDelta, 0); const totalExerciseCalories = trendData.reduce((total, day) => total + day.exerciseCalories, 0); const totalAdherencePercent = totalGoalCalories > 0 ? (totalCalories / totalGoalCalories) * 100 : 0; const totalLabel = scope === "week" ? "Total da semana" : "Total do período"; return <Card className="border-0 shadow-sm"><SectionHeader icon={<Target className="h-5 w-5 text-primary" />} title="Detalhe diário da meta ajustada" description="Cada dia mostra consumo, meta ajustada, diferença e percentual de aderência recalculados para o período selecionado." /><CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">{trendData.map(day => <div key={day.date} className="rounded-2xl border bg-background p-4 shadow-sm"><div className="mb-3 flex items-center justify-between gap-3"><p className="font-medium tracking-tight">{day.label}</p><Badge variant="secondary" className="rounded-full">{formatPercent(day.adherencePercent)}</Badge></div><div className="grid gap-2 text-sm text-muted-foreground"><span>Consumido: <strong className="text-foreground">{formatCalories(day.calories)}</strong></span><span>Meta ajustada: <strong className="text-foreground">{formatCalories(day.goalCalories)}</strong></span><span>Diferença: <strong className="text-foreground">{formatCalories(day.calorieDelta)}</strong></span>{day.exerciseCalories > 0 ? <span>Exercícios adicionaram {formatCalories(day.exerciseCalories)} à meta.</span> : null}</div></div>)}<div className="rounded-2xl border bg-background p-4 shadow-sm"><div className="mb-3 flex items-center justify-between gap-3"><p className="font-medium tracking-tight">{totalLabel}</p><Badge variant="secondary" className="rounded-full">{formatPercent(totalAdherencePercent)}</Badge></div><div className="grid gap-2 text-sm text-muted-foreground"><span>Consumido: <strong className="text-foreground">{formatCalories(totalCalories)}</strong></span><span>Meta ajustada: <strong className="text-foreground">{formatCalories(totalGoalCalories)}</strong></span><span>Diferença: <strong className="text-foreground">{formatCalories(totalDeltaCalories)}</strong></span>{totalExerciseCalories > 0 ? <span>Exercícios adicionaram {formatCalories(totalExerciseCalories)} à meta.</span> : null}</div></div></CardContent></Card>; }
function QualityCard({ proteinGrams, fiberGrams, fruitServings, vegetableServings, ultraProcessedServings, regularityScore, foodQuality }: { proteinGrams?: number; fiberGrams?: number; fruitServings?: number; vegetableServings?: number; ultraProcessedServings?: number; regularityScore?: number; foodQuality?: FoodQualitySummary }) { const distribution = foodQuality?.distribution?.length ? foodQuality.distribution : EMPTY_FOOD_QUALITY_DISTRIBUTION; return <Card className="border-0 shadow-sm"><SectionHeader icon={<Leaf className="h-5 w-5 text-primary" />} title="Qualidade alimentar agregada" description="Indicadores do período sem detalhar alimento por alimento. Itens sem classificação ficam separados para não distorcer percentuais." badge="Agregado" /><CardContent className="space-y-4"><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5"><StatusTile label="Dias com frutas" value={`${foodQuality?.fruitDays ?? 0}/${foodQuality?.dayCount ?? 0}`} /><StatusTile label="Dias com legumes/verduras" value={`${foodQuality?.vegetableDays ?? 0}/${foodQuality?.dayCount ?? 0}`} /><StatusTile label="Ultraprocessados" value={formatPercent(foodQuality?.ultraProcessedCaloriesPercent)} /><StatusTile label="In natura/minimamente" value={formatPercent(foodQuality?.naturalOrMinimallyProcessedCaloriesPercent)} /><StatusTile label="Índice de qualidade" value={foodQuality?.qualityIndex == null ? "-" : formatPercent(foodQuality.qualityIndex)} /></div>{!foodQuality?.hasData ? <EmptyState>Ainda não há alimentos classificados suficientes para preencher estes indicadores no período selecionado.</EmptyState> : null}<div className="grid gap-3 md:grid-cols-3">{distribution.map(item => <div key={item.key} className="rounded-2xl border bg-background p-4 shadow-sm"><div className="mb-3 flex items-center justify-between gap-3"><p className="text-sm font-medium">{item.label}</p><Badge variant="secondary" className="rounded-full">{formatPercent(item.percent)}</Badge></div><Progress className="h-2" value={item.percent} /><p className="mt-3 text-sm text-muted-foreground">{formatCalories(item.calories)} no período.</p></div>)}</div><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5"><StatusTile label="Proteína" value={formatMacroGrams(proteinGrams ?? 0)} /><StatusTile label="Fibras" value={formatMacroGrams(fiberGrams ?? 0)} /><StatusTile label="Porções de frutas" value={formatMacro(fruitServings ?? 0)} /><StatusTile label="Porções de legumes/verduras" value={formatMacro(vegetableServings ?? 0)} /><StatusTile label="Porções ultraprocessadas" value={formatMacro(ultraProcessedServings ?? 0)} /></div><div className="rounded-2xl border bg-background p-4"><p className="text-sm text-muted-foreground">Regularidade das refeições</p><p className="mt-2 text-2xl font-semibold tracking-tight">{formatPercent(regularityScore ?? 0)}</p></div></CardContent></Card>; }
function WeightCard({ points, adherencePercent }: { points: WeightTrendPoint[]; adherencePercent: number }) { const summary = calculateWeightTrendSummary(points); const chartData = points.map(point => ({ date: point.date, label: point.label ?? point.date, weightKg: point.weightKg })); const badge = summary.trendDirection === "insufficient_data" ? "Tendência insuficiente" : summary.trendDirection === "stable" ? "Estável" : summary.trendDirection === "up" ? "Subiu" : "Caiu"; return <Card className="border-0 shadow-sm"><SectionHeader icon={<Scale className="h-5 w-5 text-primary" />} title="Evolução do peso e aderência" description="Relaciona registros de peso do período com a aderência calórica média, sem tirar conclusões clínicas isoladas." badge={badge} /><CardContent className="space-y-5">{summary.hasData ? <><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4"><StatusTile label="Peso inicial" value={`${formatMacro(summary.firstWeightKg ?? 0)} kg`} /><StatusTile label="Último peso" value={`${formatMacro(summary.lastWeightKg ?? 0)} kg`} /><StatusTile label="Variação" value={`${formatSignedMacro(summary.deltaKg)} kg`} hint={`${formatSignedMacro(summary.deltaPercent)}% no período`} /><StatusTile label="Aderência calórica" value={formatPercent(adherencePercent)} hint="Média do mesmo intervalo analisado." /></div>{chartData.length > 1 ? <div data-chart="weight-line" className="h-[260px] rounded-2xl border bg-background p-4 shadow-sm"><ResponsiveContainer width="100%" height="100%"><LineChart data={chartData}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="label" /><YAxis domain={["dataMin - 1", "dataMax + 1"]} /><Tooltip formatter={value => `${formatMacro(Number(value))} kg`} /><Legend /><Line type="linear" dataKey="weightKg" name="Peso" stroke="#16a34a" strokeWidth={3} dot /></LineChart></ResponsiveContainer></div> : <EmptyState>Registre pelo menos dois pesos no período para visualizar a curva de evolução. O registro atual já aparece nas métricas acima.</EmptyState>}<div className="rounded-2xl border bg-muted/20 p-4 text-sm leading-6 text-muted-foreground">{summary.trendMessage} A aderência calórica média do período foi de {formatPercent(adherencePercent)}.</div></> : <EmptyState>Ainda não há registros de peso no período selecionado. Registre seu peso para acompanhar a evolução junto da aderência calórica.</EmptyState>}</CardContent></Card>; }
function SupportHabitsCard({ waterConsumedMl, waterGoalMl, waterHitDays, exerciseActiveDays, exerciseCalories, dayCount, trendData }: { waterConsumedMl: number; waterGoalMl: number; waterHitDays: number; exerciseActiveDays: number; exerciseCalories: number; dayCount: number; trendData: TrendPoint[] }) { const waterAdherencePercent = progressPercent(waterConsumedMl, waterGoalMl); const averageDailyWaterMl = dayCount > 0 ? waterConsumedMl / dayCount : 0; const daysWithExercise = trendData.filter(day => day.exerciseCalories > 0); const daysWithoutExercise = trendData.filter(day => day.exerciseCalories <= 0); const adjustedGoalWithExercise = averageTrendValue(daysWithExercise, day => day.goalCalories); const adjustedGoalWithoutExercise = averageTrendValue(daysWithoutExercise, day => day.goalCalories); const adherenceWithExercise = averageTrendValue(daysWithExercise, day => day.adherencePercent); const adherenceWithoutExercise = averageTrendValue(daysWithoutExercise, day => day.adherencePercent); return <Card className="border-0 shadow-sm"><SectionHeader icon={<TrendingUp className="h-5 w-5 text-primary" />} title="Água e exercícios como apoio" description="Hábitos de suporte aparecem junto da meta ajustada para explicar o contexto do período, sem virar detalhe de treino." /><CardContent className="grid gap-4 lg:grid-cols-2"><div className="rounded-2xl border bg-background p-4 shadow-sm"><div className="mb-3 flex items-center justify-between gap-3"><p className="flex items-center gap-2 text-sm font-medium"><Droplets className="h-4 w-4 text-primary" /> Água vs meta</p><span className="text-sm text-muted-foreground">{formatPercent(waterAdherencePercent)}</span></div><Progress className="h-2" value={waterAdherencePercent} /><div className="mt-4 grid gap-3 sm:grid-cols-2"><StatusTile label="Consumido" value={formatCountPtBr(Math.round(waterConsumedMl), " ml")} /><StatusTile label="Média diária" value={formatCountPtBr(Math.round(averageDailyWaterMl), " ml")} /><StatusTile label="Aderência à água" value={formatPercent(waterAdherencePercent)} /><StatusTile label="Meta batida" value={`${waterHitDays}/${dayCount} dias`} /></div>{waterConsumedMl <= 0 ? <div className="mt-4"><EmptyState>Ainda não há registros de água no período selecionado.</EmptyState></div> : null}</div><div className="rounded-2xl border bg-background p-4 shadow-sm"><p className="mb-4 flex items-center gap-2 text-sm font-medium"><Dumbbell className="h-4 w-4 text-primary" /> Exercícios e meta ajustada</p><div className="grid gap-3 sm:grid-cols-2"><StatusTile label="Dias ativos" value={`${exerciseActiveDays}/${dayCount}`} /><StatusTile label="Gasto estimado" value={formatCalories(exerciseCalories)} /><StatusTile label="Meta em dias ativos" value={adjustedGoalWithExercise == null ? "-" : formatCalories(adjustedGoalWithExercise)} hint="Média da meta ajustada nos dias com exercício." /><StatusTile label="Meta sem exercício" value={adjustedGoalWithoutExercise == null ? "-" : formatCalories(adjustedGoalWithoutExercise)} hint="Média da meta ajustada nos dias sem exercício." /><StatusTile label="Aderência em dias ativos" value={adherenceWithExercise == null ? "-" : formatPercent(adherenceWithExercise)} /><StatusTile label="Aderência sem exercício" value={adherenceWithoutExercise == null ? "-" : formatPercent(adherenceWithoutExercise)} /></div>{exerciseActiveDays <= 0 ? <div className="mt-4"><EmptyState>Ainda não há exercícios registrados neste período. Quando houver, eles entram na leitura da meta ajustada.</EmptyState></div> : null}</div></CardContent></Card>; }

export default function ReportsGoalsPage() {
  const userTimeZone = React.useMemo(() => getBrowserTimeZone(), []);
  const [periodScope, setPeriodScope] = React.useState<PeriodScope>("week");
  const [selectedDay, setSelectedDay] = React.useState(() => toDateInputValue());
  const [selectedMonth, setSelectedMonth] = React.useState(() => toMonthInputValue(new Date(), userTimeZone));
  const [rangeStart, setRangeStart] = React.useState(() => toDateInputValue(new Date(Date.now() - 13 * 24 * 60 * 60 * 1000), userTimeZone));
  const [rangeEnd, setRangeEnd] = React.useState(() => toDateInputValue());
  const activeRange = React.useMemo(() => periodScope === "day" ? { start: selectedDay, end: selectedDay } : periodScope === "week" ? getWeekRange(selectedDay) : periodScope === "month" ? getMonthRange(selectedMonth) : normalizeDateRange(rangeStart, rangeEnd), [periodScope, rangeEnd, rangeStart, selectedDay, selectedMonth]);
  const weekOffset = React.useMemo(() => getWeekOffsetFromToday(selectedDay, userTimeZone), [selectedDay, userTimeZone]);
  const reportBundle = trpc.nutrition.reports.bundle.useQuery({ weekOffset }, { enabled: periodScope === "week" });
  const periodBundle = trpc.nutrition.reports.periodBundle.useQuery({ startDate: activeRange.start, endDate: activeRange.end }, { enabled: periodScope !== "week" });
  const weeklyDays = (reportBundle.data?.weekly ?? []) as PeriodReportDay[];
  const periodDaily = (periodBundle.data?.daily ?? []) as PeriodReportDay[];
  const activeDays = periodScope === "week" ? weeklyDays : periodDaily;
  const dayCount = periodScope === "week" ? 7 : periodDaily.length || countDaysInRange(activeRange);
  const periodTotals = (periodBundle.data?.totals ?? EMPTY_TOTALS) as ReportTotals;
  const periodGoal = (periodBundle.data?.goal ?? EMPTY_TOTALS) as ReportTotals;
  const trendData = activeDays.map(day => toTrendPoint(day));
  const calorieAdherence = calculateCalorieAdherence(trendData, dayCount);
  const consumedMacros: MacroTotals = periodScope === "week" ? { protein: weeklyDays.reduce((total, day) => total + Number(day.protein ?? 0), 0), carbs: weeklyDays.reduce((total, day) => total + Number(day.carbs ?? 0), 0), fat: weeklyDays.reduce((total, day) => total + Number(day.fat ?? 0), 0) } : { protein: periodTotals.protein, carbs: periodTotals.carbs, fat: periodTotals.fat };
  const totalCalories = periodScope === "week" ? weeklyDays.reduce((total, day) => total + Number(day.calories ?? 0), 0) : periodTotals.calories;
  const totalGoalCalories = trendData.reduce((total, day) => total + Number(day.goalCalories ?? 0), 0);
  const macroMetrics = calculateMacroMetrics(normalizeMacroDays(activeDays, periodGoal), periodScope === "week" ? normalizeWeightPoints(reportBundle.data?.progress?.weight) : normalizeWeightPoints((periodBundle.data as any)?.weightTrend));
  const selectedWeightDates = new Set(trendData.map(day => day.date));
  const periodWeightBundle = (periodBundle.data as unknown as { weightTrend?: WeightTrendBundle } | undefined)?.weightTrend;
  const periodWeightEntries = buildWeightPointsFromEntries(periodWeightBundle?.points, selectedWeightDates);
  const weightPoints = periodScope === "week" ? buildWeightPointsFromSummary(reportBundle.data?.progress?.weight, selectedWeightDates) : periodWeightEntries.length ? periodWeightEntries : buildWeightPointsFromSummary(periodWeightBundle?.summary, selectedWeightDates);
  const waterConsumedMl = periodScope === "week" ? weeklyDays.reduce((total, day) => total + Number(day.waterConsumedMl ?? 0), 0) : (periodBundle.data as any)?.habitAnalytics?.water?.totalConsumedMl ?? 0;
  const waterGoalMl = periodScope === "week" ? weeklyDays.reduce((total, day) => total + Number(day.waterGoalMl ?? 0), 0) : (periodBundle.data as any)?.habitAnalytics?.water?.totalGoalMl ?? 0;
  const waterHitDays = periodScope === "week" ? weeklyDays.filter(day => Number(day.waterGoalMl ?? 0) > 0 && Number(day.waterConsumedMl ?? 0) >= Number(day.waterGoalMl ?? 0)).length : (periodBundle.data as any)?.habitAnalytics?.water?.goalHitDays ?? 0;
  const exerciseActiveDays = periodScope === "week" ? weeklyDays.filter(day => Number(day.exerciseCalories ?? 0) > 0).length : (periodBundle.data as any)?.habitAnalytics?.exercise?.activeDays ?? 0;
  const exerciseCalories = periodScope === "week" ? weeklyDays.reduce((total, day) => total + Number(day.exerciseCalories ?? 0), 0) : (periodBundle.data as any)?.habitAnalytics?.exercise?.totalCalories ?? 0;
  const weeklyQuality = reportBundle.data?.quality;
  const foodQuality = periodScope === "week" ? weeklyQuality?.foodQuality : (periodBundle.data as any)?.quality?.foodQuality as FoodQualitySummary | undefined;
  const qualityValue = foodQuality?.qualityIndex == null ? "-" : formatPercent(foodQuality.qualityIndex);
  const weightSummary = calculateWeightTrendSummary(weightPoints);
  const weightSummaryValue = weightSummary.hasData && weightSummary.deltaKg != null ? `${formatSignedMacro(weightSummary.deltaKg)} kg` : "-";
  const isLoading = periodScope === "week" ? reportBundle.isLoading : periodBundle.isLoading;
  const isError = periodScope === "week" ? reportBundle.isError : periodBundle.isError;
  const reportsHeading = buildReportsHeading(periodScope);
  const summaryMetrics: Metric[] = [
    { title: "Aderência calórica", value: formatPercent(calorieAdherence.adherencePercent), description: `${calorieAdherence.daysWithinRange}/${dayCount} dias dentro da faixa ideal.` },
    { title: "Média consumida", value: formatCalories(calorieAdherence.averageCalories), description: "Consumo diário médio no período selecionado." },
    { title: "Média da meta ajustada", value: formatCalories(calorieAdherence.averageGoalCalories), description: "Meta média após considerar exercícios registrados." },
    { title: "Desvio médio", value: formatCalories(calorieAdherence.averageDeltaCalories), description: "Diferença diária média entre consumo e meta ajustada." },
    { title: "Variação de peso", value: weightSummaryValue, description: weightSummary.hasData ? `${formatSignedMacro(weightSummary.deltaPercent)}% no período.` : "Sem registros suficientes no período." },
    { title: "Qualidade alimentar", value: qualityValue, description: foodQuality?.hasData ? `${foodQuality.daysWithRecords}/${dayCount} dias com registros e ${formatPercent(foodQuality.unclassifiedCaloriesPercent)} não classificados.` : "Sem dados classificados suficientes no período." },
    { title: "Água", value: formatPercent(progressPercent(waterConsumedMl, waterGoalMl)), description: `${waterHitDays}/${dayCount} dias com meta batida; ${formatCountPtBr(Math.round(waterConsumedMl), " ml")} no total.` },
    { title: "Exercícios", value: `${exerciseActiveDays}/${dayCount} dias`, description: `${formatCalories(exerciseCalories)} estimadas e consideradas na meta ajustada.` },
  ];

  return <DashboardLayout><div className="space-y-6"><PageIntro eyebrow="Relatórios" title={reportsHeading.title} description={`${reportsHeading.description} Intervalo ativo: ${formatRangeLabel(activeRange)}.`} stats={<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6"><SummaryPill label="Consumido" value={formatCalories(totalCalories)} /><SummaryPill label="Meta ajustada" value={formatCalories(totalGoalCalories)} /><SummaryPill label="Aderência" value={formatPercent(calorieAdherence.adherencePercent)} /><SummaryPill label="Proteínas" value={formatMacroGrams(consumedMacros.protein)} /><SummaryPill label="Carboidratos" value={formatMacroGrams(consumedMacros.carbs)} /><SummaryPill label="Gorduras" value={formatMacroGrams(consumedMacros.fat)} /></div>} actions={<PeriodScopeSelector scope={periodScope} onScopeChange={setPeriodScope} selectedDay={selectedDay} onSelectedDayChange={setSelectedDay} selectedMonth={selectedMonth} onSelectedMonthChange={setSelectedMonth} rangeStart={rangeStart} onRangeStartChange={setRangeStart} rangeEnd={rangeEnd} onRangeEndChange={setRangeEnd} />} />{isLoading ? <div className="grid gap-4 lg:grid-cols-4"><Skeleton className="h-32 rounded-2xl" /><Skeleton className="h-32 rounded-2xl" /><Skeleton className="h-32 rounded-2xl" /><Skeleton className="h-32 rounded-2xl" /></div> : null}{isError ? <div className="rounded-2xl border bg-muted/20 p-6 text-sm leading-6 text-muted-foreground">Não foi possível carregar os relatórios agora. Tente novamente em instantes.</div> : null}{!isLoading && !isError ? <><section className="space-y-4"><div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-xl font-semibold tracking-tight">Resumo do período</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">Os principais sinais ficam juntos para mostrar rapidamente se o período está alinhado às metas.</p></div><Badge variant="outline" className="rounded-full px-3 py-1 text-xs uppercase">Orientado a metas</Badge></div><MetricGrid metrics={summaryMetrics} /></section><MacroAdherenceSection title={periodScope === "week" ? "Aderência semanal às metas" : periodScope === "day" ? "Aderência diária às metas" : periodScope === "month" ? "Aderência mensal às metas" : "Aderência do período às metas"} description="Calorias, proteínas, carboidratos e gorduras usam metas e consumo próprios para o intervalo ativo." metrics={macroMetrics} /><PlannedVsRealizedMacrosSection metrics={macroMetrics} /><CalorieAdherenceCard trendData={trendData} dayCount={dayCount} /><CalorieTrendChart trendData={trendData} /><QualityCard proteinGrams={weeklyQuality?.proteinGrams ?? consumedMacros.protein} fiberGrams={weeklyQuality?.fiberGrams} fruitServings={weeklyQuality?.fruitServings} vegetableServings={weeklyQuality?.vegetableServings} ultraProcessedServings={weeklyQuality?.ultraProcessedServings} regularityScore={weeklyQuality?.regularityScore} foodQuality={foodQuality} /><WeightCard points={weightPoints} adherencePercent={calorieAdherence.adherencePercent} /><SupportHabitsCard waterConsumedMl={waterConsumedMl} waterGoalMl={waterGoalMl} waterHitDays={waterHitDays} exerciseActiveDays={exerciseActiveDays} exerciseCalories={exerciseCalories} dayCount={dayCount} trendData={trendData} /><DailyCalorieBreakdown trendData={trendData} scope={periodScope} /></> : null}</div></DashboardLayout>;
}
