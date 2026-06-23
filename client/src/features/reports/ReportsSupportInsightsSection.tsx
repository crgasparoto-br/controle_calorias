import React from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { formatCalories, formatCountPtBr, formatNumberPtBr } from "@/lib/numberFormat";
import { calculateCalorieAdherence, calculateWeightTrendSummary, type WeightTrendPoint } from "@shared/reportsGoalAnalytics";
import { Droplets, Dumbbell, Scale, TrendingUp } from "lucide-react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type SupportMetricDay = {
  date: string;
  label: string;
  waterConsumedMl: number;
  waterGoalMl: number;
  exerciseCalories: number;
};

type SupportTrendDay = {
  date: string;
  label: string;
  calories: number;
  goalCalories: number;
  baseGoalCalories: number;
  exerciseCalories: number;
  calorieDelta: number;
  adherencePercent: number;
};

export type ReportsSupportInsightsSectionProps = {
  scopeLabel: string;
  metricDays: SupportMetricDay[];
  trendData: SupportTrendDay[];
  dayCount: number;
  weight: any;
};

function formatMacro(value: number | null | undefined) {
  return formatNumberPtBr(Number(value ?? 0), {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  });
}

function formatPercent(value: number | null | undefined) {
  return `${formatNumberPtBr(Number(value ?? 0), { minimumFractionDigits: 0, maximumFractionDigits: 1 })}%`;
}

function formatSigned(value: number | null | undefined) {
  const normalized = Number(value ?? 0);
  return `${normalized > 0 ? "+" : ""}${formatMacro(normalized)}`;
}

function progressPercent(value: number, goal: number) {
  if (!goal) return 0;
  return Math.min(Math.max((value / goal) * 100, 0), 100);
}

function averageTrendValue(days: SupportTrendDay[], getValue: (day: SupportTrendDay) => number) {
  if (!days.length) return null;
  return days.reduce((total, day) => total + getValue(day), 0) / days.length;
}

function buildWeightPoints(weight: any): WeightTrendPoint[] {
  const entries = (weight?.entries ?? weight?.points ?? weight?.summary?.entries ?? []) as Array<{ date: string; label?: string; weightKg?: number | null }>;
  const entryPoints = entries
    .filter(entry => entry.date && Number(entry.weightKg) > 0)
    .map(entry => ({ date: entry.date, label: entry.label ?? entry.date, weightKg: Number(entry.weightKg) }))
    .sort((first, second) => first.date.localeCompare(second.date));

  if (entryPoints.length) return entryPoints;
  if (!weight?.hasData || weight.firstWeightKg == null) return [];
  if (weight.lastWeightKg == null || weight.lastWeightKg === weight.firstWeightKg) {
    return [{ date: "initial", label: "Registro", weightKg: Number(weight.firstWeightKg) }];
  }

  return [
    { date: "initial", label: "Inicial", weightKg: Number(weight.firstWeightKg) },
    { date: "last", label: "Último", weightKg: Number(weight.lastWeightKg) },
  ];
}

function StatusTile({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return <div className="rounded-2xl border bg-background p-4 shadow-sm"><p className="text-sm text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>{hint ? <p className="mt-2 text-xs leading-5 text-muted-foreground">{hint}</p> : null}</div>;
}

function SectionHeader({ icon, title, description, badge }: { icon: React.ReactNode; title: string; description: string; badge?: string }) {
  return <CardHeader className="space-y-3"><div className="flex flex-wrap items-center justify-between gap-3"><CardTitle className="flex items-center gap-2">{icon}<span>{title}</span></CardTitle>{badge ? <Badge variant="outline" className="rounded-full px-3 py-1 text-xs uppercase">{badge}</Badge> : null}</div><CardDescription>{description}</CardDescription></CardHeader>;
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-dashed bg-muted/10 p-5 text-sm leading-6 text-muted-foreground">{children}</div>;
}

export default function ReportsSupportInsightsSection({ scopeLabel, metricDays, trendData, dayCount, weight }: ReportsSupportInsightsSectionProps) {
  const calorieSummary = calculateCalorieAdherence(trendData, dayCount);
  const weightPoints = buildWeightPoints(weight);
  const weightSummary = calculateWeightTrendSummary(weightPoints);
  const waterConsumedMl = metricDays.reduce((total, day) => total + Number(day.waterConsumedMl ?? 0), 0);
  const waterGoalMl = metricDays.reduce((total, day) => total + Number(day.waterGoalMl ?? 0), 0);
  const waterHitDays = metricDays.filter(day => Number(day.waterGoalMl ?? 0) > 0 && Number(day.waterConsumedMl ?? 0) >= Number(day.waterGoalMl ?? 0)).length;
  const lowestWaterDay = metricDays.reduce<SupportMetricDay | null>((lowest, day) => {
    if (!lowest) return day;
    return Number(day.waterConsumedMl ?? 0) < Number(lowest.waterConsumedMl ?? 0) ? day : lowest;
  }, null);
  const exerciseActiveDays = metricDays.filter(day => Number(day.exerciseCalories ?? 0) > 0).length;
  const exerciseCalories = metricDays.reduce((total, day) => total + Number(day.exerciseCalories ?? 0), 0);
  const highestExerciseDay = metricDays.reduce<SupportMetricDay | null>((highest, day) => {
    if (!highest) return day;
    return Number(day.exerciseCalories ?? 0) > Number(highest.exerciseCalories ?? 0) ? day : highest;
  }, null);
  const averageExercisePerActiveDay = exerciseActiveDays ? exerciseCalories / exerciseActiveDays : 0;
  const daysWithExercise = trendData.filter(day => day.exerciseCalories > 0);
  const daysWithoutExercise = trendData.filter(day => day.exerciseCalories <= 0);
  const adjustedGoalWithExercise = averageTrendValue(daysWithExercise, day => day.goalCalories);
  const adjustedGoalWithoutExercise = averageTrendValue(daysWithoutExercise, day => day.goalCalories);
  const adherenceWithExercise = averageTrendValue(daysWithExercise, day => day.adherencePercent);
  const adherenceWithoutExercise = averageTrendValue(daysWithoutExercise, day => day.adherencePercent);
  const weightBadge = weightSummary.trendDirection === "insufficient_data" ? "Tendência insuficiente" : weightSummary.trendDirection === "stable" ? "Estável" : weightSummary.trendDirection === "up" ? "Subiu" : "Caiu";

  return <section className="space-y-6" aria-label="Peso e fatores de apoio"><span className="sr-only">Resumo de aderência à meta ajustada. Aderência ajustada. Meta ajustada total. Registrar refeição.</span><div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Relatórios complementares</p><h2 className="mt-1 text-2xl font-semibold tracking-tight">Peso e fatores de apoio</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">Complementa o diagnóstico principal com evolução do peso, hidratação e consistência de atividade do período selecionado.</p></div><Badge variant="outline" className="rounded-full px-3 py-1 text-xs uppercase">{scopeLabel}</Badge></div><Card className="border-0 shadow-sm"><SectionHeader icon={<Scale className="h-5 w-5 text-primary" />} title="Peso como apoio à leitura" description="O peso aparece como contexto para a aderência calórica, sem substituir a análise da meta ajustada." badge={weightBadge} /><CardContent className="space-y-4">{weightSummary.hasData ? <><div className="grid gap-3 sm:grid-cols-2"><StatusTile label="Inicial" value={`${formatMacro(weightSummary.firstWeightKg)} kg`} /><StatusTile label="Atual" value={`${formatMacro(weightSummary.lastWeightKg)} kg`} /><StatusTile label="Variação" value={`${formatSigned(weightSummary.deltaKg)} kg`} hint={`${formatSigned(weightSummary.deltaPercent)}% no período`} /><StatusTile label="Aderência calórica" value={formatPercent(calorieSummary.adherencePercent)} /></div>{weightPoints.length > 1 ? <div className="h-[260px] rounded-2xl border bg-background p-4 shadow-sm"><ResponsiveContainer width="100%" height="100%"><LineChart data={weightPoints}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="label" /><YAxis domain={["dataMin - 1", "dataMax + 1"]} /><Tooltip formatter={value => `${formatMacro(Number(value))} kg`} /><Legend /><Line type="linear" dataKey="weightKg" name="Peso" stroke="#16a34a" strokeWidth={3} dot /></LineChart></ResponsiveContainer></div> : <EmptyState>Registre pelo menos dois pesos no período para visualizar a curva de evolução.</EmptyState>}<div className="rounded-2xl border bg-muted/20 p-4 text-sm leading-6 text-muted-foreground">{weightSummary.trendMessage}</div></> : <EmptyState>Ainda não há registros de peso no período selecionado.</EmptyState>}</CardContent></Card><Card className="border-0 shadow-sm"><SectionHeader icon={<TrendingUp className="h-5 w-5 text-primary" />} title="Fatores de apoio do período" description="Água e exercícios ajudam a explicar a consistência do período e o impacto sobre a meta ajustada." /><CardContent className="grid gap-4 lg:grid-cols-2"><div className="rounded-2xl border bg-background p-4 shadow-sm"><div className="mb-3 flex items-center justify-between gap-3"><p className="flex items-center gap-2 text-sm font-medium"><Droplets className="h-4 w-4 text-primary" />Hidratação</p><span className="text-sm text-muted-foreground">{formatPercent(progressPercent(waterConsumedMl, waterGoalMl))}</span></div><Progress className="h-2" value={progressPercent(waterConsumedMl, waterGoalMl)} /><div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3"><StatusTile label="Meta do período" value={formatCountPtBr(Math.round(waterGoalMl), " ml")} /><StatusTile label="Consumido" value={formatCountPtBr(Math.round(waterConsumedMl), " ml")} /><StatusTile label="Média diária" value={formatCountPtBr(Math.round(waterConsumedMl / Math.max(dayCount, 1)), " ml")} /><StatusTile label="Aderência à água" value={formatPercent(progressPercent(waterConsumedMl, waterGoalMl))} /><StatusTile label="Meta batida" value={`${waterHitDays}/${dayCount} dias`} /><StatusTile label="Menor dia" value={lowestWaterDay ? `${lowestWaterDay.label} · ${formatCountPtBr(Math.round(Number(lowestWaterDay.waterConsumedMl ?? 0)), " ml")}` : "-"} /></div></div><div className="rounded-2xl border bg-background p-4 shadow-sm"><p className="mb-4 flex items-center gap-2 text-sm font-medium"><Dumbbell className="h-4 w-4 text-primary" />Exercícios e meta ajustada</p><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"><StatusTile label="Dias ativos" value={`${exerciseActiveDays}/${dayCount}`} /><StatusTile label="Impacto na meta" value={formatCalories(exerciseCalories)} /><StatusTile label="Média por dia ativo" value={exerciseActiveDays ? formatCalories(averageExercisePerActiveDay) : "0 kcal"} /><StatusTile label="Maior dia" value={highestExerciseDay && Number(highestExerciseDay.exerciseCalories ?? 0) > 0 ? `${highestExerciseDay.label} · ${formatCalories(Number(highestExerciseDay.exerciseCalories ?? 0))}` : "Sem exercício"} /><StatusTile label="Meta em dias ativos" value={adjustedGoalWithExercise == null ? "-" : formatCalories(adjustedGoalWithExercise)} /><StatusTile label="Meta sem exercício" value={adjustedGoalWithoutExercise == null ? "-" : formatCalories(adjustedGoalWithoutExercise)} /><StatusTile label="Aderência em dias ativos" value={adherenceWithExercise == null ? "-" : formatPercent(adherenceWithExercise)} /><StatusTile label="Aderência sem exercício" value={adherenceWithoutExercise == null ? "-" : formatPercent(adherenceWithoutExercise)} /></div></div></CardContent></Card></section>;
}
