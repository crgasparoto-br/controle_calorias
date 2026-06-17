import React from "react";
import DashboardLayout from "@/components/DashboardLayout";
import PageIntro from "@/components/PageIntro";
import { PeriodScopeSelector } from "@/components/PeriodScopeSelector";
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
import { BarChart3, CalendarDays, Droplets, Dumbbell, Mail, Scale, ShieldAlert, UserPlus } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
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
type PatientAccess = {
  id: string;
  patientUserId: number;
  status: string;
  requestedAt: number;
  approvedAt: number | null;
  revokedAt: number | null;
  patient?: { name: string | null; email: string | null } | null;
};

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
function formatMacro(value: number) {
  return formatNumberPtBr(value, { minimumFractionDigits: Number.isInteger(value) ? 0 : 1, maximumFractionDigits: 1 });
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
  return value === null ? null : `${formatNumberPtBr(value, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} g/kg/dia`;
}
function progressPercent(value: number, goal: number) {
  return goal ? Math.min(Math.max((value / goal) * 100, 0), 100) : 0;
}
function averageValue(total: number, count: number) {
  return count ? total / count : 0;
}
function getCalorieBarColor(calories: number, goalCalories: number) {
  return goalCalories > 0 && calories > goalCalories ? "#dc2626" : "#10b981";
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
function calculateMacroMetrics(days: ReportDay[], weights: WeightPoint[]): MacroMetric[] {
  const caloriesPlanned = days.reduce((total, day) => total + day.adjustedGoalCalories, 0);
  const caloriesRealized = days.reduce((total, day) => total + day.calories, 0);
  const metrics: MacroMetric[] = [{ key: "calories", title: "Calorias", unit: "kcal", planned: caloriesPlanned, realized: caloriesRealized, percent: progressPercent(caloriesRealized, caloriesPlanned), difference: caloriesRealized - caloriesPlanned, plannedPerKgDay: null, realizedPerKgDay: null }];
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
  const dashboard = trpc.nutrition.professionals.patientDashboard.useQuery({ patientId: selectedPatientId ?? 0, weekOffset }, { enabled: hasActiveProfile && Boolean(selectedPatientId) && periodScope === "week" });
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

  const weeklyDays = React.useMemo<ReportDay[]>(() => ((dashboard.data as any)?.weeklyReport ?? []).map((day: any) => normalizeDay(day)), [dashboard.data]);
  const periodDays = React.useMemo<ReportDay[]>(() => ((periodBundle.data as any)?.daily ?? []).map((day: any) => normalizeDay(day, (periodBundle.data as any)?.goal)), [periodBundle.data]);
  const metricDays: ReportDay[] = periodScope === "week" ? weeklyDays : periodDays;
  const totals = metricDays.reduce<Totals>((acc, day) => ({ calories: acc.calories + day.calories, protein: acc.protein + day.protein, carbs: acc.carbs + day.carbs, fat: acc.fat + day.fat }), { ...EMPTY_TOTALS });
  const dayCount = metricDays.length || countDaysInRange(activeRange);
  const weightPoints = periodScope === "week"
    ? normalizeWeightPoints((dashboard.data as any)?.weight, (dashboard.data as any)?.progress?.weight)
    : normalizeWeightPoints((periodBundle.data as any)?.weightTrend);
  const macroMetrics = calculateMacroMetrics(metricDays, weightPoints);
  const waterConsumedMl = periodScope === "week" ? metricDays.reduce((total, day) => total + day.waterConsumedMl, 0) : numberValue((periodBundle.data as any)?.habitAnalytics?.water?.totalConsumedMl);
  const waterGoalMl = periodScope === "week" ? metricDays.reduce((total, day) => total + day.waterGoalMl, 0) : numberValue((periodBundle.data as any)?.habitAnalytics?.water?.totalGoalMl);
  const waterHitDays = periodScope === "week" ? metricDays.filter(day => day.waterGoalMl > 0 && day.waterConsumedMl >= day.waterGoalMl).length : numberValue((periodBundle.data as any)?.habitAnalytics?.water?.goalHitDays);
  const exerciseActiveDays = periodScope === "week" ? metricDays.filter(day => day.exerciseCalories > 0).length : numberValue((periodBundle.data as any)?.habitAnalytics?.exercise?.activeDays);
  const exerciseCalories = periodScope === "week" ? metricDays.reduce((total, day) => total + day.exerciseCalories, 0) : numberValue((periodBundle.data as any)?.habitAnalytics?.exercise?.totalCalories);
  const goalCalories = metricDays[0]?.adjustedGoalCalories ?? 0;
  const averageCalories = averageValue(totals.calories, Math.max(metricDays.length, 1));
  const activeLoading = periodScope === "week" ? dashboard.isLoading : periodBundle.isLoading;
  const activeError = periodScope === "week" ? dashboard.isError : periodBundle.isError;
  const adherence = macroMetrics[0]?.percent ?? 0;

  if (!profile.isLoading && !hasActiveProfile) {
    return <DashboardLayout><div className="mx-auto max-w-3xl"><Card className="border-0 shadow-sm"><CardHeader><CardTitle className="flex items-center gap-2"><ShieldAlert className="h-5 w-5 text-primary" /> Perfil profissional necessário</CardTitle><CardDescription>Ative a área Profissional em Configurações para acompanhar pessoas autorizadas.</CardDescription></CardHeader><CardContent><Button className="rounded-full" onClick={() => setLocation("/settings")}>Ir para Configurações</Button></CardContent></Card></div></DashboardLayout>;
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div role="tablist" aria-label="Área profissional" className="grid gap-2 rounded-2xl border bg-background p-2 shadow-sm sm:grid-cols-2">
          <button type="button" role="tab" data-value="vinculos" aria-selected={activeTab === "vinculos"} className={`rounded-xl px-4 py-3 text-sm font-medium transition-colors ${activeTab === "vinculos" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`} onClick={() => setActiveTab("vinculos")}>Vínculos de acompanhamento</button>
          <button type="button" role="tab" data-value="analise" aria-selected={activeTab === "analise"} className={`rounded-xl px-4 py-3 text-sm font-medium transition-colors ${activeTab === "analise" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`} onClick={() => setActiveTab("analise")}>Análise por pessoa acompanhada</button>
        </div>

        {activeTab === "vinculos" ? (
          <section role="tabpanel" data-state="active" data-value="vinculos" className="space-y-6">
            <Card className="border-0 shadow-sm"><CardHeader><CardTitle className="flex items-center gap-2"><UserPlus className="h-5 w-5 text-primary" /> Vínculos de acompanhamento</CardTitle><CardDescription>Escolha uma pessoa autorizada ou envie um novo convite.</CardDescription></CardHeader><CardContent className="space-y-4"><div className="grid gap-3 lg:grid-cols-[1fr_1.4fr_auto] lg:items-end"><label className="space-y-2"><Label>E-mail ou celular</Label><Input value={patientContact} onChange={event => setPatientContact(event.target.value.trimStart())} placeholder="pessoa@exemplo.com" /></label><label className="space-y-2"><Label>Motivo</Label><Textarea value={reason} onChange={event => setReason(event.target.value)} className="min-h-11 lg:min-h-11" /></label><Button className="h-11 rounded-full" disabled={requestAccess.isPending || !patientContact.trim()} onClick={() => requestAccess.mutate({ patientContact: patientContact.trim(), reason })}><Mail className="mr-2 h-4 w-4" /> Enviar convite</Button></div>{selectedAccess ? <div className="flex flex-col gap-3 rounded-2xl border bg-muted/20 p-4 text-sm leading-6 text-muted-foreground sm:flex-row sm:items-center sm:justify-between"><div><p className="font-medium text-foreground">{personLabel(selectedAccess)}</p><p>{selectedAccess.patient?.email || `ID interno #${selectedAccess.patientUserId}`}</p><p>{accessDateLabel(selectedAccess)}</p></div><Button type="button" variant="outline" className="w-fit rounded-full" onClick={() => setActiveTab("analise")}>Analisar</Button></div> : !accesses.isLoading ? <Empty text={pendingAccesses.length ? "Há convites aguardando autorização, mas nenhuma pessoa liberou acesso ainda." : "Nenhuma pessoa autorizou acompanhamento até agora."} /> : null}</CardContent></Card>
          </section>
        ) : null}

        {activeTab === "analise" ? (
          <section role="tabpanel" data-state="active" data-value="analise" className="space-y-6">
            <PageIntro eyebrow="Profissional" title="Relatórios da pessoa acompanhada" description={`A visão profissional usa os mesmos objetos equivalentes da tela Reports. Intervalo ativo: ${formatRangeLabel(activeRange)}.`} stats={<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><SummaryPill label="Calorias" value={formatCalories(totals.calories)} /><SummaryPill label="Proteínas" value={formatMacroGrams(totals.protein)} /><SummaryPill label="Carboidratos" value={formatMacroGrams(totals.carbs)} /><SummaryPill label="Gorduras" value={formatMacroGrams(totals.fat)} /><SummaryPill label="Pessoas" value={String(approvedAccesses.length)} /></div>} actions={<div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-end"><label className="min-w-64 space-y-2 text-left"><Label>Pessoa acompanhada</Label><select className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50" value={selectedPatientId ?? ""} onChange={event => setSelectedPatientId(event.target.value ? Number(event.target.value) : null)} disabled={!approvedAccesses.length}><option value="">Selecione uma pessoa</option>{approvedAccesses.map(access => <option key={access.id} value={access.patientUserId}>{personLabel(access)}</option>)}</select></label><PeriodScopeSelector scope={periodScope} onScopeChange={setPeriodScope} selectedDay={selectedDay} onSelectedDayChange={setSelectedDay} selectedMonth={selectedMonth} onSelectedMonthChange={setSelectedMonth} rangeStart={rangeStart} onRangeStartChange={setRangeStart} rangeEnd={rangeEnd} onRangeEndChange={setRangeEnd} /></div>} />
            {!selectedPatientId && !accesses.isLoading ? <Empty text="Escolha uma pessoa autorizada para revisar relatórios, metas e evolução no período selecionado." /> : null}
            {selectedAccess ? <div className="rounded-2xl border bg-muted/20 p-4 text-sm leading-6 text-muted-foreground"><p className="font-medium text-foreground">{personLabel(selectedAccess)}</p><p>{selectedAccess.patient?.email || `ID interno #${selectedAccess.patientUserId}`}</p><p>{accessDateLabel(selectedAccess)}</p></div> : null}
            {activeLoading ? <div className="grid gap-4 lg:grid-cols-4"><Skeleton className="h-32 rounded-2xl" /><Skeleton className="h-32 rounded-2xl" /><Skeleton className="h-32 rounded-2xl" /><Skeleton className="h-32 rounded-2xl" /></div> : null}
            {activeError ? <Empty text="Não foi possível carregar os relatórios autorizados. Tente novamente em instantes." /> : null}
            {selectedPatientId && !activeLoading && !activeError ? <><div className="grid gap-4 lg:grid-cols-4"><HighlightCard title={periodScope === "week" ? "Média semanal" : "Média do período"} value={formatCalories(averageCalories)} description="Média diária no intervalo selecionado." /><HighlightCard title="Total do período" value={formatCalories(totals.calories)} description={`Meta de referência: ${formatCalories(goalCalories)}.`} /><HighlightCard title="Macros realizados" value={formatMacroGrams(totals.protein + totals.carbs + totals.fat)} description="Soma de proteínas, carboidratos e gorduras no período." /><HighlightCard title="Exercícios" value={formatCalories(exerciseCalories)} description={`${exerciseActiveDays}/${dayCount} dias com atividade registrada.`} /></div><MacroAdherenceSection title={periodScope === "week" ? "Aderência semanal às metas" : "Aderência do período às metas"} metrics={macroMetrics} /><PlannedVsRealizedMacrosSection metrics={macroMetrics} /><div className="grid gap-6 xl:grid-cols-2"><WaterCard totalConsumedMl={waterConsumedMl} totalGoalMl={waterGoalMl} goalHitDays={waterHitDays} totalDays={dayCount} /><ExerciseCard activeDays={exerciseActiveDays} totalDays={dayCount} totalCalories={exerciseCalories} /></div><TrendSection days={metricDays} /><WeightAdherenceSection weights={weightPoints} adherencePercent={adherence} /><div data-professional-goal-exception-suggestions-root="true" /></> : null}
          </section>
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
  return <Card className="border bg-muted/10 shadow-none"><CardHeader><CardTitle className="text-base">{metric.title}</CardTitle><CardDescription>{formatPercent(metric.percent)} realizado vs planejado</CardDescription></CardHeader><CardContent className="space-y-4"><Progress className="h-2" value={metric.percent} /><div className="grid gap-3 sm:grid-cols-3"><CompactMetric label="Planejado" value={plannedValue} /><CompactMetric label="Realizado" value={realizedValue} /><CompactMetric label="Diferença" value={formatSigned(metric.difference, metric.unit)} /></div>{showPerKg && metric.unit === "g" ? plannedPerKg && realizedPerKg ? <div className="grid gap-3 sm:grid-cols-2"><CompactMetric label="Planejado" value={plannedPerKg} /><CompactMetric label="Realizado" value={realizedPerKg} /></div> : <Empty text="Informe um peso para calcular g/kg/dia deste período." /> : null}</CardContent></Card>;
}
function MacroAdherenceSection({ title, metrics }: { title: string; metrics: MacroMetric[] }) {
  return <Card className="border-0 shadow-sm"><CardHeader><CardTitle className="flex items-center gap-2"><CalendarDays className="h-5 w-5 text-primary" /> {title}</CardTitle><CardDescription>Calorias, proteínas, carboidratos e gorduras seguem a mesma leitura da tela Reports.</CardDescription></CardHeader><CardContent className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">{metrics.map(metric => <MacroMetricCard key={metric.key} metric={metric} />)}</CardContent></Card>;
}
function PlannedVsRealizedMacrosSection({ metrics }: { metrics: MacroMetric[] }) {
  return <Card className="border-0 shadow-sm"><CardHeader><CardTitle>Macronutrientes planejados vs realizados</CardTitle><CardDescription>Totais do período e média por peso de referência em g/kg/dia.</CardDescription></CardHeader><CardContent className="grid gap-4 xl:grid-cols-3">{metrics.filter(metric => metric.unit === "g").map(metric => <MacroMetricCard key={metric.key} metric={metric} showPerKg />)}</CardContent></Card>;
}
function WaterCard({ totalConsumedMl, totalGoalMl, goalHitDays, totalDays }: { totalConsumedMl: number; totalGoalMl: number; goalHitDays: number; totalDays: number }) {
  const adherence = progressPercent(totalConsumedMl, totalGoalMl);
  return <Card className="border-0 shadow-sm"><CardHeader><CardTitle className="flex items-center gap-2"><Droplets className="h-5 w-5 text-primary" /> Hidratação no período</CardTitle><CardDescription>Mesmo resumo de água usado em Reports.</CardDescription></CardHeader><CardContent className="space-y-4"><Progress className="h-2" value={adherence} /><div className="grid gap-3 sm:grid-cols-2"><StatusTile label="Meta do período" value={formatCountPtBr(Math.round(totalGoalMl), " ml")} /><StatusTile label="Consumo acumulado" value={formatCountPtBr(Math.round(totalConsumedMl), " ml")} /><StatusTile label="Meta batida" value={`${goalHitDays}/${totalDays} dias`} /><StatusTile label="Aderência" value={formatPercent(adherence)} /></div></CardContent></Card>;
}
function ExerciseCard({ activeDays, totalDays, totalCalories }: { activeDays: number; totalDays: number; totalCalories: number }) {
  return <Card className="border-0 shadow-sm"><CardHeader><CardTitle className="flex items-center gap-2"><Dumbbell className="h-5 w-5 text-primary" /> Atividade física no período</CardTitle><CardDescription>Mostra frequência e gasto estimado no intervalo selecionado.</CardDescription></CardHeader><CardContent className="grid gap-3 sm:grid-cols-2"><CompactMetric label="Dias ativos" value={`${activeDays}/${totalDays}`} /><CompactMetric label="Gasto total" value={formatCalories(totalCalories)} /><StatusTile label="Distribuição" value={`${activeDays}/${totalDays} dias`} /><StatusTile label="Média por dia ativo" value={activeDays ? formatCalories(averageValue(totalCalories, activeDays)) : "0 kcal"} /></CardContent></Card>;
}
function TrendSection({ days }: { days: ReportDay[] }) {
  if (!days.length) return <Empty text="Ainda não há dados suficientes no intervalo para desenhar a tendência." />;
  return <div className="grid gap-6 xl:grid-cols-[1.2fr,0.8fr]"><Card className="border-0 shadow-sm"><CardHeader><CardTitle className="flex items-center gap-2"><BarChart3 className="h-5 w-5 text-primary" /> Calorias consumidas em relação à meta</CardTitle><CardDescription>Comparativo diário dentro do intervalo selecionado.</CardDescription></CardHeader><CardContent className="h-[360px]"><ResponsiveContainer width="100%" height="100%"><BarChart data={days} barSize={28}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="label" /><YAxis /><Tooltip /><Legend /><Bar dataKey="adjustedGoalCalories" name="Meta" fill="#cbd5e1" radius={[8, 8, 0, 0]} /><Bar dataKey="calories" name="Consumido" radius={[8, 8, 0, 0]}>{days.map(day => <Cell key={day.date} fill={getCalorieBarColor(day.calories, day.adjustedGoalCalories)} />)}</Bar></BarChart></ResponsiveContainer></CardContent></Card><Card className="border-0 shadow-sm"><CardHeader><CardTitle>Distribuição de macronutrientes</CardTitle><CardDescription>Evolução agregada de proteínas, carboidratos e gorduras.</CardDescription></CardHeader><CardContent className="h-[360px]"><ResponsiveContainer width="100%" height="100%"><LineChart data={days}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="label" /><YAxis /><Tooltip /><Legend /><Line type="monotone" dataKey="protein" name="Proteínas" stroke="#10b981" strokeWidth={3} dot={{ r: 4 }} /><Line type="monotone" dataKey="carbs" name="Carboidratos" stroke="#0ea5e9" strokeWidth={3} dot={{ r: 4 }} /><Line type="monotone" dataKey="fat" name="Gorduras" stroke="#f59e0b" strokeWidth={3} dot={{ r: 4 }} /></LineChart></ResponsiveContainer></CardContent></Card></div>;
}
function WeightAdherenceSection({ weights, adherencePercent }: { weights: WeightPoint[]; adherencePercent: number }) {
  const usable = weights.filter(weight => Number(weight.weightKg) > 0).sort((a, b) => a.date.localeCompare(b.date));
  const first = usable[0]?.weightKg ?? null;
  const last = usable.at(-1)?.weightKg ?? null;
  const delta = first != null && last != null ? last - first : null;
  return <Card className="border-0 shadow-sm"><CardHeader><CardTitle className="flex items-center gap-2"><Scale className="h-5 w-5 text-primary" /> Evolução do peso e aderência</CardTitle><CardDescription>Relaciona o peso de referência usado no g/kg/dia com a aderência calórica do período.</CardDescription></CardHeader><CardContent>{usable.length ? <div className="grid gap-3 sm:grid-cols-4"><StatusTile label="Inicial" value={`${formatMacro(first ?? 0)} kg`} /><StatusTile label="Atual" value={`${formatMacro(last ?? 0)} kg`} /><StatusTile label="Variação" value={delta == null ? "-" : `${delta > 0 ? "+" : ""}${formatMacro(delta)} kg`} /><StatusTile label="Aderência calórica" value={formatPercent(adherencePercent)} /></div> : <Empty text="Ainda não há peso registrado para compor a leitura do período." />}</CardContent></Card>;
}
function HighlightCard({ title, value, description }: { title: string; value: string; description: string }) {
  return <Card className="border-0 shadow-sm"><CardContent className="p-5"><p className="text-sm text-muted-foreground">{title}</p><p className="mt-2 text-3xl font-semibold tracking-tight">{value}</p><p className="mt-2 text-sm text-muted-foreground">{description}</p></CardContent></Card>;
}
function StatusTile({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded-2xl border bg-background p-4 shadow-sm"><p className="text-sm text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p></div>;
}
function CompactMetric({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded-2xl border bg-muted/10 px-4 py-3"><p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-1 text-lg font-semibold tracking-tight">{value}</p></div>;
}
function Empty({ text }: { text: string }) {
  return <div className="rounded-2xl border border-dashed bg-muted/20 p-6 text-sm leading-6 text-muted-foreground">{text}</div>;
}
