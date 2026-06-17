import React from "react";
import DashboardLayout from "@/components/DashboardLayout";
import PageIntro from "@/components/PageIntro";
import { PeriodScopeSelector } from "@/components/PeriodScopeSelector";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
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
  ArrowRight,
  BarChart3,
  CalendarDays,
  Droplets,
  Dumbbell,
  Mail,
  Scale,
  ShieldAlert,
  Stethoscope,
  TrendingUp,
  UserPlus,
} from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { useLocation } from "wouter";

type MacroKey = "protein" | "carbs" | "fat";

type ReportTotals = {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
};

type DailyMacroSource = ReportTotals & {
  date: string;
  label: string;
  goalCalories: number;
  adjustedGoalCalories?: number;
  goalProtein?: number;
  goalCarbs?: number;
  goalFat?: number;
  waterConsumedMl?: number;
  waterGoalMl?: number;
  exerciseCalories?: number;
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

type WeightPoint = {
  date: string;
  weightKg: number | null;
};

type PatientAccess = {
  id: string;
  patientUserId: number;
  status: string;
  requestedAt: number;
  approvedAt: number | null;
  revokedAt: number | null;
  patient?: { name: string | null; email: string | null } | null;
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

function personLabel(access: PatientAccess) {
  return access.patient?.name || access.patient?.email || `Pessoa #${access.patientUserId}`;
}

function accessDateLabel(access: PatientAccess) {
  if (access.status === "approved" && access.approvedAt) return `Autorizado em ${new Date(access.approvedAt).toLocaleString("pt-BR")}`;
  if (access.status === "revoked" && access.revokedAt) return `Revogado em ${new Date(access.revokedAt).toLocaleString("pt-BR")}`;
  return `Solicitado em ${new Date(access.requestedAt).toLocaleString("pt-BR")}`;
}

function normalizeDay(day: any, fallbackGoal?: any): DailyMacroSource {
  return {
    date: day.date,
    label: day.label,
    calories: Number(day.calories ?? 0),
    protein: Number(day.protein ?? 0),
    carbs: Number(day.carbs ?? 0),
    fat: Number(day.fat ?? 0),
    goalCalories: Number(day.goalCalories ?? fallbackGoal?.calories ?? 0),
    adjustedGoalCalories: Number(day.adjustedGoalCalories ?? day.goalCalories ?? fallbackGoal?.calories ?? 0),
    goalProtein: Number(day.goalProtein ?? fallbackGoal?.protein ?? fallbackGoal?.proteinGrams ?? 0),
    goalCarbs: Number(day.goalCarbs ?? fallbackGoal?.carbs ?? fallbackGoal?.carbsGrams ?? 0),
    goalFat: Number(day.goalFat ?? fallbackGoal?.fat ?? fallbackGoal?.fatGrams ?? 0),
    waterConsumedMl: Number(day.waterConsumedMl ?? 0),
    waterGoalMl: Number(day.waterGoalMl ?? 0),
    exerciseCalories: Number(day.exerciseCalories ?? 0),
  };
}

function normalizeWeightPoints(value: any): WeightPoint[] {
  const source = value?.entries ?? value?.points ?? value?.summary?.entries ?? [];
  return source
    .map((entry: any) => ({ date: entry.date, weightKg: Number(entry.weightKg ?? 0) || null }))
    .filter((entry: WeightPoint) => entry.date);
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
    });
  });

  return metrics;
}

function getCalorieBarColor(calories: number, goalCalories: number) {
  return goalCalories > 0 && calories > goalCalories ? "#dc2626" : "#10b981";
}

function averageValue(total: number, count: number) {
  if (!count) return 0;
  return total / count;
}

export default function ProfessionalReportsPage() {
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();
  const userTimeZone = React.useMemo(() => getBrowserTimeZone(), []);
  const profile = trpc.nutrition.professionals.profile.useQuery(undefined, { retry: false });
  const hasActiveProfile = Boolean(profile.data?.active);
  const accesses = trpc.nutrition.professionals.myAccesses.useQuery(undefined, { enabled: hasActiveProfile });
  const [patientContact, setPatientContact] = React.useState("");
  const [reason, setReason] = React.useState("Acompanhamento profissional com consentimento da pessoa acompanhada.");
  const [selectedPatientId, setSelectedPatientId] = React.useState<number | null>(null);
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

  const approvedAccesses = (accesses.data?.filter(access => access.status === "approved") ?? []) as PatientAccess[];
  const pendingAccesses = accesses.data?.filter(access => access.status === "pending") ?? [];
  const selectedAccess = approvedAccesses.find(access => access.patientUserId === selectedPatientId) ?? null;

  const dashboard = trpc.nutrition.professionals.patientDashboard.useQuery(
    { patientId: selectedPatientId ?? 0, weekOffset },
    { enabled: hasActiveProfile && Boolean(selectedPatientId) && periodScope === "week" },
  );
  const periodBundle = trpc.nutrition.professionals.patientPeriodBundle.useQuery(
    { patientId: selectedPatientId ?? 0, startDate: activeRange.start, endDate: activeRange.end },
    { enabled: hasActiveProfile && Boolean(selectedPatientId) && periodScope !== "week" },
  );

  React.useEffect(() => {
    if (!selectedPatientId && approvedAccesses.length) {
      setSelectedPatientId(approvedAccesses[0].patientUserId);
    }
    if (selectedPatientId && approvedAccesses.length && !approvedAccesses.some(access => access.patientUserId === selectedPatientId)) {
      setSelectedPatientId(approvedAccesses[0].patientUserId);
    }
  }, [approvedAccesses, selectedPatientId]);

  const invalidate = async () => {
    await Promise.all([
      utils.auth.me.invalidate(),
      utils.nutrition.professionals.profile.invalidate(),
      utils.nutrition.professionals.myAccesses.invalidate(),
    ]);
  };

  const requestAccess = trpc.nutrition.professionals.requestAccess.useMutation({
    onSuccess: async () => {
      toast.success("Solicitação enviada. A pessoa acompanhada precisa autorizar antes do acesso.");
      setPatientContact("");
      await invalidate();
    },
    onError: error => toast.error(error.message || "Não foi possível solicitar acesso."),
  });

  const weeklyDays = React.useMemo(() => ((dashboard.data as any)?.weeklyReport ?? []).map((day: any) => normalizeDay(day)), [dashboard.data]);
  const periodDays = React.useMemo(() => ((periodBundle.data as any)?.daily ?? []).map((day: any) => normalizeDay(day, (periodBundle.data as any)?.goal)), [periodBundle.data]);
  const metricDays = periodScope === "week" ? weeklyDays : periodDays;
  const dayCount = metricDays.length || countDaysInRange(activeRange);
  const totals = metricDays.reduce(
    (acc, day) => ({
      calories: acc.calories + day.calories,
      protein: acc.protein + day.protein,
      carbs: acc.carbs + day.carbs,
      fat: acc.fat + day.fat,
    }),
    { ...EMPTY_TOTALS },
  );
  const weightPoints = periodScope === "week"
    ? normalizeWeightPoints((dashboard.data as any)?.progress?.weight)
    : normalizeWeightPoints((periodBundle.data as any)?.weightTrend);
  const macroMetrics = calculateMacroMetrics(metricDays, weightPoints);
  const trendData = metricDays.map(day => ({
    ...day,
    goalCalories: day.adjustedGoalCalories ?? day.goalCalories,
  }));
  const goalCalories = trendData[0]?.goalCalories ?? 0;
  const localAverageCalories = averageValue(totals.calories, Math.max(metricDays.length, 1));
  const waterConsumedMl = periodScope === "week"
    ? metricDays.reduce((total, day) => total + (day.waterConsumedMl ?? 0), 0)
    : (periodBundle.data as any)?.habitAnalytics?.water?.totalConsumedMl ?? 0;
  const waterGoalMl = periodScope === "week"
    ? metricDays.reduce((total, day) => total + (day.waterGoalMl ?? 0), 0)
    : (periodBundle.data as any)?.habitAnalytics?.water?.totalGoalMl ?? 0;
  const waterHitDays = periodScope === "week"
    ? metricDays.filter(day => (day.waterGoalMl ?? 0) > 0 && (day.waterConsumedMl ?? 0) >= (day.waterGoalMl ?? 0)).length
    : (periodBundle.data as any)?.habitAnalytics?.water?.goalHitDays ?? 0;
  const exerciseActiveDays = periodScope === "week"
    ? metricDays.filter(day => (day.exerciseCalories ?? 0) > 0).length
    : (periodBundle.data as any)?.habitAnalytics?.exercise?.activeDays ?? 0;
  const exerciseCalories = periodScope === "week"
    ? metricDays.reduce((total, day) => total + (day.exerciseCalories ?? 0), 0)
    : (periodBundle.data as any)?.habitAnalytics?.exercise?.totalCalories ?? 0;
  const periodSupportLoading = periodScope !== "week" && periodBundle.isLoading;
  const activeLoading = periodScope === "week" ? dashboard.isLoading : periodBundle.isLoading;
  const activeError = periodScope === "week" ? dashboard.isError : periodBundle.isError;

  if (!profile.isLoading && !hasActiveProfile) {
    return (
      <DashboardLayout>
        <div className="mx-auto max-w-3xl">
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><ShieldAlert className="h-5 w-5 text-primary" /> Perfil profissional necessário</CardTitle>
              <CardDescription>Ative a área Profissional em Configurações para acompanhar pessoas autorizadas.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button className="rounded-full" onClick={() => setLocation("/settings")}>Ir para Configurações</Button>
            </CardContent>
          </Card>
        </div>
      </DashboardLayout>
    );
  }

  const introStats = (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <SummaryPill label="Calorias" value={formatCalories(totals.calories)} />
      <SummaryPill label="Proteínas" value={formatMacroGrams(totals.protein)} />
      <SummaryPill label="Carboidratos" value={formatMacroGrams(totals.carbs)} />
      <SummaryPill label="Gorduras" value={formatMacroGrams(totals.fat)} />
      <SummaryPill label="Pessoas" value={String(approvedAccesses.length)} />
    </div>
  );

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <PageIntro
          eyebrow="Profissional"
          title="Relatórios da pessoa acompanhada"
          description={`A visão profissional usa os mesmos cards e cálculos da tela Reports. Intervalo ativo: ${formatRangeLabel(activeRange)}.`}
          stats={introStats}
          actions={
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-end">
              <label className="min-w-64 space-y-2 text-left">
                <Label>Pessoa acompanhada</Label>
                <select
                  className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  value={selectedPatientId ?? ""}
                  onChange={event => setSelectedPatientId(event.target.value ? Number(event.target.value) : null)}
                  disabled={!approvedAccesses.length}
                >
                  <option value="">Selecione uma pessoa</option>
                  {approvedAccesses.map(access => <option key={access.id} value={access.patientUserId}>{personLabel(access)}</option>)}
                </select>
              </label>
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
            </div>
          }
        />

        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><UserPlus className="h-5 w-5 text-primary" /> Vínculos de acompanhamento</CardTitle>
            <CardDescription>Use esta área para escolher uma pessoa autorizada ou enviar um novo convite.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 lg:grid-cols-[1fr_1.4fr_auto] lg:items-end">
              <label className="space-y-2">
                <Label>E-mail ou celular</Label>
                <Input value={patientContact} onChange={event => setPatientContact(event.target.value.trimStart())} placeholder="pessoa@exemplo.com" />
              </label>
              <label className="space-y-2">
                <Label>Motivo</Label>
                <Textarea value={reason} onChange={event => setReason(event.target.value)} className="min-h-11 lg:min-h-11" />
              </label>
              <Button className="h-11 rounded-full" disabled={requestAccess.isPending || !patientContact.trim()} onClick={() => requestAccess.mutate({ patientContact: patientContact.trim(), reason })}>
                <Mail className="mr-2 h-4 w-4" /> Enviar convite
              </Button>
            </div>
            {selectedAccess ? (
              <div className="rounded-2xl border bg-muted/20 p-4 text-sm leading-6 text-muted-foreground">
                <p className="font-medium text-foreground">{personLabel(selectedAccess)}</p>
                <p>{selectedAccess.patient?.email || `ID interno #${selectedAccess.patientUserId}`}</p>
                <p>{accessDateLabel(selectedAccess)}</p>
              </div>
            ) : !accesses.isLoading ? <Empty text={pendingAccesses.length ? "Há convites aguardando autorização, mas nenhuma pessoa liberou acesso ainda." : "Nenhuma pessoa autorizou acompanhamento até agora."} /> : null}
          </CardContent>
        </Card>

        {activeLoading ? (
          <div className="grid gap-4 lg:grid-cols-4">
            <Skeleton className="h-32 rounded-2xl" />
            <Skeleton className="h-32 rounded-2xl" />
            <Skeleton className="h-32 rounded-2xl" />
            <Skeleton className="h-32 rounded-2xl" />
          </div>
        ) : null}
        {activeError ? <Empty text="Não foi possível carregar os relatórios autorizados. Tente novamente em instantes." /> : null}

        {selectedPatientId && !activeLoading && !activeError ? (
          <>
            <div className="grid gap-4 lg:grid-cols-4">
              <HighlightCard title={periodScope === "week" ? "Média semanal" : "Média do período"} value={formatCalories(localAverageCalories)} description="Média diária no intervalo selecionado." />
              <HighlightCard title="Total do período" value={formatCalories(totals.calories)} description={`Meta de referência: ${formatCalories(goalCalories)}.`} />
              <HighlightCard title="Macros realizados" value={formatMacroGrams(totals.protein + totals.carbs + totals.fat)} description="Soma de proteínas, carboidratos e gorduras no período." />
              <HighlightCard title="Exercícios" value={formatCalories(exerciseCalories)} description={`${exerciseActiveDays}/${dayCount} dias com atividade registrada.`} />
            </div>

            <MacroAdherenceSection
              title={periodScope === "week" ? "Aderência semanal às metas" : "Aderência do período às metas"}
              description="Calorias, proteínas, carboidratos e gorduras usam a mesma leitura da tela Reports."
              metrics={macroMetrics}
            />
            <PlannedVsRealizedMacrosSection metrics={macroMetrics} />

            <div className="grid gap-6 xl:grid-cols-2">
              <WaterAnalyticsCard
                title={periodScope === "week" ? "Hidratação na semana" : "Hidratação no período"}
                scopeLabel={periodScope === "week" ? "Semanal" : "Período"}
                totalConsumedMl={waterConsumedMl}
                totalGoalMl={waterGoalMl}
                goalHitDays={waterHitDays}
                totalDays={dayCount}
              />
              <ExerciseAnalyticsCard
                title={periodScope === "week" ? "Atividade física na semana" : "Atividade física no período"}
                scopeLabel={periodScope === "week" ? "Semanal" : "Período"}
                activeDays={exerciseActiveDays}
                totalDays={dayCount}
                totalCalories={exerciseCalories}
              />
            </div>

            <TrendSection trendData={trendData} />
            <WeightSection weights={weightPoints} />
            {periodSupportLoading ? <Skeleton className="h-40 rounded-2xl" /> : null}
          </>
        ) : null}
      </div>
    </DashboardLayout>
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
          ) : <Empty text="Informe um peso para calcular g/kg/dia deste período." />
        ) : null}
      </CardContent>
    </Card>
  );
}

function MacroAdherenceSection({ title, description, metrics }: { title: string; description: string; metrics: MacroMetric[] }) {
  return (
    <Card className="border-0 shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><CalendarDays className="h-5 w-5 text-primary" /> {title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
        {metrics.map(metric => <MacroMetricCard key={metric.key} metric={metric} />)}
      </CardContent>
    </Card>
  );
}

function PlannedVsRealizedMacrosSection({ metrics }: { metrics: MacroMetric[] }) {
  return (
    <Card className="border-0 shadow-sm">
      <CardHeader>
        <CardTitle>Macronutrientes planejados vs realizados</CardTitle>
        <CardDescription>Totais do período e média por peso de referência em g/kg/dia.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 xl:grid-cols-3">
        {metrics.filter(metric => metric.unit === "g").map(metric => <MacroMetricCard key={metric.key} metric={metric} showPerKg />)}
      </CardContent>
    </Card>
  );
}

function WaterAnalyticsCard({ title, scopeLabel, totalConsumedMl, totalGoalMl, goalHitDays, totalDays }: { title: string; scopeLabel: string; totalConsumedMl: number; totalGoalMl: number; goalHitDays: number; totalDays: number }) {
  const adherence = progressPercent(totalConsumedMl, totalGoalMl);
  return (
    <Card className="border-0 shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Droplets className="h-5 w-5 text-primary" /> {title}</CardTitle>
        <CardDescription><Badge variant="outline">{scopeLabel}</Badge></CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-3xl border bg-muted/20 p-4">
          <div className="mb-3 flex items-center justify-between gap-3"><p className="text-sm font-medium tracking-tight">Aderência à meta de água</p><p className="text-sm text-muted-foreground">{formatPercent(adherence)}</p></div>
          <Progress className="h-2" value={adherence} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <StatusTile label="Meta do período" value={formatCountPtBr(Math.round(totalGoalMl), " ml")} />
          <StatusTile label="Consumo acumulado" value={formatCountPtBr(Math.round(totalConsumedMl), " ml")} />
          <StatusTile label="Meta batida" value={`${goalHitDays}/${totalDays} dias`} />
          <StatusTile label="Média diária" value={formatCountPtBr(Math.round(averageValue(totalConsumedMl, totalDays)), " ml")} />
        </div>
      </CardContent>
    </Card>
  );
}

function ExerciseAnalyticsCard({ title, scopeLabel, activeDays, totalDays, totalCalories }: { title: string; scopeLabel: string; activeDays: number; totalDays: number; totalCalories: number }) {
  return (
    <Card className="border-0 shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Dumbbell className="h-5 w-5 text-primary" /> {title}</CardTitle>
        <CardDescription><Badge variant="outline">{scopeLabel}</Badge></CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2">
        <CompactMetric label="Dias ativos" value={`${activeDays}/${totalDays}`} />
        <CompactMetric label="Gasto total" value={formatCalories(totalCalories)} />
        <StatusTile label="Distribuição" value={`${activeDays}/${totalDays} dias`} />
        <StatusTile label="Média por dia ativo" value={activeDays ? formatCalories(averageValue(totalCalories, activeDays)) : "0 kcal"} />
      </CardContent>
    </Card>
  );
}

function TrendSection({ trendData }: { trendData: DailyMacroSource[] }) {
  if (!trendData.length) return <Empty text="Ainda não há dados suficientes no intervalo para desenhar a tendência." />;
  return (
    <div className="grid gap-6 xl:grid-cols-[1.2fr,0.8fr]">
      <Card className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><BarChart3 className="h-5 w-5 text-primary" /> Calorias consumidas em relação à meta</CardTitle>
          <CardDescription>Comparativo diário dentro do intervalo selecionado.</CardDescription>
        </CardHeader>
        <CardContent className="h-[360px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={trendData} barSize={28}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Bar dataKey="goalCalories" name="Meta" fill="#cbd5e1" radius={[8, 8, 0, 0]} />
              <Bar dataKey="calories" name="Consumido" radius={[8, 8, 0, 0]}>
                {trendData.map(day => <Cell key={day.date} fill={getCalorieBarColor(day.calories, day.goalCalories)} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
      <Card className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle>Distribuição de macronutrientes</CardTitle>
          <CardDescription>Evolução agregada de proteínas, carboidratos e gorduras.</CardDescription>
        </CardHeader>
        <CardContent className="h-[360px]">
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

function WeightSection({ weights }: { weights: WeightPoint[] }) {
  const usable = weights.filter(weight => Number(weight.weightKg) > 0).sort((a, b) => a.date.localeCompare(b.date));
  const first = usable[0]?.weightKg ?? null;
  const last = usable.at(-1)?.weightKg ?? null;
  const delta = first != null && last != null ? last - first : null;
  return (
    <Card className="border-0 shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Scale className="h-5 w-5 text-primary" /> Evolução do peso</CardTitle>
        <CardDescription>Mesmo peso de referência usado nos cálculos de g/kg/dia.</CardDescription>
      </CardHeader>
      <CardContent>
        {usable.length ? (
          <div className="grid gap-3 sm:grid-cols-3">
            <StatusTile label="Inicial" value={`${formatMacro(first ?? 0)} kg`} />
            <StatusTile label="Atual" value={`${formatMacro(last ?? 0)} kg`} />
            <StatusTile label="Variação" value={delta == null ? "-" : `${delta > 0 ? "+" : ""}${formatMacro(delta)} kg`} />
          </div>
        ) : <Empty text="Ainda não há peso registrado para compor a leitura do período." />}
      </CardContent>
    </Card>
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

function Empty({ text }: { text: string }) {
  return <div className="rounded-2xl border border-dashed bg-muted/20 p-6 text-sm leading-6 text-muted-foreground">{text}</div>;
}
