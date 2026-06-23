import React, { Suspense, lazy } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { formatCalories, formatCountPtBr, formatNumberPtBr } from "@/lib/numberFormat";
import { BarChart3, CalendarDays, Droplets, Dumbbell, Scale } from "lucide-react";

const ReportTrendChart = lazy(() => import("@/features/reports/ReportTrendChart"));

export type ReportMacroMetric = {
  key: "calories" | "protein" | "carbs" | "fat";
  title: string;
  unit: "kcal" | "g";
  planned: number;
  realized: number;
  percent: number;
  difference: number;
  plannedPerKgDay: number | null;
  realizedPerKgDay: number | null;
};

export type ReportTrendDay = {
  date: string;
  label: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  /** Meta calórica principal do relatório. Deve representar a meta ajustada. */
  goalCalories: number;
  /** Meta original antes de somar exercícios. Opcional para relatórios antigos. */
  baseGoalCalories?: number;
  exerciseCalories?: number;
  calorieDelta?: number;
  adherencePercent?: number;
};

export type ReportWeightSummary = {
  hasData: boolean;
  firstWeightKg?: number | null;
  lastWeightKg?: number | null;
  deltaKg?: number | null;
};

export function formatMacro(value: number) {
  return formatNumberPtBr(value, { minimumFractionDigits: Number.isInteger(value) ? 0 : 1, maximumFractionDigits: 1 });
}

export function formatPercent(value: number) {
  return `${formatNumberPtBr(Math.round(value))}%`;
}

export function formatMacroGrams(value: number) {
  return `${formatMacro(value)} g`;
}

export function progressPercent(value: number, goal: number) {
  if (!goal) return 0;
  return Math.min(Math.max((value / goal) * 100, 0), 100);
}

export function averageValue(total: number, count: number) {
  return count ? total / count : 0;
}

function formatSigned(value: number, unit: "kcal" | "g") {
  const prefix = value > 0 ? "+" : "";
  return unit === "kcal" ? `${prefix}${formatCalories(value)}` : `${prefix}${formatMacro(value)} g`;
}

function formatSignedWeight(value: number) {
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${formatMacro(value)} kg`;
}

function formatPerKgDay(value: number | null) {
  if (value === null) return null;
  return `${formatNumberPtBr(value, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} g/kg/dia`;
}

function ChartFallback() {
  return <div className="flex h-full items-center justify-center rounded-2xl bg-muted/20 text-sm text-muted-foreground">Carregando gráfico...</div>;
}

export function ReportStatusTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border bg-background p-4 shadow-sm">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
    </div>
  );
}

export function ReportCompactMetric({ label, value }: { label: string | number; value: string | number }) {
  return (
    <div className="rounded-2xl border bg-muted/10 px-4 py-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold tracking-tight">{value}</p>
    </div>
  );
}

export function ReportHighlightCard({ title, value, description }: { title: string; value: string; description: string }) {
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

export function ReportEmptyState({ text }: { text: string }) {
  return <div className="rounded-2xl border border-dashed bg-muted/20 p-6 text-sm leading-6 text-muted-foreground">{text}</div>;
}

export function ReportMacroMetricCard({ metric, showPerKg = false }: { metric: ReportMacroMetric; showPerKg?: boolean }) {
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
          <ReportCompactMetric label="Planejado" value={plannedValue} />
          <ReportCompactMetric label="Realizado" value={realizedValue} />
          <ReportCompactMetric label="Diferença" value={formatSigned(metric.difference, metric.unit)} />
        </div>
        {showPerKg && metric.unit === "g" ? (
          plannedPerKg && realizedPerKg ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <ReportCompactMetric label="Planejado" value={plannedPerKg} />
              <ReportCompactMetric label="Realizado" value={realizedPerKg} />
            </div>
          ) : (
            <ReportEmptyState text="Informe um peso para calcular g/kg/dia deste período." />
          )
        ) : null}
      </CardContent>
    </Card>
  );
}

export function ReportMacroAdherenceSection({ title, description, metrics }: { title: string; description: string; metrics: ReportMacroMetric[] }) {
  return (
    <Card className="border-0 shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><CalendarDays className="h-5 w-5 text-primary" />{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
        {metrics.map(metric => <ReportMacroMetricCard key={metric.key} metric={metric} />)}
      </CardContent>
    </Card>
  );
}

export function ReportPlannedVsRealizedMacrosSection({ metrics }: { metrics: ReportMacroMetric[] }) {
  const macroMetrics = metrics.filter(metric => metric.unit === "g");

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader>
        <CardTitle>Macronutrientes planejados vs realizados</CardTitle>
        <CardDescription>Totais do período e média ponderada por peso de referência em g/kg/dia.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 xl:grid-cols-3">
        {macroMetrics.map(metric => <ReportMacroMetricCard key={metric.key} metric={metric} showPerKg />)}
      </CardContent>
    </Card>
  );
}

function AnalyticsHeader({ icon, title, scopeLabel, description }: { icon: React.ReactNode; title: string; scopeLabel: string; description: string }) {
  return (
    <CardHeader className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <CardTitle className="flex items-center gap-2">{icon}{title}</CardTitle>
        <Badge variant="outline" className="rounded-full px-3 py-1 text-xs uppercase tracking-wide">{scopeLabel}</Badge>
      </div>
      <CardDescription>{description}</CardDescription>
    </CardHeader>
  );
}

function AnalyticsReading({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border bg-background px-4 py-3 text-sm leading-6 text-muted-foreground">{children}</div>;
}

export function ReportWaterAnalyticsCard({ title, scopeLabel, description, totalConsumedMl, totalGoalMl, goalHitDays, totalDays, averageDailyMl, lowestDay, reading }: { title: string; scopeLabel: string; description: string; totalConsumedMl: number; totalGoalMl: number; goalHitDays: number; totalDays: number; averageDailyMl: number; lowestDay: string; reading: string }) {
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
          <ReportCompactMetric label="Meta do período" value={formatCountPtBr(Math.round(totalGoalMl), " ml")} />
          <ReportCompactMetric label="Consumo acumulado" value={formatCountPtBr(Math.round(totalConsumedMl), " ml")} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <ReportStatusTile label="Meta batida" value={`${goalHitDays}/${totalDays} dias`} />
          <ReportStatusTile label="Média diária" value={formatCountPtBr(Math.round(averageDailyMl), " ml")} />
          <ReportStatusTile label="Total consumido" value={formatCountPtBr(Math.round(totalConsumedMl), " ml")} />
          <ReportStatusTile label="Menor dia" value={lowestDay} />
        </div>
        <AnalyticsReading>{reading}</AnalyticsReading>
      </CardContent>
    </Card>
  );
}

export function ReportExerciseAnalyticsCard({ title, scopeLabel, description, activeDays, totalDays, totalCalories, detailLabel, detailValue, averageCaloriesPerActiveDay, highestDay, reading }: { title: string; scopeLabel: string; description: string; activeDays: number; totalDays: number; totalCalories: number; detailLabel: string; detailValue: string; averageCaloriesPerActiveDay: number; highestDay: string; reading: string }) {
  return (
    <Card className="border-0 shadow-sm">
      <AnalyticsHeader icon={<Dumbbell className="h-5 w-5 text-primary" />} title={title} scopeLabel={scopeLabel} description={description} />
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <ReportCompactMetric label="Dias ativos" value={`${activeDays}/${totalDays}`} />
          <ReportCompactMetric label="Gasto total" value={formatCalories(totalCalories)} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <ReportStatusTile label={detailLabel} value={detailValue} />
          <ReportStatusTile label="Média por dia ativo" value={activeDays ? formatCalories(averageCaloriesPerActiveDay) : "0 kcal"} />
          <ReportStatusTile label="Maior dia" value={highestDay} />
        </div>
        <AnalyticsReading>{reading}</AnalyticsReading>
      </CardContent>
    </Card>
  );
}

export function ReportTrendSection({ title, description, days }: { title: string; description: string; days: ReportTrendDay[] }) {
  if (!days.length) {
    return <ReportEmptyState text="Ainda não há dados suficientes no intervalo para desenhar a tendência." />;
  }

  const chartData = days.map(day => ({
    ...day,
    originalGoalCalories: day.baseGoalCalories ?? day.goalCalories,
  }));

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><BarChart3 className="h-5 w-5 text-primary" />{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-2xl border bg-muted/10 p-4 text-sm leading-6 text-muted-foreground">
          O gráfico mostra sempre as três referências: <strong className="font-semibold text-foreground">meta original</strong>, <strong className="font-semibold text-foreground">meta ajustada</strong> e consumo realizado. Quando não houver exercício no dia, as duas metas podem aparecer com a mesma altura.
        </div>
        <div className="h-[340px]">
          <Suspense fallback={<ChartFallback />}>
            <ReportTrendChart days={chartData} />
          </Suspense>
        </div>
      </CardContent>
    </Card>
  );
}

export function ReportWeightAdherenceCard({ summary, adherencePercent, emptyText = "Ainda não há peso registrado para compor a leitura do período." }: { summary: ReportWeightSummary; adherencePercent: number; emptyText?: string }) {
  return (
    <Card className="border bg-muted/10 shadow-none">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Scale className="h-5 w-5 text-primary" />Evolução do peso e aderência</CardTitle>
        <CardDescription>Relaciona o peso de referência usado no g/kg/dia com a aderência calórica do período.</CardDescription>
      </CardHeader>
      <CardContent>
        {summary.hasData ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <ReportStatusTile label="Inicial" value={`${formatMacro(summary.firstWeightKg ?? 0)} kg`} />
            <ReportStatusTile label="Atual" value={`${formatMacro(summary.lastWeightKg ?? 0)} kg`} />
            <ReportStatusTile label="Variação" value={formatSignedWeight(summary.deltaKg ?? 0)} />
            <ReportStatusTile label="Aderência calórica" value={formatPercent(adherencePercent)} />
          </div>
        ) : (
          <ReportEmptyState text={emptyText} />
        )}
      </CardContent>
    </Card>
  );
}
