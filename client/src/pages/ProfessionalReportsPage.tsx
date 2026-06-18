import React from "react";
import DashboardLayout from "@/components/DashboardLayout";
import PageIntro from "@/components/PageIntro";
import { PeriodScopeSelector } from "@/components/PeriodScopeSelector";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { SummaryPill } from "@/features/meals/components";
import {
  ReportCompactMetric,
  ReportEmptyState,
  ReportExerciseAnalyticsCard,
  ReportHighlightCard,
  type ReportMacroMetric,
  ReportMacroAdherenceSection,
  ReportPlannedVsRealizedMacrosSection,
  ReportStatusTile,
  ReportTrendSection,
  type ReportTrendDay,
  ReportWaterAnalyticsCard,
  ReportWeightAdherenceCard,
  averageValue,
  formatMacro,
  formatMacroGrams,
  formatPercent,
  progressPercent,
} from "@/features/reports/ReportAnalyticsSections";
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
import { Mail, ShieldAlert, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { useLocation } from "wouter";

type MacroKey = "protein" | "carbs" | "fat";
type ProfessionalTab = "vinculos" | "analise";
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
type WeightPoint = { date: string; weightKg: number | null };
type PatientAccess = {
  id: string;
  patientUserId: number;
  status: string;
  requestedAt: number;
  approvedAt: number | null;
  revokedAt: number | null;
  patient?: { name: string | null; email: string | null } | null;
};
type MealSummary = { id: string | number; mealLabel?: string | null; occurredAt?: string | number | Date | null; totals?: { calories?: number | null } | null };
type ProfessionalComment = { id?: string | number; comment?: string | null; createdAt?: string | number | Date | null };
type NutritionGoal = { calories?: number | null; proteinGrams?: number | null; carbsGrams?: number | null; fatGrams?: number | null };

const EMPTY_TOTALS: Totals = { calories: 0, protein: 0, carbs: 0, fat: 0 };
const MACRO_META: Array<{ key: MacroKey; title: string; goalKey: "goalProtein" | "goalCarbs" | "goalFat" }> = [
  { key: "protein", title: "Proteínas", goalKey: "goalProtein" },
  { key: "carbs", title: "Carboidratos", goalKey: "goalCarbs" },
  { key: "fat", title: "Gorduras", goalKey: "goalFat" },
];

function numberValue(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function personLabel(access: PatientAccess) {
  return access.patient?.name || access.patient?.email || `Pessoa #${access.patientUserId}`;
}

function accessDateLabel(access: PatientAccess) {
  if (access.status === "approved" && access.approvedAt) return `Autorizado em ${new Date(access.approvedAt).toLocaleString("pt-BR")}`;
  if (access.status === "revoked" && access.revokedAt) return `Revogado em ${new Date(access.revokedAt).toLocaleString("pt-BR")}`;
  return `Solicitado em ${new Date(access.requestedAt).toLocaleString("pt-BR")}`;
}

function normalizeDay(day: any, fallbackGoal?: any): ReportDay {
  return {
    date: String(day.date ?? ""),
    label: String(day.label ?? day.date ?? "-"),
    calories: numberValue(day.calories),
    protein: numberValue(day.protein),
    carbs: numberValue(day.carbs),
    fat: numberValue(day.fat),
    goalCalories: numberValue(day.goalCalories ?? fallbackGoal?.calories),
    adjustedGoalCalories: numberValue(day.adjustedGoalCalories ?? day.goalCalories ?? fallbackGoal?.calories),
    goalProtein: numberValue(day.goalProtein ?? fallbackGoal?.protein ?? fallbackGoal?.proteinGrams),
    goalCarbs: numberValue(day.goalCarbs ?? fallbackGoal?.carbs ?? fallbackGoal?.carbsGrams),
    goalFat: numberValue(day.goalFat ?? fallbackGoal?.fat ?? fallbackGoal?.fatGrams),
    waterConsumedMl: numberValue(day.waterConsumedMl),
    waterGoalMl: numberValue(day.waterGoalMl),
    exerciseCalories: numberValue(day.exerciseCalories),
  };
}

function normalizeWeightPoints(...sources: any[]): WeightPoint[] {
  for (const value of sources) {
    const entries = value?.entries ?? value?.points ?? value?.summary?.entries ?? [];
    const points = entries
      .map((entry: any) => ({ date: String(entry.date ?? ""), weightKg: numberValue(entry.weightKg) || null }))
      .filter((entry: WeightPoint) => entry.date && Number(entry.weightKg) > 0);
    if (points.length) return points;
  }
  return [];
}

function resolveWeightForDate(date: string, weights: WeightPoint[]) {
  const usableWeights = weights.filter(weight => weight.date && Number(weight.weightKg) > 0).sort((a, b) => a.date.localeCompare(b.date));
  return Number((usableWeights.find(weight => weight.date === date) ?? usableWeights.filter(weight => weight.date < date).at(-1))?.weightKg) || null;
}

function calculateMacroMetrics(days: ReportDay[], weights: WeightPoint[]): ReportMacroMetric[] {
  const caloriesPlanned = days.reduce((total, day) => total + day.adjustedGoalCalories, 0);
  const caloriesRealized = days.reduce((total, day) => total + day.calories, 0);
  const metrics: ReportMacroMetric[] = [{ key: "calories", title: "Calorias", unit: "kcal", planned: caloriesPlanned, realized: caloriesRealized, percent: progressPercent(caloriesRealized, caloriesPlanned), difference: caloriesRealized - caloriesPlanned, plannedPerKgDay: null, realizedPerKgDay: null }];

  MACRO_META.forEach(macro => {
    const planned = days.reduce((total, day) => total + day[macro.goalKey], 0);
    const realized = days.reduce((total, day) => total + day[macro.key], 0);
    const perKg = days.reduce((acc, day) => {
      const weightKg = resolveWeightForDate(day.date, weights);
      if (!weightKg) return acc;
      acc.planned += day[macro.goalKey] / weightKg;
      acc.realized += day[macro.key] / weightKg;
      acc.days += 1;
      return acc;
    }, { planned: 0, realized: 0, days: 0 });
    metrics.push({ key: macro.key, title: macro.title, unit: "g", planned, realized, percent: progressPercent(realized, planned), difference: realized - planned, plannedPerKgDay: perKg.days ? perKg.planned / perKg.days : null, realizedPerKgDay: perKg.days ? perKg.realized / perKg.days : null });
  });

  return metrics;
}

function findExtreme<T>(items: T[], getValue: (item: T) => number, direction: "min" | "max") {
  return items.reduce<T | null>((current, item) => {
    if (!current) return item;
    const nextValue = getValue(item);
    const currentValue = getValue(current);
    return direction === "max" ? (nextValue > currentValue ? item : current) : (nextValue < currentValue ? item : current);
  }, null);
}

function toTrendDay(day: ReportDay): ReportTrendDay {
  return { date: day.date, label: day.label, calories: day.calories, protein: day.protein, carbs: day.carbs, fat: day.fat, goalCalories: day.adjustedGoalCalories || day.goalCalories };
}

function buildWeightSummary(weights: WeightPoint[]) {
  const usable = weights.filter(weight => Number(weight.weightKg) > 0).sort((a, b) => a.date.localeCompare(b.date));
  const firstWeightKg = usable[0]?.weightKg ?? null;
  const lastWeightKg = usable.at(-1)?.weightKg ?? null;
  return {
    hasData: usable.length > 0,
    firstWeightKg,
    lastWeightKg,
    deltaKg: firstWeightKg != null && lastWeightKg != null ? lastWeightKg - firstWeightKg : null,
  };
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
  const [activeTab, setActiveTab] = React.useState<ProfessionalTab>("analise");
  const [periodScope, setPeriodScope] = React.useState<PeriodScope>("week");
  const [selectedDay, setSelectedDay] = React.useState(() => toDateInputValue());
  const [selectedMonth, setSelectedMonth] = React.useState(() => toMonthInputValue(new Date(), userTimeZone));
  const [rangeStart, setRangeStart] = React.useState(() => toDateInputValue(new Date(Date.now() - 13 * 24 * 60 * 60 * 1000), userTimeZone));
  const [rangeEnd, setRangeEnd] = React.useState(() => toDateInputValue());
  const activeRange = React.useMemo(() => periodScope === "day" ? { start: selectedDay, end: selectedDay } : periodScope === "week" ? getWeekRange(selectedDay) : periodScope === "month" ? getMonthRange(selectedMonth) : normalizeDateRange(rangeStart, rangeEnd), [periodScope, rangeEnd, rangeStart, selectedDay, selectedMonth]);
  const weekOffset = React.useMemo(() => getWeekOffsetFromToday(selectedDay, userTimeZone), [selectedDay, userTimeZone]);
  const approvedAccesses = React.useMemo<PatientAccess[]>(() => ((accesses.data ?? []) as PatientAccess[]).filter(access => access.status === "approved"), [accesses.data]);
  const pendingAccesses = React.useMemo(() => ((accesses.data ?? []) as PatientAccess[]).filter(access => access.status === "pending"), [accesses.data]);
  const selectedAccess = approvedAccesses.find(access => access.patientUserId === selectedPatientId) ?? null;
  const dashboard = trpc.nutrition.professionals.patientDashboard.useQuery({ patientId: selectedPatientId ?? 0, weekOffset }, { enabled: hasActiveProfile && Boolean(selectedPatientId) });
  const periodBundle = trpc.nutrition.professionals.patientPeriodBundle.useQuery({ patientId: selectedPatientId ?? 0, startDate: activeRange.start, endDate: activeRange.end }, { enabled: hasActiveProfile && Boolean(selectedPatientId) && periodScope !== "week" });

  React.useEffect(() => {
    if (!selectedPatientId && approvedAccesses.length) setSelectedPatientId(approvedAccesses[0].patientUserId);
    if (selectedPatientId && approvedAccesses.length && !approvedAccesses.some(access => access.patientUserId === selectedPatientId)) setSelectedPatientId(approvedAccesses[0].patientUserId);
  }, [approvedAccesses, selectedPatientId]);

  const requestAccess = trpc.nutrition.professionals.requestAccess.useMutation({
    onSuccess: async () => {
      toast.success("Solicitação enviada. A pessoa acompanhada precisa autorizar antes do acesso.");
      setPatientContact("");
      await Promise.all([utils.auth.me.invalidate(), utils.nutrition.professionals.profile.invalidate(), utils.nutrition.professionals.myAccesses.invalidate()]);
    },
    onError: error => toast.error(error.message || "Não foi possível solicitar acesso."),
  });

  const dashboardMeals = React.useMemo<MealSummary[]>(() => (((dashboard.data as any)?.meals ?? []) as MealSummary[]), [dashboard.data]);
  const todayMeals = React.useMemo(() => {
    const todayKey = new Date().toLocaleDateString("pt-BR");
    return dashboardMeals.filter(meal => meal.occurredAt && new Date(meal.occurredAt).toLocaleDateString("pt-BR") === todayKey);
  }, [dashboardMeals]);
  const dashboardComments = (((dashboard.data as any)?.comments ?? []) as ProfessionalComment[]);
  const defaultNutritionGoal = (dashboard.data as any)?.nutritionGoal?.defaultGoal as NutritionGoal | undefined;
  const weeklyDays = React.useMemo<ReportDay[]>(() => ((dashboard.data as any)?.weeklyReport ?? []).map((day: any) => normalizeDay(day)), [dashboard.data]);
  const periodDays = React.useMemo<ReportDay[]>(() => ((periodBundle.data as any)?.daily ?? []).map((day: any) => normalizeDay(day, (periodBundle.data as any)?.goal)), [periodBundle.data]);
  const metricDays = periodScope === "week" ? weeklyDays : periodDays;
  const totals = metricDays.reduce<Totals>((acc, day) => ({ calories: acc.calories + day.calories, protein: acc.protein + day.protein, carbs: acc.carbs + day.carbs, fat: acc.fat + day.fat }), { ...EMPTY_TOTALS });
  const dayCount = metricDays.length || countDaysInRange(activeRange);
  const weightPoints = periodScope === "week" ? normalizeWeightPoints((dashboard.data as any)?.weight, (dashboard.data as any)?.progress?.weight) : normalizeWeightPoints((periodBundle.data as any)?.weightTrend);
  const macroMetrics = calculateMacroMetrics(metricDays, weightPoints);
  const trendDays = metricDays.map(toTrendDay);
  const waterConsumedMl = periodScope === "week" ? metricDays.reduce((total, day) => total + day.waterConsumedMl, 0) : numberValue((periodBundle.data as any)?.habitAnalytics?.water?.totalConsumedMl);
  const waterGoalMl = periodScope === "week" ? metricDays.reduce((total, day) => total + day.waterGoalMl, 0) : numberValue((periodBundle.data as any)?.habitAnalytics?.water?.totalGoalMl);
  const waterHitDays = periodScope === "week" ? metricDays.filter(day => day.waterGoalMl > 0 && day.waterConsumedMl >= day.waterGoalMl).length : numberValue((periodBundle.data as any)?.habitAnalytics?.water?.goalHitDays);
  const averageWater = averageValue(waterConsumedMl, Math.max(dayCount, 1));
  const lowestWaterDay = findExtreme(metricDays, day => day.waterConsumedMl, "min");
  const exerciseActiveDays = periodScope === "week" ? metricDays.filter(day => day.exerciseCalories > 0).length : numberValue((periodBundle.data as any)?.habitAnalytics?.exercise?.activeDays);
  const exerciseCalories = periodScope === "week" ? metricDays.reduce((total, day) => total + day.exerciseCalories, 0) : numberValue((periodBundle.data as any)?.habitAnalytics?.exercise?.totalCalories);
  const highestExerciseDay = findExtreme(metricDays, day => day.exerciseCalories, "max");
  const averageExercisePerActiveDay = exerciseActiveDays ? averageValue(exerciseCalories, exerciseActiveDays) : 0;
  const goalCalories = metricDays[0]?.adjustedGoalCalories ?? metricDays[0]?.goalCalories ?? 0;
  const averageCalories = averageValue(totals.calories, Math.max(metricDays.length, 1));
  const activeLoading = periodScope === "week" ? dashboard.isLoading : periodBundle.isLoading;
  const activeError = periodScope === "week" ? dashboard.isError : periodBundle.isError;
  const adherence = macroMetrics[0]?.percent ?? 0;
  const hydrationReading = !metricDays.length ? "Ainda não há dados suficientes para interpretar a hidratação do período." : waterHitDays > 0 ? `${waterHitDays} de ${dayCount} dias bateram a meta de água, o que já permite enxergar consistência no intervalo.` : "Nenhum dia bateu a meta de água neste intervalo, então vale revisar distribuição e frequência dos registros.";
  const exerciseReading = !metricDays.length ? "Ainda não há dados suficientes para interpretar a atividade física do período." : exerciseActiveDays > 1 ? `Os exercícios ficaram distribuídos em ${exerciseActiveDays} dias, o que ajuda a evitar concentração excessiva em um único ponto do período.` : exerciseActiveDays === 1 ? "Toda a atividade física registrada ficou concentrada em um único dia do período." : "Nenhum exercício foi registrado neste intervalo.";

  if (!profile.isLoading && !hasActiveProfile) {
    return <DashboardLayout><div className="mx-auto max-w-3xl"><Card className="border-0 shadow-sm"><CardHeader><CardTitle className="flex items-center gap-2"><ShieldAlert className="h-5 w-5 text-primary" /> Perfil profissional necessário</CardTitle><CardDescription>Ative a área Profissional em Configurações para acompanhar pessoas autorizadas.</CardDescription></CardHeader><CardContent><Button className="rounded-full" onClick={() => setLocation("/settings")}>Ir para Configurações</Button></CardContent></Card></div></DashboardLayout>;
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <PageIntro eyebrow="Profissional" title="Acompanhamento profissional" description="Gerencie vínculos autorizados e analise cada pessoa acompanhada em uma área separada da sua conta." stats={<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><SummaryPill label="Pessoas autorizadas" value={String(approvedAccesses.length)} /><SummaryPill label="Convites pendentes" value={String(pendingAccesses.length)} /><SummaryPill label="Pessoa selecionada" value={selectedAccess ? personLabel(selectedAccess) : "Nenhuma"} /><SummaryPill label="Intervalo" value={formatRangeLabel(activeRange)} /></div>} />

        <div role="tablist" aria-label="Área profissional" className="grid gap-2 rounded-2xl border bg-background p-2 shadow-sm sm:grid-cols-2">
          <button type="button" role="tab" data-value="vinculos" aria-selected={activeTab === "vinculos"} className={`rounded-xl px-4 py-3 text-sm font-medium transition-colors ${activeTab === "vinculos" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`} onClick={() => setActiveTab("vinculos")}>Vínculos de acompanhamento</button>
          <button type="button" role="tab" data-value="analise" aria-selected={activeTab === "analise"} className={`rounded-xl px-4 py-3 text-sm font-medium transition-colors ${activeTab === "analise" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`} onClick={() => setActiveTab("analise")}>Análise por pessoa acompanhada</button>
        </div>

        {activeTab === "vinculos" ? (
          <section role="tabpanel" data-state="active" data-value="vinculos" className="space-y-6">
            <Card className="border-0 shadow-sm"><CardHeader><CardTitle className="flex items-center gap-2"><UserPlus className="h-5 w-5 text-primary" /> Vínculos de acompanhamento</CardTitle><CardDescription>Escolha uma pessoa autorizada ou envie um novo convite.</CardDescription></CardHeader><CardContent className="space-y-4"><div className="grid gap-3 lg:grid-cols-[1fr_1.4fr_auto] lg:items-end"><label className="space-y-2"><Label>E-mail ou celular</Label><Input value={patientContact} onChange={event => setPatientContact(event.target.value.trimStart())} placeholder="pessoa@exemplo.com" /></label><label className="space-y-2"><Label>Motivo</Label><Textarea value={reason} onChange={event => setReason(event.target.value)} className="min-h-11 lg:min-h-11" /></label><Button className="h-11 rounded-full" disabled={requestAccess.isPending || !patientContact.trim()} onClick={() => requestAccess.mutate({ patientContact: patientContact.trim(), reason })}><Mail className="mr-2 h-4 w-4" /> Enviar convite</Button></div>{selectedAccess ? <div className="flex flex-col gap-3 rounded-2xl border bg-muted/20 p-4 text-sm leading-6 text-muted-foreground sm:flex-row sm:items-center sm:justify-between"><div><p className="font-medium text-foreground">{personLabel(selectedAccess)}</p><p>{selectedAccess.patient?.email || `ID interno #${selectedAccess.patientUserId}`}</p><p>{accessDateLabel(selectedAccess)}</p></div><Button type="button" variant="outline" className="w-fit rounded-full" onClick={() => setActiveTab("analise")}>Analisar</Button></div> : !accesses.isLoading ? <ReportEmptyState text={pendingAccesses.length ? "Há convites aguardando autorização, mas nenhuma pessoa liberou acesso ainda." : "Nenhuma pessoa autorizou acompanhamento até agora."} /> : null}</CardContent></Card>
          </section>
        ) : null}

        {activeTab === "analise" ? (
          <section role="tabpanel" data-state="active" data-value="analise" className="space-y-6">
            <Card className="border-0 shadow-sm"><CardHeader><CardTitle>Análise por pessoa acompanhada</CardTitle><CardDescription>Selecione a pessoa e o intervalo antes de navegar por resumo, hoje, relatórios, metas e comentários.</CardDescription></CardHeader><CardContent><div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-end"><label className="min-w-64 space-y-2 text-left"><Label>Pessoa acompanhada</Label><select className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50" value={selectedPatientId ?? ""} onChange={event => setSelectedPatientId(event.target.value ? Number(event.target.value) : null)} disabled={!approvedAccesses.length}><option value="">Selecione uma pessoa</option>{approvedAccesses.map(access => <option key={access.id} value={access.patientUserId}>{personLabel(access)}</option>)}</select></label><PeriodScopeSelector scope={periodScope} onScopeChange={setPeriodScope} selectedDay={selectedDay} onSelectedDayChange={setSelectedDay} selectedMonth={selectedMonth} onSelectedMonthChange={setSelectedMonth} rangeStart={rangeStart} onRangeStartChange={setRangeStart} rangeEnd={rangeEnd} onRangeEndChange={setRangeEnd} /></div></CardContent></Card>
            {!selectedPatientId && !accesses.isLoading ? <ReportEmptyState text="Escolha uma pessoa autorizada para revisar relatórios, metas e evolução no período selecionado." /> : null}
            {selectedAccess ? <div className="rounded-2xl border bg-muted/20 p-4 text-sm leading-6 text-muted-foreground"><p className="font-medium text-foreground">{personLabel(selectedAccess)}</p><p>{selectedAccess.patient?.email || `ID interno #${selectedAccess.patientUserId}`}</p><p>{accessDateLabel(selectedAccess)}</p></div> : null}
            {activeLoading ? <div className="grid gap-4 lg:grid-cols-4"><Skeleton className="h-32 rounded-2xl" /><Skeleton className="h-32 rounded-2xl" /><Skeleton className="h-32 rounded-2xl" /><Skeleton className="h-32 rounded-2xl" /></div> : null}
            {activeError ? <ReportEmptyState text="Não foi possível carregar os relatórios autorizados. Tente novamente em instantes." /> : null}
            {selectedPatientId && !activeLoading && !activeError ? (
              <Tabs defaultValue="resumo" className="space-y-4">
                <TabsList className="grid h-auto w-full grid-cols-1 gap-2 rounded-2xl bg-muted/60 p-2 md:grid-cols-5">
                  <TabsTrigger className="min-h-11 rounded-xl" value="resumo">Resumo</TabsTrigger>
                  <TabsTrigger className="min-h-11 rounded-xl" value="hoje">Hoje</TabsTrigger>
                  <TabsTrigger className="min-h-11 rounded-xl" value="relatorios">Relatórios</TabsTrigger>
                  <TabsTrigger className="min-h-11 rounded-xl" value="metas">Metas</TabsTrigger>
                  <TabsTrigger className="min-h-11 rounded-xl" value="comentarios">Comentários</TabsTrigger>
                </TabsList>

                <TabsContent value="resumo" className="space-y-4">
                  <div className="grid gap-4 lg:grid-cols-4"><ReportHighlightCard title={periodScope === "week" ? "Média semanal" : "Média do período"} value={formatCalories(averageCalories)} description="Média diária no intervalo selecionado." /><ReportHighlightCard title="Total do período" value={formatCalories(totals.calories)} description={`Meta de referência: ${formatCalories(goalCalories)}.`} /><ReportHighlightCard title="Macros realizados" value={formatMacroGrams(totals.protein + totals.carbs + totals.fat)} description="Soma de proteínas, carboidratos e gorduras no período." /><ReportHighlightCard title="Exercícios" value={formatCalories(exerciseCalories)} description={`${exerciseActiveDays}/${dayCount} dias com atividade registrada.`} /></div>
                  <Card className="border-0 shadow-sm"><CardHeader><CardTitle>Leitura rápida</CardTitle><CardDescription>Esta visão é da pessoa selecionada, separada da conta pessoal do profissional.</CardDescription></CardHeader><CardContent className="grid gap-3 md:grid-cols-4"><Metric label="Aderência calórica" value={formatPercent(adherence)} /><Metric label="Dias no intervalo" value={String(dayCount)} /><Metric label="Refeições recentes" value={String(dashboardMeals.length)} /><Metric label="Peso usado" value={weightPoints.length ? `${formatMacro(weightPoints.at(-1)?.weightKg ?? 0)} kg` : "Sem peso"} /></CardContent></Card>
                </TabsContent>

                <TabsContent value="hoje" className="space-y-4">
                  <div className="grid gap-3 md:grid-cols-3"><Metric label="Refeições hoje" value={String(todayMeals.length)} /><Metric label="Calorias no período" value={formatCalories(totals.calories)} /><Metric label="Proteína no período" value={formatMacroGrams(totals.protein)} /></div>
                  <Card className="border-0 shadow-sm"><CardHeader><CardTitle>Registros do dia</CardTitle><CardDescription>Refeições encontradas para hoje no dashboard profissional.</CardDescription></CardHeader><CardContent className="space-y-2">{todayMeals.length ? todayMeals.map(meal => <MealRow key={meal.id} meal={meal} />) : <ReportEmptyState text="Nenhuma refeição registrada hoje para esta pessoa." />}</CardContent></Card>
                </TabsContent>

                <TabsContent value="relatorios" className="space-y-6">
                  <div className="grid gap-4 lg:grid-cols-4"><ReportHighlightCard title={periodScope === "week" ? "Média semanal" : "Média do período"} value={formatCalories(averageCalories)} description="Média diária no intervalo selecionado." /><ReportHighlightCard title="Consumo total" value={formatCalories(totals.calories)} description="Soma das calorias registradas no intervalo ativo." /><ReportHighlightCard title="Macros realizados" value={formatMacroGrams(totals.protein + totals.carbs + totals.fat)} description="Proteínas, carboidratos e gorduras realizados." /><ReportHighlightCard title="Calorias líquidas" value={formatCalories(totals.calories - exerciseCalories)} description={`Exercícios registrados: ${formatCalories(exerciseCalories)}.`} /></div>
                  <ReportMacroAdherenceSection title={periodScope === "week" ? "Aderência semanal às metas" : "Aderência do período às metas"} description="Calorias e macronutrientes usam a mesma leitura visual da tela Relatórios, com dados adaptados da pessoa selecionada." metrics={macroMetrics} />
                  <ReportPlannedVsRealizedMacrosSection metrics={macroMetrics} />
                  <div className="grid gap-6 xl:grid-cols-2"><ReportWaterAnalyticsCard title={periodScope === "week" ? "Hidratação na semana" : "Hidratação no período"} scopeLabel={periodScope === "week" ? "Semanal" : "Período"} description="Esta leitura olha aderência à meta, média diária e o ponto mais fraco do intervalo." totalConsumedMl={waterConsumedMl} totalGoalMl={waterGoalMl} goalHitDays={waterHitDays} totalDays={dayCount} averageDailyMl={averageWater} lowestDay={lowestWaterDay ? `${lowestWaterDay.label} · ${formatCountPtBr(lowestWaterDay.waterConsumedMl, " ml")}` : "-"} reading={hydrationReading} /><ReportExerciseAnalyticsCard title={periodScope === "week" ? "Atividade física na semana" : "Atividade física no período"} scopeLabel={periodScope === "week" ? "Semanal" : "Período"} description="Mostra frequência, distribuição e volume de gasto ao longo do intervalo selecionado." activeDays={exerciseActiveDays} totalDays={dayCount} totalCalories={exerciseCalories} detailLabel="Distribuição" detailValue={`${exerciseActiveDays}/${dayCount} dias`} averageCaloriesPerActiveDay={averageExercisePerActiveDay} highestDay={highestExerciseDay && highestExerciseDay.exerciseCalories > 0 ? `${highestExerciseDay.label} · ${formatCalories(highestExerciseDay.exerciseCalories)}` : "Sem exercício"} reading={exerciseReading} /></div>
                  <ReportTrendSection title={periodScope === "week" ? "Calorias consumidas em relação à meta" : "Tendência diária do período"} description="Comparativo diário dentro do intervalo selecionado." days={trendDays} />
                  <ReportWeightAdherenceCard summary={buildWeightSummary(weightPoints)} adherencePercent={adherence} />
                </TabsContent>

                <TabsContent value="metas" className="space-y-6">
                  {defaultNutritionGoal ? <div className="grid gap-3 md:grid-cols-4"><Metric label="Meta calórica" value={formatCalories(numberValue(defaultNutritionGoal.calories))} /><Metric label="Meta proteína" value={formatMacroGrams(numberValue(defaultNutritionGoal.proteinGrams))} /><Metric label="Meta carboidratos" value={formatMacroGrams(numberValue(defaultNutritionGoal.carbsGrams))} /><Metric label="Meta gorduras" value={formatMacroGrams(numberValue(defaultNutritionGoal.fatGrams))} /></div> : <ReportEmptyState text="Nenhuma meta nutricional encontrada para esta pessoa." />}
                  <ReportPlannedVsRealizedMacrosSection metrics={macroMetrics} />
                  <div className="rounded-2xl border bg-muted/20 p-4 text-sm leading-6 text-muted-foreground">Sugestões de ajuste de metas ficam registradas para acompanhamento, sem alterar automaticamente a meta ativa da pessoa acompanhada.</div>
                  <div data-professional-goal-exception-suggestions-root="true" />
                </TabsContent>

                <TabsContent value="comentarios" className="space-y-4">
                  <Card className="border-0 shadow-sm"><CardHeader><CardTitle>Comentários profissionais</CardTitle><CardDescription>Anotações registradas para acompanhamento da pessoa selecionada.</CardDescription></CardHeader><CardContent className="space-y-3">{dashboardComments.length ? dashboardComments.map((comment, index) => <CommentRow key={comment.id ?? index} comment={comment} />) : <ReportEmptyState text="Nenhum comentário profissional registrado para esta pessoa." />}</CardContent></Card>
                </TabsContent>
              </Tabs>
            ) : null}
          </section>
        ) : null}
      </div>
    </DashboardLayout>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl border bg-background p-4 shadow-sm"><p className="text-sm text-muted-foreground">{label}</p><p className="mt-2 text-xl font-semibold tracking-tight">{value}</p></div>;
}

function MealRow({ meal }: { meal: MealSummary }) {
  return <div className="rounded-xl border bg-background p-3 text-sm"><div className="flex justify-between gap-3"><span className="font-medium">{meal.mealLabel || "Refeição"}</span><span>{formatCalories(numberValue(meal.totals?.calories))}</span></div><p className="text-xs text-muted-foreground">{meal.occurredAt ? new Date(meal.occurredAt).toLocaleString("pt-BR") : "Sem horário"}</p></div>;
}

function CommentRow({ comment }: { comment: ProfessionalComment }) {
  return <div className="rounded-xl border bg-muted/20 p-3 text-sm"><p>{comment.comment || "Comentário sem texto."}</p>{comment.createdAt ? <p className="mt-2 text-xs text-muted-foreground">{new Date(comment.createdAt).toLocaleString("pt-BR")}</p> : null}</div>;
}
