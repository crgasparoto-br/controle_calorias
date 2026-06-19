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
import { formatCalories, formatCountPtBr, formatGrams } from "@/lib/numberFormat";
import { trpc } from "@/lib/trpc";
import { Mail, MessageSquarePlus, ShieldAlert, Target, UserPlus, X } from "lucide-react";
import { toast } from "sonner";
import { useLocation } from "wouter";

type MacroKey = "protein" | "carbs" | "fat";
type ProfessionalTab = "vinculos" | "analise";
type DurationType = "always" | "1_week" | "2_weeks" | "3_weeks" | string;
type Totals = { calories: number; protein: number; carbs: number; fat: number };
type GoalTarget = { calories: number; proteinGrams: number; carbsGrams: number; fatGrams: number };
type GoalDayView = GoalTarget & { weekday: number; label: string; shortLabel?: string; source?: string; durationType?: DurationType };
type GoalExceptionView = GoalTarget & { id?: string | number; weekday: number; label?: string; shortLabel?: string; durationType: DurationType; isActive?: boolean };
type NutritionGoalView = { defaultGoal?: Partial<GoalTarget> | null; exceptions?: GoalExceptionView[]; days?: GoalDayView[]; today?: GoalDayView; weeklyTotals?: GoalTarget };
type ReportDay = Totals & { date: string; label: string; goalCalories: number; adjustedGoalCalories: number; goalProtein: number; goalCarbs: number; goalFat: number; waterConsumedMl: number; waterGoalMl: number; exerciseCalories: number };
type WeightPoint = { date: string; weightKg: number | null };
type PatientAccess = { id: string; patientUserId: number; status: string; requestedAt: number; approvedAt: number | null; revokedAt: number | null; patient?: { name: string | null; email: string | null } | null };
type ProfessionalComment = { id?: string | number; comment?: string | null; createdAt?: string | number | Date | null };
type PatientAiAnswer = { answer: string; citedContext: string[]; caution?: string; educationalNotice: string; generatedAt: number };
type GoalSuggestion = { id: string | number; status?: string | null; rationale?: string | null; createdAt?: string | number | Date | null; goal?: { defaultGoal?: Partial<GoalTarget>; exceptions?: unknown[] } | null };
type MealSuggestion = { id: string | number; status?: string | null; mealLabel?: string | null; title?: string | null; description?: string | null; rationale?: string | null; notes?: string | null; createdAt?: string | number | Date | null };

const EMPTY_TOTALS: Totals = { calories: 0, protein: 0, carbs: 0, fat: 0 };
const MACRO_META: Array<{ key: MacroKey; title: string; goalKey: "goalProtein" | "goalCarbs" | "goalFat" }> = [
  { key: "protein", title: "Proteínas", goalKey: "goalProtein" },
  { key: "carbs", title: "Carboidratos", goalKey: "goalCarbs" },
  { key: "fat", title: "Gorduras", goalKey: "goalFat" },
];
const ACCESS_STATUS_LABELS: Record<string, string> = { pending: "Aguardando autorização", approved: "Autorizado", rejected: "Recusado", revoked: "Revogado" };
const HIDDEN_PROFESSIONAL_PATIENT_EMAILS = new Set(["marcia.maldonado@gmail.com"]);
const GOAL_WEEKDAYS = [
  { weekday: 0, label: "Segunda-feira", shortLabel: "seg." },
  { weekday: 1, label: "Terça-feira", shortLabel: "ter." },
  { weekday: 2, label: "Quarta-feira", shortLabel: "qua." },
  { weekday: 3, label: "Quinta-feira", shortLabel: "qui." },
  { weekday: 4, label: "Sexta-feira", shortLabel: "sex." },
  { weekday: 5, label: "Sábado", shortLabel: "sáb." },
  { weekday: 6, label: "Domingo", shortLabel: "dom." },
] as const;

function numberValue(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}
function accessStatusLabel(status: string) { return ACCESS_STATUS_LABELS[status] ?? status; }
function isHiddenProfessionalPatientAccess(access: PatientAccess) { return HIDDEN_PROFESSIONAL_PATIENT_EMAILS.has(access.patient?.email?.trim().toLowerCase() ?? ""); }
function suggestionStatusLabel(status?: string | null) {
  const labels: Record<string, string> = { draft: "Rascunho", sent: "Enviada", accepted: "Aceita", refused: "Recusada", cancelled: "Cancelada" };
  return labels[status || ""] ?? status ?? "Registrada";
}
function weekdayLabel(weekday: number) { return GOAL_WEEKDAYS.find(day => day.weekday === weekday)?.label ?? `Dia ${weekday}`; }
function shortWeekdayLabel(weekday: number) { return GOAL_WEEKDAYS.find(day => day.weekday === weekday)?.shortLabel ?? String(weekday); }
function durationTypeLabel(durationType: DurationType) {
  const labels: Record<string, string> = { always: "Sempre", "1_week": "1 semana", "2_weeks": "2 semanas", "3_weeks": "3 semanas" };
  return labels[durationType] ?? durationType;
}
function personLabel(access: PatientAccess) { return access.patient?.name || access.patient?.email || `Pessoa #${access.patientUserId}`; }
function accessDateLabel(access: PatientAccess) {
  if (access.status === "approved" && access.approvedAt) return `Autorizado em ${new Date(access.approvedAt).toLocaleString("pt-BR")}`;
  if (access.status === "revoked" && access.revokedAt) return `Revogado em ${new Date(access.revokedAt).toLocaleString("pt-BR")}`;
  return `Solicitado em ${new Date(access.requestedAt).toLocaleString("pt-BR")}`;
}
function dateTimeLabel(value?: string | number | Date | null) { return value ? new Date(value).toLocaleString("pt-BR") : "Sem data"; }
function normalizeDay(day: any, fallbackGoal?: any): ReportDay {
  return {
    date: String(day.date ?? ""), label: String(day.label ?? day.date ?? "-"), calories: numberValue(day.calories), protein: numberValue(day.protein), carbs: numberValue(day.carbs), fat: numberValue(day.fat),
    goalCalories: numberValue(day.goalCalories ?? fallbackGoal?.calories), adjustedGoalCalories: numberValue(day.adjustedGoalCalories ?? day.goalCalories ?? fallbackGoal?.calories),
    goalProtein: numberValue(day.goalProtein ?? fallbackGoal?.protein ?? fallbackGoal?.proteinGrams), goalCarbs: numberValue(day.goalCarbs ?? fallbackGoal?.carbs ?? fallbackGoal?.carbsGrams), goalFat: numberValue(day.goalFat ?? fallbackGoal?.fat ?? fallbackGoal?.fatGrams),
    waterConsumedMl: numberValue(day.waterConsumedMl), waterGoalMl: numberValue(day.waterGoalMl), exerciseCalories: numberValue(day.exerciseCalories),
  };
}
function normalizeWeightPoints(...sources: any[]): WeightPoint[] {
  for (const value of sources) {
    const entries = value?.entries ?? value?.points ?? value?.summary?.entries ?? [];
    const points = entries.map((entry: any) => ({ date: String(entry.date ?? ""), weightKg: numberValue(entry.weightKg) || null })).filter((entry: WeightPoint) => entry.date && Number(entry.weightKg) > 0);
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
function toTrendDay(day: ReportDay): ReportTrendDay { return { date: day.date, label: day.label, calories: day.calories, protein: day.protein, carbs: day.carbs, fat: day.fat, goalCalories: day.adjustedGoalCalories || day.goalCalories }; }
function buildWeightSummary(weights: WeightPoint[]) {
  const usable = weights.filter(weight => Number(weight.weightKg) > 0).sort((a, b) => a.date.localeCompare(b.date));
  const firstWeightKg = usable[0]?.weightKg ?? null;
  const lastWeightKg = usable.at(-1)?.weightKg ?? null;
  return { hasData: usable.length > 0, firstWeightKg, lastWeightKg, deltaKg: firstWeightKg != null && lastWeightKg != null ? lastWeightKg - firstWeightKg : null };
}
function normalizeGoalTarget(goal?: Partial<GoalTarget> | null): GoalTarget {
  return { calories: numberValue(goal?.calories), proteinGrams: numberValue(goal?.proteinGrams), carbsGrams: numberValue(goal?.carbsGrams), fatGrams: numberValue(goal?.fatGrams) };
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
  const [comment, setComment] = React.useState("");
  const [patientQuestion, setPatientQuestion] = React.useState("");
  const [patientAnswer, setPatientAnswer] = React.useState<PatientAiAnswer | null>(null);
  const [goalSuggestion, setGoalSuggestion] = React.useState({ calories: "", proteinGrams: "", carbsGrams: "", fatGrams: "", rationale: "" });
  const [mealSuggestion, setMealSuggestion] = React.useState({ mealLabel: "Almoço", title: "", description: "", rationale: "", notes: "" });
  const [periodScope, setPeriodScope] = React.useState<PeriodScope>("week");
  const [selectedDay, setSelectedDay] = React.useState(() => toDateInputValue());
  const [selectedMonth, setSelectedMonth] = React.useState(() => toMonthInputValue(new Date(), userTimeZone));
  const [rangeStart, setRangeStart] = React.useState(() => toDateInputValue(new Date(Date.now() - 13 * 24 * 60 * 60 * 1000), userTimeZone));
  const [rangeEnd, setRangeEnd] = React.useState(() => toDateInputValue());
  const activeRange = React.useMemo(() => periodScope === "day" ? { start: selectedDay, end: selectedDay } : periodScope === "week" ? getWeekRange(selectedDay) : periodScope === "month" ? getMonthRange(selectedMonth) : normalizeDateRange(rangeStart, rangeEnd), [periodScope, rangeEnd, rangeStart, selectedDay, selectedMonth]);
  const weekOffset = React.useMemo(() => getWeekOffsetFromToday(selectedDay, userTimeZone), [selectedDay, userTimeZone]);
  const visibleAccesses = React.useMemo<PatientAccess[]>(() => ((accesses.data ?? []) as PatientAccess[]).filter(access => !isHiddenProfessionalPatientAccess(access)), [accesses.data]);
  const approvedAccesses = React.useMemo<PatientAccess[]>(() => visibleAccesses.filter(access => access.status === "approved"), [visibleAccesses]);
  const pendingAccesses = React.useMemo(() => visibleAccesses.filter(access => access.status === "pending"), [visibleAccesses]);
  const nonApprovedAccesses = React.useMemo<PatientAccess[]>(() => visibleAccesses.filter(access => access.status !== "approved"), [visibleAccesses]);
  const selectedAccess = approvedAccesses.find(access => access.patientUserId === selectedPatientId) ?? null;
  const dashboard = trpc.nutrition.professionals.patientDashboard.useQuery({ patientId: selectedPatientId ?? 0, weekOffset }, { enabled: hasActiveProfile && Boolean(selectedPatientId) });
  const periodBundle = trpc.nutrition.professionals.patientPeriodBundle.useQuery({ patientId: selectedPatientId ?? 0, startDate: activeRange.start, endDate: activeRange.end }, { enabled: hasActiveProfile && Boolean(selectedPatientId) && periodScope !== "week" });

  React.useEffect(() => {
    if (!selectedPatientId && approvedAccesses.length) setSelectedPatientId(approvedAccesses[0].patientUserId);
    if (selectedPatientId && approvedAccesses.length && !approvedAccesses.some(access => access.patientUserId === selectedPatientId)) setSelectedPatientId(approvedAccesses[0].patientUserId);
  }, [approvedAccesses, selectedPatientId]);

  const dashboardData = dashboard.data as any;
  const nutritionGoal = dashboardData?.nutritionGoal as NutritionGoalView | undefined;
  const defaultNutritionGoal = normalizeGoalTarget(nutritionGoal?.defaultGoal);
  const hasNutritionGoal = Boolean(nutritionGoal?.defaultGoal);
  const goalSuggestions = ((dashboardData?.goalSuggestions ?? []) as GoalSuggestion[]);
  const mealSuggestions = ((dashboardData?.mealSuggestions ?? []) as MealSuggestion[]);
  const suggestedCalories = Number(goalSuggestion.calories);
  const suggestedProtein = Number(goalSuggestion.proteinGrams);
  const suggestedCarbs = Number(goalSuggestion.carbsGrams);
  const suggestedFat = Number(goalSuggestion.fatGrams);
  const weeklyGoalDays = nutritionGoal?.days?.length ? nutritionGoal.days : GOAL_WEEKDAYS.map(day => ({ ...day, source: "default", ...defaultNutritionGoal }));
  const weeklyGoalTotals = nutritionGoal?.weeklyTotals ?? weeklyGoalDays.reduce((total, day) => ({ calories: total.calories + numberValue(day.calories), proteinGrams: total.proteinGrams + numberValue(day.proteinGrams), carbsGrams: total.carbsGrams + numberValue(day.carbsGrams), fatGrams: total.fatGrams + numberValue(day.fatGrams) }), { calories: 0, proteinGrams: 0, carbsGrams: 0, fatGrams: 0 });
  const activeExceptions = nutritionGoal?.exceptions?.filter(exception => exception.isActive !== false) ?? [];
  const canSuggestGoal = Boolean(selectedPatientId && goalSuggestion.rationale.trim() && suggestedCalories > 0 && suggestedProtein > 0 && suggestedCarbs > 0 && suggestedFat > 0);
  const canSuggestMeal = Boolean(selectedPatientId && mealSuggestion.mealLabel.trim() && mealSuggestion.title.trim() && mealSuggestion.description.trim() && mealSuggestion.rationale.trim());
  const canAskQuestion = Boolean(selectedPatientId && patientQuestion.trim().length >= 3);

  React.useEffect(() => { setPatientAnswer(null); setPatientQuestion(""); setComment(""); }, [selectedPatientId]);
  React.useEffect(() => {
    if (!hasNutritionGoal) {
      setGoalSuggestion(previous => ({ ...previous, calories: "", proteinGrams: "", carbsGrams: "", fatGrams: "" }));
      return;
    }
    setGoalSuggestion(previous => ({ ...previous, calories: String(defaultNutritionGoal.calories), proteinGrams: String(defaultNutritionGoal.proteinGrams), carbsGrams: String(defaultNutritionGoal.carbsGrams), fatGrams: String(defaultNutritionGoal.fatGrams) }));
  }, [defaultNutritionGoal.calories, defaultNutritionGoal.proteinGrams, defaultNutritionGoal.carbsGrams, defaultNutritionGoal.fatGrams, hasNutritionGoal, selectedPatientId]);

  const invalidateProfessionalData = async () => {
    await Promise.all([utils.auth.me.invalidate(), utils.nutrition.professionals.profile.invalidate(), utils.nutrition.professionals.myAccesses.invalidate()]);
    if (selectedPatientId) await utils.nutrition.professionals.patientDashboard.invalidate({ patientId: selectedPatientId });
  };
  const requestAccess = trpc.nutrition.professionals.requestAccess.useMutation({ onSuccess: async () => { toast.success("Solicitação enviada. A pessoa acompanhada precisa autorizar antes do acesso."); setPatientContact(""); await invalidateProfessionalData(); }, onError: error => toast.error(error.message || "Não foi possível solicitar acesso.") });
  const revokeAccess = trpc.nutrition.professionals.revokeAccess.useMutation({ onSuccess: async () => { toast.success("Vínculo revogado."); setSelectedPatientId(null); await invalidateProfessionalData(); }, onError: error => toast.error(error.message || "Não foi possível revogar o vínculo.") });
  const addComment = trpc.nutrition.professionals.addComment.useMutation({ onSuccess: async () => { toast.success("Comentário adicionado."); setComment(""); await invalidateProfessionalData(); }, onError: error => toast.error(error.message || "Não foi possível comentar.") });
  const suggestGoal = trpc.nutrition.professionals.suggestGoalAdjustment.useMutation({ onSuccess: async () => { toast.success("Sugestão de meta registrada para acompanhamento."); setGoalSuggestion(previous => ({ ...previous, rationale: "" })); await invalidateProfessionalData(); }, onError: error => toast.error(error.message || "Não foi possível sugerir a meta.") });
  const suggestMeal = trpc.nutrition.professionals.suggestMealPlan.useMutation({ onSuccess: async () => { toast.success("Sugestão de refeição registrada para acompanhamento."); setMealSuggestion(previous => ({ ...previous, title: "", description: "", rationale: "", notes: "" })); await invalidateProfessionalData(); }, onError: error => toast.error(error.message || "Não foi possível sugerir a refeição.") });
  const askPatientQuestion = trpc.nutrition.professionals.askPatientQuestion.useMutation({ onSuccess: answer => { setPatientAnswer(answer as PatientAiAnswer); toast.success("Resposta gerada com contexto autorizado."); }, onError: error => toast.error(error.message || "Não foi possível responder a pergunta.") });

  const dashboardComments = (((dashboardData?.comments ?? []) as ProfessionalComment[]));
  const weeklyDays = React.useMemo<ReportDay[]>(() => ((dashboardData?.weeklyReport ?? []).map((day: any) => normalizeDay(day))), [dashboardData]);
  const periodDays = React.useMemo<ReportDay[]>(() => ((periodBundle.data as any)?.daily ?? []).map((day: any) => normalizeDay(day, (periodBundle.data as any)?.goal)), [periodBundle.data]);
  const metricDays = periodScope === "week" ? weeklyDays : periodDays;
  const totals = metricDays.reduce<Totals>((acc, day) => ({ calories: acc.calories + day.calories, protein: acc.protein + day.protein, carbs: acc.carbs + day.carbs, fat: acc.fat + day.fat }), { ...EMPTY_TOTALS });
  const dayCount = metricDays.length || countDaysInRange(activeRange);
  const weightPoints = periodScope === "week" ? normalizeWeightPoints(dashboardData?.weight, dashboardData?.progress?.weight) : normalizeWeightPoints((periodBundle.data as any)?.weightTrend);
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
  const averageCalories = averageValue(totals.calories, Math.max(metricDays.length, 1));
  const activeLoading = periodScope === "week" ? dashboard.isLoading : periodBundle.isLoading;
  const activeError = periodScope === "week" ? dashboard.isError : periodBundle.isError;
  const adherence = macroMetrics[0]?.percent ?? 0;
  const hydrationReading = !metricDays.length ? "Ainda não há dados suficientes para interpretar a hidratação do período." : waterHitDays > 0 ? `${waterHitDays} de ${dayCount} dias bateram a meta de água, o que já permite enxergar consistência no intervalo.` : "Nenhum dia bateu a meta de água neste intervalo, então vale revisar distribuição e frequência dos registros.";
  const exerciseReading = !metricDays.length ? "Ainda não há dados suficientes para interpretar a atividade física do período." : exerciseActiveDays > 1 ? `Os exercícios ficaram distribuídos em ${exerciseActiveDays} dias, o que ajuda a evitar concentração excessiva em um único ponto do período.` : exerciseActiveDays === 1 ? "Toda a atividade física registrada ficou concentrada em um único dia do período." : "Nenhum exercício foi registrado neste intervalo.";

  if (!profile.isLoading && !hasActiveProfile) return <DashboardLayout><div className="mx-auto max-w-3xl"><Card className="border-0 shadow-sm"><CardHeader><CardTitle className="flex items-center gap-2"><ShieldAlert className="h-5 w-5 text-primary" /> Perfil profissional necessário</CardTitle><CardDescription>Ative a área Profissional em Configurações para acompanhar pessoas autorizadas.</CardDescription></CardHeader><CardContent><Button className="rounded-full" onClick={() => setLocation("/settings")}>Ir para Configurações</Button></CardContent></Card></div></DashboardLayout>;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <PageIntro eyebrow="Profissional" title="Acompanhamento profissional" description="Gerencie vínculos autorizados e analise cada pessoa acompanhada em uma área separada da sua conta." stats={<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><SummaryPill label="Pessoas autorizadas" value={String(approvedAccesses.length)} /><SummaryPill label="Convites pendentes" value={String(pendingAccesses.length)} /><SummaryPill label="Pessoa selecionada" value={selectedAccess ? personLabel(selectedAccess) : "Nenhuma"} /><SummaryPill label="Intervalo" value={formatRangeLabel(activeRange)} /></div>} />
        <div role="tablist" aria-label="Área profissional" className="grid gap-2 rounded-2xl border bg-background p-2 shadow-sm sm:grid-cols-2"><button type="button" role="tab" aria-selected={activeTab === "vinculos"} className={`rounded-xl px-4 py-3 text-sm font-medium transition-colors ${activeTab === "vinculos" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`} onClick={() => setActiveTab("vinculos")}>Vínculos de acompanhamento</button><button type="button" role="tab" aria-selected={activeTab === "analise"} className={`rounded-xl px-4 py-3 text-sm font-medium transition-colors ${activeTab === "analise" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`} onClick={() => setActiveTab("analise")}>Análise por pessoa acompanhada</button></div>
        {activeTab === "vinculos" ? <section role="tabpanel" className="space-y-6"><Card className="border-0 shadow-sm"><CardHeader><CardTitle className="flex items-center gap-2"><UserPlus className="h-5 w-5 text-primary" /> Vínculos de acompanhamento</CardTitle><CardDescription>Envie convites, acompanhe autorizações e veja quem já compartilhou dados com você.</CardDescription></CardHeader><CardContent className="space-y-5"><div className="grid gap-3 lg:grid-cols-[1fr_1.4fr_auto] lg:items-end"><label className="space-y-2"><Label>E-mail ou celular da pessoa</Label><Input value={patientContact} onChange={event => setPatientContact(event.target.value.trimStart())} placeholder="pessoa@exemplo.com ou (11) 99999-9999" /></label><label className="space-y-2"><Label>Motivo do acompanhamento</Label><Textarea value={reason} onChange={event => setReason(event.target.value)} className="min-h-11 lg:min-h-11" /></label><Button className="h-11 rounded-full" disabled={requestAccess.isPending || !patientContact.trim()} onClick={() => requestAccess.mutate({ patientContact: patientContact.trim(), reason })}><Mail className="mr-2 h-4 w-4" /> Enviar convite</Button></div>{accesses.isLoading ? <InlineStatusMessage text="Carregando vínculos de acompanhamento..." /> : null}{accesses.isError ? <InlineErrorMessage text="Não foi possível carregar seus vínculos. Tente novamente em instantes." /> : null}{!accesses.isLoading && !accesses.isError ? <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]"><div className="space-y-3"><SectionHeading title="Pessoas acompanhadas" description="Somente vínculos autorizados liberam análise, metas, registros recentes e comentários." />{approvedAccesses.length ? approvedAccesses.map(access => <AccessRow key={access.id} access={access} selected={access.patientUserId === selectedPatientId} revoking={revokeAccess.isPending} onSelect={() => { setSelectedPatientId(access.patientUserId); setActiveTab("analise"); }} onRevoke={() => revokeAccess.mutate({ accessId: access.id })} />) : <ReportEmptyState text="Nenhuma pessoa autorizou acompanhamento até agora." />}</div><div className="space-y-3"><SectionHeading title="Convites e autorizações" description="A pessoa acompanhada controla a autorização dos próprios dados." />{nonApprovedAccesses.length ? nonApprovedAccesses.map(access => <div key={access.id} className="rounded-2xl border bg-background p-4 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium">{personLabel(access)}</p><span className="rounded-full border bg-muted/30 px-3 py-1 text-xs text-muted-foreground">{accessStatusLabel(access.status)}</span></div><p className="mt-2 text-xs text-muted-foreground">{accessDateLabel(access)}</p></div>) : <ReportEmptyState text="Nenhum convite pendente ou encerrado." />}</div></div> : null}</CardContent></Card></section> : null}
        {activeTab === "analise" ? <section role="tabpanel" className="space-y-6"><Card className="border-0 shadow-sm"><CardHeader><CardTitle>Análise por pessoa acompanhada</CardTitle><CardDescription>Selecione a pessoa e o intervalo antes de navegar por relatórios, metas e comentários.</CardDescription></CardHeader><CardContent><div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-end"><label className="min-w-64 space-y-2 text-left"><Label>Pessoa acompanhada</Label><select className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50" value={selectedPatientId ?? ""} onChange={event => setSelectedPatientId(event.target.value ? Number(event.target.value) : null)} disabled={!approvedAccesses.length}><option value="">Selecione uma pessoa</option>{approvedAccesses.map(access => <option key={access.id} value={access.patientUserId}>{personLabel(access)}</option>)}</select></label><PeriodScopeSelector scope={periodScope} onScopeChange={setPeriodScope} selectedDay={selectedDay} onSelectedDayChange={setSelectedDay} selectedMonth={selectedMonth} onSelectedMonthChange={setSelectedMonth} rangeStart={rangeStart} onRangeStartChange={setRangeStart} rangeEnd={rangeEnd} onRangeEndChange={setRangeEnd} /></div></CardContent></Card>{!selectedPatientId && !accesses.isLoading ? <ReportEmptyState text="Escolha uma pessoa autorizada para revisar relatórios, metas e evolução no período selecionado." /> : null}{selectedAccess ? <div className="rounded-2xl border bg-muted/20 p-4 text-sm leading-6 text-muted-foreground"><p className="font-medium text-foreground">{personLabel(selectedAccess)}</p><p>{selectedAccess.patient?.email || `ID interno #${selectedAccess.patientUserId}`}</p><p>{accessDateLabel(selectedAccess)}</p></div> : null}{activeLoading ? <div className="grid gap-4 lg:grid-cols-4"><Skeleton className="h-32 rounded-2xl" /><Skeleton className="h-32 rounded-2xl" /><Skeleton className="h-32 rounded-2xl" /><Skeleton className="h-32 rounded-2xl" /></div> : null}{activeError ? <ReportEmptyState text="Não foi possível carregar os relatórios autorizados. Tente novamente em instantes." /> : null}{selectedPatientId && !activeLoading && !activeError ? <Tabs defaultValue="relatorios" className="space-y-4"><TabsList className="grid h-auto w-full grid-cols-1 gap-2 rounded-2xl bg-muted/60 p-2 md:grid-cols-5"><TabsTrigger className="min-h-11 rounded-xl" value="relatorios">Relatórios</TabsTrigger><TabsTrigger className="min-h-11 rounded-xl" value="metas">Metas</TabsTrigger><TabsTrigger className="min-h-11 rounded-xl" value="sugestoes">Sugestões</TabsTrigger><TabsTrigger className="min-h-11 rounded-xl" value="ia">IA</TabsTrigger><TabsTrigger className="min-h-11 rounded-xl" value="comentarios">Comentários</TabsTrigger></TabsList><TabsContent value="relatorios" className="space-y-6"><div className="grid gap-4 lg:grid-cols-4"><ReportHighlightCard title={periodScope === "week" ? "Média semanal" : "Média do período"} value={formatCalories(averageCalories)} description="Média diária no intervalo selecionado." /><ReportHighlightCard title="Consumo total" value={formatCalories(totals.calories)} description="Soma das calorias registradas no intervalo ativo." /><ReportHighlightCard title="Macros realizados" value={formatMacroGrams(totals.protein + totals.carbs + totals.fat)} description="Proteínas, carboidratos e gorduras realizados." /><ReportHighlightCard title="Calorias líquidas" value={formatCalories(totals.calories - exerciseCalories)} description={`Exercícios registrados: ${formatCalories(exerciseCalories)}.`} /></div><ReportMacroAdherenceSection title={periodScope === "week" ? "Aderência semanal às metas" : "Aderência do período às metas"} description="Calorias e macronutrientes usam a mesma leitura visual da tela Relatórios, com dados adaptados da pessoa selecionada." metrics={macroMetrics} /><ReportPlannedVsRealizedMacrosSection metrics={macroMetrics} /><div className="grid gap-6 xl:grid-cols-2"><ReportWaterAnalyticsCard title={periodScope === "week" ? "Hidratação na semana" : "Hidratação no período"} scopeLabel={periodScope === "week" ? "Semanal" : "Período"} description="Esta leitura olha aderência à meta, média diária e o ponto mais fraco do intervalo." totalConsumedMl={waterConsumedMl} totalGoalMl={waterGoalMl} goalHitDays={waterHitDays} totalDays={dayCount} averageDailyMl={averageWater} lowestDay={lowestWaterDay ? `${lowestWaterDay.label} · ${formatCountPtBr(lowestWaterDay.waterConsumedMl, " ml")}` : "-"} reading={hydrationReading} /><ReportExerciseAnalyticsCard title={periodScope === "week" ? "Atividade física na semana" : "Atividade física no período"} scopeLabel={periodScope === "week" ? "Semanal" : "Período"} description="Mostra frequência, distribuição e volume de gasto ao longo do intervalo selecionado." activeDays={exerciseActiveDays} totalDays={dayCount} totalCalories={exerciseCalories} detailLabel="Distribuição" detailValue={`${exerciseActiveDays}/${dayCount} dias`} averageCaloriesPerActiveDay={averageExercisePerActiveDay} highestDay={highestExerciseDay && highestExerciseDay.exerciseCalories > 0 ? `${highestExerciseDay.label} · ${formatCalories(highestExerciseDay.exerciseCalories)}` : "Sem exercício"} reading={exerciseReading} /></div><ReportTrendSection title={periodScope === "week" ? "Calorias consumidas em relação à meta" : "Tendência diária do período"} description="Comparativo diário dentro do intervalo selecionado." days={trendDays} /><ReportWeightAdherenceCard summary={buildWeightSummary(weightPoints)} adherencePercent={adherence} /></TabsContent><TabsContent value="metas" className="space-y-4">{hasNutritionGoal ? <><div className="grid gap-3 md:grid-cols-4"><Metric label="Meta base" value={formatCalories(defaultNutritionGoal.calories)} /><Metric label="Proteína" value={formatGrams(defaultNutritionGoal.proteinGrams)} /><Metric label="Carboidratos" value={formatGrams(defaultNutritionGoal.carbsGrams)} /><Metric label="Gorduras" value={formatGrams(defaultNutritionGoal.fatGrams)} /></div><Card className="border bg-muted/10 shadow-none"><CardHeader><CardTitle className="flex items-center gap-2"><Target className="h-5 w-5 text-primary" />Soma planejada da semana</CardTitle><CardDescription>Mesma lógica da tela Metas: regra base aplicada aos dias da semana, com exceções quando existirem.</CardDescription></CardHeader><CardContent className="space-y-4"><div className="grid gap-3 md:grid-cols-4"><ReportStatusTile label="Calorias semanais" value={formatCalories(weeklyGoalTotals.calories)} /><ReportStatusTile label="Proteínas" value={formatGrams(weeklyGoalTotals.proteinGrams)} /><ReportStatusTile label="Carboidratos" value={formatGrams(weeklyGoalTotals.carbsGrams)} /><ReportStatusTile label="Gorduras" value={formatGrams(weeklyGoalTotals.fatGrams)} /></div><div className="grid auto-cols-[minmax(10rem,1fr)] grid-flow-col gap-3 overflow-x-auto pb-2 xl:grid-flow-row xl:grid-cols-7 xl:overflow-visible xl:pb-0">{weeklyGoalDays.map(day => <div key={day.weekday} className="min-w-0 rounded-2xl border border-l-4 border-l-emerald-500 bg-background p-3"><div className="space-y-2"><div className="flex items-center justify-between gap-2"><p className="truncate font-medium tracking-tight">{day.label}</p><span className="rounded-full bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">{day.shortLabel ?? shortWeekdayLabel(day.weekday)}</span></div><p className="min-h-10 text-sm leading-5 text-foreground">{day.source === "exception" ? "Exceção aplicada neste dia." : "Usando a meta geral."}</p></div><div className="mt-3 space-y-1 text-sm text-foreground"><p>{formatCalories(day.calories)}</p><p>{formatGrams(day.proteinGrams)} proteína</p><p>{formatGrams(day.carbsGrams)} carbo</p><p>{formatGrams(day.fatGrams)} gordura</p></div></div>)}</div></CardContent></Card><ListSection title="Exceções ativas">{activeExceptions.length ? activeExceptions.map(exception => <div key={`${exception.id ?? exception.weekday}-${exception.durationType}`} className="rounded-xl border bg-muted/20 p-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{exception.label ?? weekdayLabel(exception.weekday)}</span><span className="text-xs text-muted-foreground">{durationTypeLabel(exception.durationType)}</span></div><div className="mt-2 grid gap-2 text-muted-foreground md:grid-cols-4"><span>{formatCalories(exception.calories)}</span><span>{formatGrams(exception.proteinGrams)} proteína</span><span>{formatGrams(exception.carbsGrams)} carboidratos</span><span>{formatGrams(exception.fatGrams)} gorduras</span></div></div>) : <ReportEmptyState text="Nenhuma exceção ativa. A meta base é aplicada a todos os dias da semana." />}</ListSection><div className="rounded-2xl border bg-muted/20 p-4 text-sm leading-6 text-muted-foreground">A sugestão fica registrada para avaliação posterior. A meta ativa da pessoa acompanhada não muda automaticamente.</div></> : <ReportEmptyState text="Nenhuma meta nutricional encontrada para esta pessoa." />}<SuggestionBox title="Sugerir ajuste de meta" description="Os campos começam com a meta atual para facilitar pequenos ajustes. As exceções ativas são preservadas na sugestão."><div className="grid gap-3 md:grid-cols-4"><NumberField label="Calorias" min={800} value={goalSuggestion.calories} onChange={value => setGoalSuggestion(previous => ({ ...previous, calories: value }))} /><NumberField label="Proteína (g)" min={20} value={goalSuggestion.proteinGrams} onChange={value => setGoalSuggestion(previous => ({ ...previous, proteinGrams: value }))} /><NumberField label="Carboidratos (g)" min={20} value={goalSuggestion.carbsGrams} onChange={value => setGoalSuggestion(previous => ({ ...previous, carbsGrams: value }))} /><NumberField label="Gorduras (g)" min={10} value={goalSuggestion.fatGrams} onChange={value => setGoalSuggestion(previous => ({ ...previous, fatGrams: value }))} /></div><label className="mt-3 block space-y-2"><Label>Justificativa</Label><Textarea value={goalSuggestion.rationale} onChange={event => setGoalSuggestion(previous => ({ ...previous, rationale: event.target.value }))} placeholder="Ex.: reduzir calorias mantendo proteína alta para preservar saciedade." /></label><Button className="mt-4 rounded-full" disabled={!canSuggestGoal || suggestGoal.isPending} onClick={() => selectedPatientId && nutritionGoal && suggestGoal.mutate({ patientId: selectedPatientId, rationale: goalSuggestion.rationale.trim(), status: "sent", goal: { defaultGoal: { calories: suggestedCalories, proteinGrams: suggestedProtein, carbsGrams: suggestedCarbs, fatGrams: suggestedFat }, exceptions: nutritionGoal.exceptions ?? [] } })}><MessageSquarePlus className="mr-2 h-4 w-4" /> Enviar sugestão</Button></SuggestionBox><ListSection title="Sugestões registradas">{goalSuggestions.length ? goalSuggestions.map(suggestion => <GoalSuggestionRow key={suggestion.id} suggestion={suggestion} />) : <ReportEmptyState text="Nenhuma sugestão de meta registrada para esta pessoa." />}</ListSection></TabsContent><TabsContent value="sugestoes" className="space-y-4"><div className="rounded-2xl border bg-muted/20 p-4 text-sm leading-6 text-muted-foreground">Sugestões de refeição ficam registradas para acompanhamento e não criam refeições automaticamente no diário da pessoa acompanhada.</div><SuggestionBox title="Sugerir refeição ou plano alimentar" description="Descreva a proposta em linguagem prática para a pessoa revisar depois."><div className="grid gap-3 md:grid-cols-[0.7fr_1.3fr]"><TextField label="Refeição" value={mealSuggestion.mealLabel} onChange={value => setMealSuggestion(previous => ({ ...previous, mealLabel: value }))} placeholder="Almoço" /><TextField label="Título" value={mealSuggestion.title} onChange={value => setMealSuggestion(previous => ({ ...previous, title: value }))} placeholder="Almoço rico em proteína" /></div><TextAreaField label="Descrição da sugestão" value={mealSuggestion.description} onChange={value => setMealSuggestion(previous => ({ ...previous, description: value }))} placeholder="Ex.: arroz, feijão, frango grelhado, salada e uma fruta." /><TextAreaField label="Justificativa" value={mealSuggestion.rationale} onChange={value => setMealSuggestion(previous => ({ ...previous, rationale: value }))} placeholder="Ex.: melhorar saciedade no almoço mantendo a meta de proteína." /><TextAreaField label="Observações opcionais" value={mealSuggestion.notes} onChange={value => setMealSuggestion(previous => ({ ...previous, notes: value }))} placeholder="Ex.: trocar frango por ovos nos dias sem preparo." /><Button className="mt-4 rounded-full" disabled={!canSuggestMeal || suggestMeal.isPending} onClick={() => selectedPatientId && suggestMeal.mutate({ patientId: selectedPatientId, mealLabel: mealSuggestion.mealLabel.trim(), title: mealSuggestion.title.trim(), description: mealSuggestion.description.trim(), rationale: mealSuggestion.rationale.trim(), notes: mealSuggestion.notes.trim() || undefined, status: "sent" })}><MessageSquarePlus className="mr-2 h-4 w-4" /> Enviar sugestão</Button></SuggestionBox><ListSection title="Sugestões de refeição registradas">{mealSuggestions.length ? mealSuggestions.map(suggestion => <MealSuggestionRow key={suggestion.id} suggestion={suggestion} />) : <ReportEmptyState text="Nenhuma sugestão de refeição registrada para esta pessoa." />}</ListSection></TabsContent><TabsContent value="ia" className="space-y-4"><div className="rounded-2xl border bg-muted/20 p-4 text-sm leading-6 text-muted-foreground">Perguntas com IA usam apenas o contexto autorizado desta pessoa e retornam apoio educativo para análise profissional.</div><SuggestionBox title="Perguntar sobre a pessoa acompanhada" description="Use perguntas objetivas sobre aderência, registros, metas ou tendências disponíveis."><TextAreaField label="Pergunta" value={patientQuestion} onChange={setPatientQuestion} placeholder="Ex.: O que chama atenção na aderência desta semana?" /><Button className="mt-4 rounded-full" disabled={!canAskQuestion || askPatientQuestion.isPending} onClick={() => selectedPatientId && askPatientQuestion.mutate({ patientId: selectedPatientId, question: patientQuestion.trim() })}><MessageSquarePlus className="mr-2 h-4 w-4" /> Perguntar</Button></SuggestionBox>{patientAnswer ? <PatientAiAnswerCard answer={patientAnswer} /> : <ReportEmptyState text="Faça uma pergunta para gerar uma resposta com base no contexto autorizado." />}</TabsContent><TabsContent value="comentarios" className="space-y-4"><Card className="border-0 shadow-sm"><CardHeader><CardTitle>Comentários profissionais</CardTitle><CardDescription>Anotações registradas para acompanhamento da pessoa selecionada.</CardDescription></CardHeader><CardContent className="space-y-4"><Textarea value={comment} onChange={event => setComment(event.target.value)} placeholder="Adicionar comentário de acompanhamento" /><Button className="rounded-full" disabled={!selectedPatientId || !comment.trim() || addComment.isPending} onClick={() => selectedPatientId && addComment.mutate({ patientId: selectedPatientId, comment: comment.trim() })}><MessageSquarePlus className="mr-2 h-4 w-4" /> Comentar</Button><div className="space-y-3">{dashboardComments.length ? dashboardComments.map((item, index) => <CommentRow key={item.id ?? index} comment={item} />) : <ReportEmptyState text="Nenhum comentário profissional registrado para esta pessoa." />}</div></CardContent></Card></TabsContent></Tabs> : null}</section> : null}
      </div>
    </DashboardLayout>
  );
}

function SectionHeading({ title, description }: { title: string; description: string }) { return <div><h2 className="text-base font-semibold tracking-tight">{title}</h2><p className="text-sm leading-6 text-muted-foreground">{description}</p></div>; }
function InlineStatusMessage({ text }: { text: string }) { return <div className="rounded-2xl border bg-muted/20 p-6 text-sm text-muted-foreground">{text}</div>; }
function InlineErrorMessage({ text }: { text: string }) { return <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-6 text-sm text-destructive">{text}</div>; }
function AccessRow({ access, selected, onSelect, onRevoke, revoking }: { access: PatientAccess; selected: boolean; onSelect: () => void; onRevoke: () => void; revoking: boolean }) { return <div className={`rounded-2xl border bg-background p-4 ${selected ? "ring-2 ring-primary/30" : ""}`}><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-medium">{personLabel(access)}</p><p className="text-xs text-muted-foreground">{access.patient?.email || `ID interno #${access.patientUserId}`}</p><p className="text-xs text-muted-foreground">{accessDateLabel(access)}</p></div><div className="flex flex-wrap gap-2"><Button variant={selected ? "default" : "outline"} className="rounded-full" onClick={onSelect}>Analisar</Button><Button variant="outline" className="rounded-full" onClick={onRevoke} disabled={revoking}><X className="mr-2 h-4 w-4" /> Revogar vínculo</Button></div></div></div>; }
function SuggestionBox({ title, description, children }: { title: string; description: string; children: React.ReactNode }) { return <div className="rounded-2xl border bg-background p-4"><div className="mb-4"><p className="font-medium">{title}</p><p className="text-sm text-muted-foreground">{description}</p></div>{children}</div>; }
function ListSection({ title, children }: { title: string; children: React.ReactNode }) { return <div className="space-y-2"><p className="font-medium">{title}</p>{children}</div>; }
function TextField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) { return <label className="space-y-2"><Label>{label}</Label><Input value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} /></label>; }
function NumberField({ label, value, min, onChange }: { label: string; value: string; min: number; onChange: (value: string) => void }) { return <label className="space-y-2"><Label>{label}</Label><Input type="number" min={min} value={value} onChange={event => onChange(event.target.value)} /></label>; }
function TextAreaField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) { return <label className="mt-3 block space-y-2"><Label>{label}</Label><Textarea value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} /></label>; }
function PatientAiAnswerCard({ answer }: { answer: PatientAiAnswer }) { return <div className="rounded-2xl border bg-background p-4 text-sm leading-6"><p className="font-medium">Resposta</p><p className="mt-2 text-muted-foreground">{answer.answer}</p>{answer.citedContext.length ? <div className="mt-3"><p className="text-xs font-medium uppercase text-muted-foreground">Contexto usado</p><div className="mt-2 grid gap-2 md:grid-cols-3">{answer.citedContext.map(item => <span key={item} className="rounded-xl border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">{item}</span>)}</div></div> : null}{answer.caution ? <p className="mt-3 text-xs text-muted-foreground">{answer.caution}</p> : null}<p className="mt-3 text-xs text-muted-foreground">{answer.educationalNotice}</p></div>; }
function GoalSuggestionRow({ suggestion }: { suggestion: GoalSuggestion }) { const goal = normalizeGoalTarget(suggestion.goal?.defaultGoal); return <div className="rounded-xl border bg-muted/20 p-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{suggestionStatusLabel(suggestion.status)}</span><span className="text-xs text-muted-foreground">{dateTimeLabel(suggestion.createdAt)}</span></div><div className="mt-2 grid gap-2 text-muted-foreground md:grid-cols-4"><span>{formatCalories(goal.calories)}</span><span>{formatGrams(goal.proteinGrams)} proteína</span><span>{formatGrams(goal.carbsGrams)} carboidratos</span><span>{formatGrams(goal.fatGrams)} gorduras</span></div><p className="mt-2 text-muted-foreground">{suggestion.rationale || "Sugestão sem justificativa registrada."}</p></div>; }
function MealSuggestionRow({ suggestion }: { suggestion: MealSuggestion }) { return <div className="rounded-xl border bg-muted/20 p-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{suggestion.mealLabel || "Refeição"} · {suggestion.title || "Sugestão"}</span><span className="text-xs text-muted-foreground">{suggestionStatusLabel(suggestion.status)} · {dateTimeLabel(suggestion.createdAt)}</span></div><p className="mt-2 text-muted-foreground">{suggestion.description || "Sem descrição."}</p><p className="mt-2 text-muted-foreground">Justificativa: {suggestion.rationale || "não informada"}</p>{suggestion.notes ? <p className="mt-2 text-xs text-muted-foreground">Obs.: {suggestion.notes}</p> : null}</div>; }
function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded-xl border bg-background p-4"><p className="text-sm text-muted-foreground">{label}</p><p className="mt-2 text-xl font-semibold tracking-tight">{value}</p></div>; }
function CommentRow({ comment }: { comment: ProfessionalComment }) { return <div className="rounded-xl border bg-muted/20 p-3 text-sm"><p>{comment.comment || "Comentário sem texto."}</p>{comment.createdAt ? <p className="mt-2 text-xs text-muted-foreground">{new Date(comment.createdAt).toLocaleString("pt-BR")}</p> : null}</div>; }