import React from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { getWeekOffsetFromToday } from "@/lib/dateRanges";
import { getBrowserTimeZone, toDateInputValue } from "@/lib/dateTime";
import { formatCalories, formatCountPtBr, formatNumberPtBr } from "@/lib/numberFormat";
import { trpc } from "@/lib/trpc";
import {
  calculateCalorieAdherence,
  calculateWeightTrendSummary,
  type FoodQualitySummary,
  type WeightTrendPoint,
} from "@shared/reportsGoalAnalytics";
import { BarChart3, Droplets, Dumbbell, Leaf, Scale, Target, TrendingUp } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type WeekReportDay = Record<string, any> & {
  date: string;
  label: string;
  calories: number;
  goalCalories: number;
  adjustedGoalCalories?: number | null;
  exerciseCalories?: number | null;
  waterConsumedMl?: number | null;
  waterGoalMl?: number | null;
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

const EMPTY_FOOD_DISTRIBUTION = [
  { key: "naturalOrMinimallyProcessed", label: "In natura/minimamente processados", calories: 0, percent: 0 },
  { key: "ultraProcessed", label: "Ultraprocessados", calories: 0, percent: 0 },
  { key: "unclassified", label: "Não classificados", calories: 0, percent: 0 },
];

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

function getCalorieBarColor(calories: number, goalCalories: number) {
  if (!goalCalories || !calories) return "#cbd5e1";
  const ratio = calories / goalCalories;
  if (ratio > 1.05) return "#dc2626";
  if (ratio < 0.9) return "#f59e0b";
  return "#16a34a";
}

function averageTrendValue(days: TrendPoint[], getValue: (day: TrendPoint) => number) {
  if (!days.length) return null;
  return days.reduce((total, day) => total + getValue(day), 0) / days.length;
}

function toTrendPoint(day: WeekReportDay): TrendPoint {
  const adjustedGoalCalories = Number(day.adjustedGoalCalories ?? day.goalCalories ?? 0);
  const calories = Number(day.calories ?? 0);

  return {
    date: day.date,
    label: day.label,
    calories: Math.round(calories),
    goalCalories: adjustedGoalCalories,
    baseGoalCalories: Number(day.goalCalories ?? 0),
    exerciseCalories: Math.round(Number(day.exerciseCalories ?? 0)),
    calorieDelta: Math.round(calories - adjustedGoalCalories),
    adherencePercent: adjustedGoalCalories > 0 ? (calories / adjustedGoalCalories) * 100 : 0,
  };
}

function buildWeightPoints(weight: any): WeightTrendPoint[] {
  const entries = (weight?.entries ?? []) as Array<{ date: string; label?: string; weightKg?: number | null }>;
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
  return (
    <div className="rounded-2xl border bg-background p-4 shadow-sm">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
      {hint ? <p className="mt-2 text-xs leading-5 text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function SectionHeader({ icon, title, description, badge }: { icon: React.ReactNode; title: string; description: string; badge?: string }) {
  return (
    <CardHeader className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <CardTitle className="flex items-center gap-2">
          {icon}
          <span>{title}</span>
        </CardTitle>
        {badge ? <Badge variant="outline" className="rounded-full px-3 py-1 text-xs uppercase">{badge}</Badge> : null}
      </div>
      <CardDescription>{description}</CardDescription>
    </CardHeader>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-dashed bg-muted/10 p-5 text-sm leading-6 text-muted-foreground">{children}</div>;
}

export default function ReportsGoalInsightsPanel() {
  const userTimeZone = React.useMemo(() => getBrowserTimeZone(), []);
  const selectedDay = React.useMemo(() => toDateInputValue(), []);
  const weekOffset = React.useMemo(() => getWeekOffsetFromToday(selectedDay, userTimeZone), [selectedDay, userTimeZone]);
  const reportBundle = trpc.nutrition.reports.bundle.useQuery({ weekOffset });

  if (reportBundle.isLoading) {
    return <section className="mt-6 grid gap-4 lg:grid-cols-3"><Skeleton className="h-32 rounded-2xl" /><Skeleton className="h-32 rounded-2xl" /><Skeleton className="h-32 rounded-2xl" /></section>;
  }

  if (reportBundle.isError || !reportBundle.data) {
    return null;
  }

  const weeklyDays = (reportBundle.data.weekly ?? []) as WeekReportDay[];
  const trendData = weeklyDays.map(day => toTrendPoint(day));
  const dayCount = 7;
  const calorieSummary = calculateCalorieAdherence(trendData, dayCount);
  const foodQuality = reportBundle.data.quality?.foodQuality as FoodQualitySummary | undefined;
  const foodDistribution = foodQuality?.distribution?.length ? foodQuality.distribution : EMPTY_FOOD_DISTRIBUTION;
  const weightPoints = buildWeightPoints(reportBundle.data.progress?.weight);
  const weightSummary = calculateWeightTrendSummary(weightPoints);
  const waterConsumedMl = weeklyDays.reduce((total, day) => total + Number(day.waterConsumedMl ?? 0), 0);
  const waterGoalMl = weeklyDays.reduce((total, day) => total + Number(day.waterGoalMl ?? 0), 0);
  const waterHitDays = weeklyDays.filter(day => Number(day.waterGoalMl ?? 0) > 0 && Number(day.waterConsumedMl ?? 0) >= Number(day.waterGoalMl ?? 0)).length;
  const exerciseActiveDays = weeklyDays.filter(day => Number(day.exerciseCalories ?? 0) > 0).length;
  const exerciseCalories = weeklyDays.reduce((total, day) => total + Number(day.exerciseCalories ?? 0), 0);
  const daysWithExercise = trendData.filter(day => day.exerciseCalories > 0);
  const daysWithoutExercise = trendData.filter(day => day.exerciseCalories <= 0);
  const adjustedGoalWithExercise = averageTrendValue(daysWithExercise, day => day.goalCalories);
  const adjustedGoalWithoutExercise = averageTrendValue(daysWithoutExercise, day => day.goalCalories);
  const adherenceWithExercise = averageTrendValue(daysWithExercise, day => day.adherencePercent);
  const adherenceWithoutExercise = averageTrendValue(daysWithoutExercise, day => day.adherencePercent);
  const weightBadge = weightSummary.trendDirection === "insufficient_data" ? "Tendência insuficiente" : weightSummary.trendDirection === "stable" ? "Estável" : weightSummary.trendDirection === "up" ? "Subiu" : "Caiu";

  return (
    <section className="mt-6 space-y-6" aria-label="Análise da meta ajustada">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Meta ajustada</p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight">Aderência, peso e qualidade alimentar</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            Esta leitura cruza a meta ajustada por exercícios com consumo, evolução do peso, qualidade dos alimentos e hábitos de apoio da semana atual.
          </p>
        </div>
        <Badge variant="outline" className="rounded-full px-3 py-1 text-xs uppercase">Semana atual</Badge>
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.9fr,1.1fr]">
        <Card className="border-0 shadow-sm">
          <SectionHeader icon={<Target className="h-5 w-5 text-primary" />} title="Resumo da meta ajustada" description="Mostra se o consumo ficou dentro da faixa esperada para a meta ajustada do dia." badge="90% a 105%" />
          <CardContent className="space-y-5">
            <div className="rounded-3xl border bg-muted/20 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="text-sm font-medium tracking-tight">Aderência média da semana</p>
                <p className="text-sm text-muted-foreground">{formatPercent(calorieSummary.adherencePercent)}</p>
              </div>
              <Progress className="h-2" value={Math.min(calorieSummary.adherencePercent, 100)} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <StatusTile label="Média consumida" value={formatCalories(calorieSummary.averageCalories)} />
              <StatusTile label="Média da meta ajustada" value={formatCalories(calorieSummary.averageGoalCalories)} />
              <StatusTile label="Desvio médio" value={formatCalories(calorieSummary.averageDeltaCalories)} />
              <StatusTile label="Dias na faixa" value={`${calorieSummary.daysWithinRange}/${dayCount}`} />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <StatusTile label="Abaixo" value={calorieSummary.daysBelowRange} />
              <StatusTile label="Acima" value={calorieSummary.daysAboveRange} />
              <StatusTile label="Sem registro" value={calorieSummary.daysWithoutRecords} />
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <SectionHeader icon={<BarChart3 className="h-5 w-5 text-primary" />} title="Consumido vs meta ajustada" description="A meta base aparece como referência; a meta ajustada considera o efeito dos exercícios registrados no dia." />
          <CardContent className="h-[410px]">
            {trendData.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={trendData} barSize={28}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="baseGoalCalories" name="Meta base" fill="#e2e8f0" radius={[8, 8, 0, 0]} />
                  <Bar dataKey="goalCalories" name="Meta ajustada" fill="#94a3b8" radius={[8, 8, 0, 0]} />
                  <Bar dataKey="calories" name="Consumido" radius={[8, 8, 0, 0]}>
                    {trendData.map(day => <Cell key={day.date} fill={getCalorieBarColor(day.calories, day.goalCalories)} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState>Ainda não há registros suficientes para desenhar o gráfico de aderência calórica.</EmptyState>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.95fr,1.05fr]">
        <Card className="border-0 shadow-sm">
          <SectionHeader icon={<Scale className="h-5 w-5 text-primary" />} title="Evolução do peso" description="O peso aparece como contexto para a aderência calórica, sem substituir a análise da meta ajustada." badge={weightBadge} />
          <CardContent className="space-y-4">
            {weightSummary.hasData ? (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <StatusTile label="Peso inicial" value={`${formatMacro(weightSummary.firstWeightKg)} kg`} />
                  <StatusTile label="Último peso" value={`${formatMacro(weightSummary.lastWeightKg)} kg`} />
                  <StatusTile label="Variação" value={`${formatSigned(weightSummary.deltaKg)} kg`} hint={`${formatSigned(weightSummary.deltaPercent)}% na semana`} />
                  <StatusTile label="Aderência calórica" value={formatPercent(calorieSummary.adherencePercent)} />
                </div>
                {weightPoints.length > 1 ? (
                  <div className="h-[260px] rounded-2xl border bg-background p-4 shadow-sm">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={weightPoints}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="label" />
                        <YAxis domain={["dataMin - 1", "dataMax + 1"]} />
                        <Tooltip formatter={value => `${formatMacro(Number(value))} kg`} />
                        <Legend />
                        <Line type="linear" dataKey="weightKg" name="Peso" stroke="#16a34a" strokeWidth={3} dot />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <EmptyState>Registre pelo menos dois pesos na semana para visualizar a curva de evolução.</EmptyState>
                )}
                <div className="rounded-2xl border bg-muted/20 p-4 text-sm leading-6 text-muted-foreground">{weightSummary.trendMessage}</div>
              </>
            ) : (
              <EmptyState>Ainda não há registros de peso na semana atual. Registre seu peso para acompanhar a evolução junto da aderência calórica.</EmptyState>
            )}
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <SectionHeader icon={<Leaf className="h-5 w-5 text-primary" />} title="Qualidade alimentar" description="Resume a composição dos alimentos da semana e separa itens não classificados para não distorcer os percentuais." badge="Alimentos" />
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <StatusTile label="Dias com frutas" value={`${foodQuality?.fruitDays ?? 0}/${foodQuality?.dayCount ?? dayCount}`} />
              <StatusTile label="Dias com legumes/verduras" value={`${foodQuality?.vegetableDays ?? 0}/${foodQuality?.dayCount ?? dayCount}`} />
              <StatusTile label="Índice de qualidade" value={foodQuality?.qualityIndex == null ? "-" : formatPercent(foodQuality.qualityIndex)} />
              <StatusTile label="In natura/minimamente" value={formatPercent(foodQuality?.naturalOrMinimallyProcessedCaloriesPercent)} />
              <StatusTile label="Ultraprocessados" value={formatPercent(foodQuality?.ultraProcessedCaloriesPercent)} />
            </div>
            {!foodQuality?.hasData ? <EmptyState>Ainda não há alimentos classificados suficientes para preencher estes indicadores na semana atual.</EmptyState> : null}
            <div className="grid gap-3 md:grid-cols-3">
              {foodDistribution.map(item => (
                <div key={item.key} className="rounded-2xl border bg-background p-4 shadow-sm">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <p className="text-sm font-medium">{item.label}</p>
                    <Badge variant="secondary" className="rounded-full">{formatPercent(item.percent)}</Badge>
                  </div>
                  <Progress className="h-2" value={item.percent} />
                  <p className="mt-3 text-sm text-muted-foreground">{formatCalories(item.calories)} na semana.</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-0 shadow-sm">
        <SectionHeader icon={<TrendingUp className="h-5 w-5 text-primary" />} title="Fatores de apoio da semana" description="Água e exercícios ajudam a explicar a meta ajustada e a consistência do período, mas ficam abaixo da análise principal." />
        <CardContent className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border bg-background p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="flex items-center gap-2 text-sm font-medium"><Droplets className="h-4 w-4 text-primary" />Hidratação</p>
              <span className="text-sm text-muted-foreground">{formatPercent(progressPercent(waterConsumedMl, waterGoalMl))}</span>
            </div>
            <Progress className="h-2" value={progressPercent(waterConsumedMl, waterGoalMl)} />
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <StatusTile label="Consumido" value={formatCountPtBr(Math.round(waterConsumedMl), " ml")} />
              <StatusTile label="Média diária" value={formatCountPtBr(Math.round(waterConsumedMl / dayCount), " ml")} />
              <StatusTile label="Aderência à água" value={formatPercent(progressPercent(waterConsumedMl, waterGoalMl))} />
              <StatusTile label="Meta batida" value={`${waterHitDays}/${dayCount} dias`} />
            </div>
          </div>
          <div className="rounded-2xl border bg-background p-4 shadow-sm">
            <p className="mb-4 flex items-center gap-2 text-sm font-medium"><Dumbbell className="h-4 w-4 text-primary" />Exercícios e ajuste da meta</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <StatusTile label="Dias ativos" value={`${exerciseActiveDays}/${dayCount}`} />
              <StatusTile label="Gasto estimado" value={formatCalories(exerciseCalories)} />
              <StatusTile label="Meta em dias ativos" value={adjustedGoalWithExercise == null ? "-" : formatCalories(adjustedGoalWithExercise)} />
              <StatusTile label="Meta sem exercício" value={adjustedGoalWithoutExercise == null ? "-" : formatCalories(adjustedGoalWithoutExercise)} />
              <StatusTile label="Aderência em dias ativos" value={adherenceWithExercise == null ? "-" : formatPercent(adherenceWithExercise)} />
              <StatusTile label="Aderência sem exercício" value={adherenceWithoutExercise == null ? "-" : formatPercent(adherenceWithoutExercise)} />
            </div>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
