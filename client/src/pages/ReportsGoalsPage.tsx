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
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Link } from "wouter";
import {
  calculateCalorieAdherence,
  calculateMacroAdherence,
  calculateMacroDaySummary,
  calculateWeightTrendSummary,
  type CalorieGoalDay,
  type FoodQualityDistributionItem,
  type FoodQualitySummary,
  type MacroGoalDay,
  type MacroTotals,
  type WeightTrendPoint,
} from "@shared/reportsGoalAnalytics";

type ReportTotals = MacroTotals & {
  calories: number;
};

type TrendPoint = CalorieGoalDay & {
  date: string;
  label: string;
  baseGoalCalories: number;
  exerciseCalories: number;
  calorieDelta: number;
  adherencePercent: number;
};

type PeriodReportDay = {
  date: string;
  label: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  exerciseCalories: number;
  goalCalories: number;
  adjustedGoalCalories: number;
  goalProtein: number;
  goalCarbs: number;
  goalFat: number;
  calorieDelta: number;
  adherencePercent: number;
};

type ExistingWeightSummary = {
  hasData: boolean;
  firstWeightKg?: number | null;
  lastWeightKg?: number | null;
  deltaKg?: number | null;
};

type WeightTrendBundle = {
  points?: WeightTrendPoint[];
  summary?: ExistingWeightSummary;
};

type ReportsQualityBundle = {
  foodQuality?: FoodQualitySummary;
};

const EMPTY_TOTALS: ReportTotals = { calories: 0, protein: 0, carbs: 0, fat: 0 };
const MACRO_COLORS: Record<keyof MacroTotals, string> = {
  protein: "#16a34a",
  carbs: "#0284c7",
  fat: "#d97706",
};
const EMPTY_FOOD_QUALITY_DISTRIBUTION: FoodQualityDistributionItem[] = [
  { key: "naturalOrMinimallyProcessed", label: "In natura/minimamente processados", calories: 0, percent: 0 },
  { key: "ultraProcessed", label: "Ultraprocessados", calories: 0, percent: 0 },
  { key: "unclassified", label: "Não classificados", calories: 0, percent: 0 },
];

function formatMacro(value: number) {
  return formatNumberPtBr(value, {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 1,
    maximumFractionDigits: 1,
  });
}

function formatSignedMacro(value: number | null | undefined) {
  const normalized = Number(value ?? 0);
  return `${normalized > 0 ? "+" : ""}${formatMacro(normalized)}`;
}

function formatPercent(value: number | null | undefined) {
  return `${formatNumberPtBr(value ?? 0, { maximumFractionDigits: 1 })}%`;
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

function toTrendPoint(day: {
  date: string;
  label: string;
  calories: number;
  goalCalories: number;
  adjustedGoalCalories?: number;
  exerciseCalories?: number;
  calorieDelta?: number;
  adherencePercent?: number;
}): TrendPoint {
  const adjustedGoalCalories = day.adjustedGoalCalories ?? day.goalCalories;
  return {
    date: day.date,
    label: day.label,
    calories: Math.round(day.calories),
    goalCalories: adjustedGoalCalories,
    baseGoalCalories: day.goalCalories,
    exerciseCalories: day.exerciseCalories ?? 0,
    calorieDelta: day.calorieDelta ?? Math.round(day.calories - adjustedGoalCalories),
    adherencePercent: day.adherencePercent ?? (adjustedGoalCalories > 0 ? (day.calories / adjustedGoalCalories) * 100 : 0),
  };
}

function buildWeightPointsFromSummary(weight?: ExistingWeightSummary): WeightTrendPoint[] {
  if (!weight?.hasData || weight.firstWeightKg == null) return [];
  if (weight.lastWeightKg == null || weight.lastWeightKg === weight.firstWeightKg) {
    return [{ date: "initial", label: "Registro", weightKg: weight.firstWeightKg }];
  }

  return [
    { date: "initial", label: "Inicial", weightKg: weight.firstWeightKg },
    { date: "last", label: "Último", weightKg: weight.lastWeightKg },
  ];
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
          <StatusTile label="Média da meta ajustada" value={formatCalories(summary.averageGoalCalories)} />
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
            <Bar dataKey="baseGoalCalories" name="Meta base" fill="#e2e8f0" radius={[8, 8, 0, 0]} />
            <Bar dataKey="goalCalories" name="Meta ajustada" fill="#94a3b8" radius={[8, 8, 0, 0]} />
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

function DailyCalorieBreakdown({ trendData }: { trendData: TrendPoint[] }) {
  if (!trendData.length) return null;

  return (
    <Card className="border-0 shadow-sm">
      <SectionHeader
        icon={<Target className="h-5 w-5 text-primary" />}
        title="Detalhe diário da meta ajustada"
        description="Cada dia mostra consumo, meta ajustada, diferença e percentual de aderência recalculados para o período selecionado."
      />
      <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {trendData.map(day => (
          <div key={day.date} className="rounded-2xl border bg-background p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="font-medium tracking-tight">{day.label}</p>
              <Badge variant="secondary" className="rounded-full">{formatPercent(day.adherencePercent)}</Badge>
            </div>
            <div className="grid gap-2 text-sm text-muted-foreground">
              <span>Consumido: <strong className="text-foreground">{formatCalories(day.calories)}</strong></span>
              <span>Meta ajustada: <strong className="text-foreground">{formatCalories(day.goalCalories)}</strong></span>
              <span>Diferença: <strong className="text-foreground">{formatCalories(day.calorieDelta)}</strong></span>
              {day.exerciseCalories > 0 ? <span>Exercícios adicionaram {formatCalories(day.exerciseCalories)} à meta.</span> : null}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function MacroAdherenceCard({
  consumed,
  planned,
  dailyMacros,
}: {
  consumed: MacroTotals;
  planned: MacroTotals;
  dailyMacros: MacroGoalDay[];
}) {
  const analysis = calculateMacroAdherence(consumed, planned);
  const dailySummary = calculateMacroDaySummary(dailyMacros);
  const hasMacroGoal = planned.protein > 0 || planned.carbs > 0 || planned.fat > 0;
  const chartData = analysis.items.map(item => ({
    macro: item.label,
    planejado: item.plannedPercent,
    realizado: item.consumedPercent,
  }));

  return (
    <Card className="border-0 shadow-sm">
      <SectionHeader
        icon={<Activity className="h-5 w-5 text-primary" />}
        title="Macronutrientes planejados vs realizados"
        description="Compara gramas e distribuição percentual para mostrar se a composição acompanha a meta, não só as calorias."
        badge={hasMacroGoal ? `${formatPercent(analysis.distributionAdherencePercent)} aderência` : "Sem meta"}
      />
      <CardContent className="space-y-5">
        {!hasMacroGoal ? (
          <div className="rounded-2xl border border-dashed bg-muted/10 p-5 text-sm leading-6 text-muted-foreground">
            Configure metas de proteínas, carboidratos e gorduras para liberar a comparação completa de macros.
          </div>
        ) : (
          <>
            <div className="grid gap-3 md:grid-cols-3">
              <StatusTile
                label="Proteína na faixa"
                value={`${dailySummary.proteinDaysWithinGoal}/${dailySummary.daysWithMacroRecords}`}
                hint="Dias com consumo entre 90% e 110% da meta de proteína."
              />
              <StatusTile
                label="Gordura acima"
                value={dailySummary.fatDaysAboveGoal}
                hint="Dias em que gordura passou de 105% da meta."
              />
              <StatusTile
                label="Macro mais distante"
                value={analysis.mostDistantMacro?.label ?? "-"}
                hint="Maior desvio em pontos percentuais no período."
              />
            </div>

            <div className="h-[280px] rounded-2xl border bg-background p-4 shadow-sm">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} barSize={32}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="macro" />
                  <YAxis tickFormatter={value => `${value}%`} />
                  <Tooltip formatter={value => formatPercent(Number(value))} />
                  <Legend />
                  <Bar dataKey="planejado" name="Planejado" fill="#94a3b8" radius={[8, 8, 0, 0]} />
                  <Bar dataKey="realizado" name="Realizado" fill="#16a34a" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

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
  foodQuality,
}: {
  proteinGrams?: number;
  fiberGrams?: number;
  fruitServings?: number;
  vegetableServings?: number;
  ultraProcessedServings?: number;
  regularityScore?: number;
  foodQuality?: FoodQualitySummary;
}) {
  const distribution = foodQuality?.distribution?.length ? foodQuality.distribution : EMPTY_FOOD_QUALITY_DISTRIBUTION;

  return (
    <Card className="border-0 shadow-sm">
      <SectionHeader
        icon={<Leaf className="h-5 w-5 text-primary" />}
        title="Qualidade alimentar agregada"
        description="Indicadores do período sem detalhar alimento por alimento. Itens sem classificação ficam separados para não distorcer percentuais."
        badge="Agregado"
      />
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <StatusTile
            label="Dias com frutas"
            value={`${foodQuality?.fruitDays ?? 0}/${foodQuality?.dayCount ?? 0}`}
            hint="Dias do período com pelo menos uma fruta classificada."
          />
          <StatusTile
            label="Dias com legumes/verduras"
            value={`${foodQuality?.vegetableDays ?? 0}/${foodQuality?.dayCount ?? 0}`}
            hint="Dias do período com presença classificada."
          />
          <StatusTile
            label="Ultraprocessados"
            value={formatPercent(foodQuality?.ultraProcessedCaloriesPercent)}
            hint={`${formatCalories(foodQuality?.ultraProcessedCalories ?? 0)} estimadas no período.`}
          />
          <StatusTile
            label="In natura/minimamente"
            value={formatPercent(foodQuality?.naturalOrMinimallyProcessedCaloriesPercent)}
            hint={`${formatCalories(foodQuality?.naturalOrMinimallyProcessedCalories ?? 0)} estimadas no período.`}
          />
          <StatusTile
            label="Índice de qualidade"
            value={foodQuality?.qualityIndex == null ? "-" : formatPercent(foodQuality.qualityIndex)}
            hint="Calculado apenas sobre calorias classificadas."
          />
        </div>

        {!foodQuality?.hasData ? (
          <div className="rounded-2xl border border-dashed bg-muted/10 p-5 text-sm leading-6 text-muted-foreground">
            Ainda não há alimentos classificados suficientes para preencher estes indicadores no período selecionado. Quando houver registros classificados, os percentuais aparecerão aqui sem listar alimentos individualmente.
          </div>
        ) : null}

        <div className="grid gap-3 md:grid-cols-3">
          {distribution.map(item => (
            <div key={item.key} className="rounded-2xl border bg-background p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="text-sm font-medium">{item.label}</p>
                <Badge variant="secondary" className="rounded-full">{formatPercent(item.percent)}</Badge>
              </div>
              <Progress className="h-2" value={item.percent} />
              <p className="mt-3 text-sm text-muted-foreground">{formatCalories(item.calories)} no período.</p>
            </div>
          ))}
        </div>

        {(foodQuality?.unclassifiedCalories ?? 0) > 0 ? (
          <div className="rounded-2xl border bg-muted/20 p-4 text-sm leading-6 text-muted-foreground">
            {formatPercent(foodQuality?.unclassifiedCaloriesPercent)} das calorias do período ainda estão sem classificação alimentar. Esses itens ficam separados para não inflar os percentuais de ultraprocessados ou de alimentos in natura/minimamente processados.
          </div>
        ) : null}

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <StatusTile label="Proteína" value={`${formatMacro(proteinGrams ?? 0)} g`} />
          <StatusTile label="Fibras" value={`${formatMacro(fiberGrams ?? 0)} g`} />
          <StatusTile label="Porções de frutas" value={formatMacro(fruitServings ?? 0)} />
          <StatusTile label="Porções de legumes/verduras" value={formatMacro(vegetableServings ?? 0)} />
          <StatusTile label="Porções ultraprocessadas" value={formatMacro(ultraProcessedServings ?? 0)} />
        </div>

        <div className="rounded-2xl border bg-background p-4">
          <p className="text-sm text-muted-foreground">Regularidade das refeições</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight">{formatPercent(regularityScore ?? 0)}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function WeightCard({
  points,
  adherencePercent,
}: {
  points: WeightTrendPoint[];
  adherencePercent: number;
}) {
  const summary = calculateWeightTrendSummary(points);
  const chartData = points.map((point, index) => ({
    label: point.label ?? point.date,
    weightKg: point.weightKg,
    order: index + 1,
  }));
  const badge = summary.trendDirection === "insufficient_data"
    ? "Tendência insuficiente"
    : summary.trendDirection === "stable"
      ? "Estável"
      : summary.trendDirection === "up"
        ? "Subiu"
        : "Caiu";

  return (
    <Card className="border-0 shadow-sm">
      <SectionHeader
        icon={<Scale className="h-5 w-5 text-primary" />}
        title="Evolução do peso e aderência"
        description="Relaciona registros de peso do período com a aderência calórica média, sem tirar conclusões clínicas isoladas."
        badge={badge}
      />
      <CardContent className="space-y-5">
        {summary.hasData ? (
          <>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <StatusTile label="Peso inicial" value={`${formatMacro(summary.firstWeightKg ?? 0)} kg`} />
              <StatusTile label="Último peso" value={`${formatMacro(summary.lastWeightKg ?? 0)} kg`} />
              <StatusTile label="Variação" value={`${formatSignedMacro(summary.deltaKg)} kg`} hint={`${formatSignedMacro(summary.deltaPercent)}% no período`} />
              <StatusTile label="Aderência calórica" value={formatPercent(adherencePercent)} hint="Média do mesmo intervalo analisado." />
            </div>

            {chartData.length > 1 ? (
              <div className="h-[260px] rounded-2xl border bg-background p-4 shadow-sm">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="label" />
                    <YAxis domain={["dataMin - 1", "dataMax + 1"]} />
                    <Tooltip formatter={value => `${formatMacro(Number(value))} kg`} />
                    <Legend />
                    <Line type="monotone" dataKey="weightKg" name="Peso" stroke="#16a34a" strokeWidth={3} dot />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : null}

            <div className="rounded-2xl border bg-muted/20 p-4 text-sm leading-6 text-muted-foreground">
              {summary.trendMessage} A aderência calórica média do período foi de {formatPercent(adherencePercent)}.
            </div>
          </>
        ) : (
          <div className="rounded-2xl border border-dashed bg-muted/10 p-5 text-sm leading-6 text-muted-foreground">
            Ainda não há registros de peso no período selecionado para relacionar evolução corporal e aderência calórica.
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

  const periodDaily = (periodBundle.data?.daily ?? []) as PeriodReportDay[];
  const dayCount = periodScope === "week" ? 7 : periodDaily.length || countDaysInRange(activeRange);
  const weeklyDays = reportBundle.data?.weekly ?? [];
  const periodTotals = periodBundle.data?.totals ?? EMPTY_TOTALS;
  const periodGoal = periodBundle.data?.goal ?? EMPTY_TOTALS;

  const trendData = periodScope === "week"
    ? weeklyDays.map(day => toTrendPoint({
        date: day.date,
        label: day.label,
        calories: day.calories,
        goalCalories: day.goalCalories,
        adjustedGoalCalories: day.adjustedGoalCalories,
        exerciseCalories: day.exerciseCalories,
        calorieDelta: day.calories - (day.adjustedGoalCalories ?? day.goalCalories),
      }))
    : periodDaily.map(toTrendPoint);

  const calorieAdherence = calculateCalorieAdherence(trendData, dayCount);

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
        protein: periodDaily.reduce((total, day) => total + day.goalProtein, 0) || periodGoal.protein * dayCount,
        carbs: periodDaily.reduce((total, day) => total + day.goalCarbs, 0) || periodGoal.carbs * dayCount,
        fat: periodDaily.reduce((total, day) => total + day.goalFat, 0) || periodGoal.fat * dayCount,
      };

  const dailyMacros: MacroGoalDay[] = periodScope === "week"
    ? weeklyDays.map(day => ({
        protein: day.protein,
        carbs: day.carbs,
        fat: day.fat,
        goalProtein: day.goalProtein,
        goalCarbs: day.goalCarbs,
        goalFat: day.goalFat,
      }))
    : periodDaily.map(day => ({
        protein: day.protein,
        carbs: day.carbs,
        fat: day.fat,
        goalProtein: day.goalProtein,
        goalCarbs: day.goalCarbs,
        goalFat: day.goalFat,
      }));

  const totalCalories = periodScope === "week"
    ? weeklyDays.reduce((total, day) => total + day.calories, 0)
    : periodTotals.calories;
  const totalGoalCalories = trendData.reduce((total, day) => total + day.goalCalories, 0);
  const adjustedGoalLabel = "metas ajustadas por dia";
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
  const periodQuality = (periodBundle.data as unknown as { quality?: ReportsQualityBundle } | undefined)?.quality;
  const foodQuality = periodScope === "week" ? weeklyQuality?.foodQuality : periodQuality?.foodQuality;
  const periodWeightBundle = (periodBundle.data as unknown as { weightTrend?: WeightTrendBundle } | undefined)?.weightTrend;
  const weightTrendPoints = periodScope === "week"
    ? buildWeightPointsFromSummary(reportBundle.data?.progress.weight)
    : periodWeightBundle?.points ?? buildWeightPointsFromSummary(periodWeightBundle?.summary);

  const isLoading = periodScope === "week" ? reportBundle.isLoading : periodBundle.isLoading;
  const isError = periodScope === "week" ? reportBundle.isError : periodBundle.isError;

  const introStats = (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <SummaryPill label="Consumido" value={formatCalories(totalCalories)} />
      <SummaryPill label="Meta ajustada" value={formatCalories(totalGoalCalories)} />
      <SummaryPill label="Aderência" value={formatPercent(calorieAdherence.adherencePercent)} />
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
              <MetricCard title="Meta ajustada do período" value={formatCalories(totalGoalCalories)} description={`Referência baseada em ${adjustedGoalLabel}.`} />
              <MetricCard title="Desvio total" value={formatCalories(totalCalories - totalGoalCalories)} description="Diferença entre consumido e meta ajustada no intervalo." />
              <MetricCard title="Exercícios" value={formatCalories(exerciseCalories)} description="Gasto estimado usado como contexto da meta ajustada." />
            </div>

            <CalorieAdherenceCard trendData={trendData} dayCount={dayCount} />
            <CalorieTrendChart trendData={trendData} />
            <DailyCalorieBreakdown trendData={trendData} />
            <MacroAdherenceCard consumed={consumedMacros} planned={plannedMacros} dailyMacros={dailyMacros} />

            <div className="grid gap-6 xl:grid-cols-[1fr,0.85fr]">
              <QualityCard
                proteinGrams={weeklyQuality?.proteinGrams ?? consumedMacros.protein}
                fiberGrams={weeklyQuality?.fiberGrams}
                fruitServings={weeklyQuality?.fruitServings}
                vegetableServings={weeklyQuality?.vegetableServings}
                ultraProcessedServings={weeklyQuality?.ultraProcessedServings}
                regularityScore={weeklyQuality?.regularityScore}
                foodQuality={foodQuality}
              />
              <WeightCard points={weightTrendPoints} adherencePercent={calorieAdherence.adherencePercent} />
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
