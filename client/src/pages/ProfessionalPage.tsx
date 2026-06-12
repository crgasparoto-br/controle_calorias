import DashboardLayout from "@/components/DashboardLayout";
import PageIntro from "@/components/PageIntro";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCalories, formatCountPtBr, formatGrams, formatNumberPtBr } from "@/lib/numberFormat";
import { trpc } from "@/lib/trpc";
import {
  Activity,
  BarChart3,
  ChevronDown,
  ClipboardList,
  Droplets,
  Dumbbell,
  Leaf,
  Mail,
  MessageSquarePlus,
  Scale,
  ShieldAlert,
  Target,
  TrendingUp,
  UserPlus,
  UtensilsCrossed,
  X,
} from "lucide-react";
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
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { useLocation } from "wouter";

type PatientAiAnswer = {
  answer: string;
  citedContext: string[];
  caution?: string;
  educationalNotice: string;
  generatedAt: number;
};

type AccessStatus = "pending" | "approved" | "rejected" | "revoked" | string;

type MealSummary = {
  id: number;
  mealLabel: string;
  occurredAt: string | number | Date;
  totals: {
    calories: number;
    protein?: number;
    carbs?: number;
    fat?: number;
  };
};

type GoalTarget = {
  calories: number;
  proteinGrams: number;
  carbsGrams: number;
  fatGrams: number;
};

type DurationType = "always" | "1_week" | "2_weeks" | "3_weeks";

type GoalDayView = GoalTarget & {
  weekday: number;
  label: string;
  shortLabel?: string;
  source?: string;
  durationType?: DurationType;
};

type GoalExceptionView = GoalTarget & {
  id?: number;
  weekday: number;
  label?: string;
  shortLabel?: string;
  durationType: DurationType;
  isActive?: boolean;
};

type NutritionGoalView = {
  defaultGoal: GoalTarget;
  exceptions: GoalExceptionView[];
  days: GoalDayView[];
  today?: GoalDayView;
  weeklyTotals?: GoalTarget;
};

type WeeklyReportDay = {
  date: string;
  label: string;
  calories: number;
  goalCalories: number;
  adjustedGoalCalories?: number | null;
  protein: number;
  carbs: number;
  fat: number;
  goalProtein?: number | null;
  goalCarbs?: number | null;
  goalFat?: number | null;
  waterConsumedMl?: number | null;
  waterGoalMl?: number | null;
  exerciseCalories?: number | null;
  calorieDelta?: number | null;
  adherencePercent?: number | null;
  quality?: {
    proteinGrams?: number;
    fiberGrams?: number;
    waterMl?: number;
    fruitServings?: number;
    vegetableServings?: number;
    ultraProcessedServings?: number;
    mealCount?: number;
    regularityScore?: number;
  };
};

type TrendPoint = CalorieGoalDay & {
  date: string;
  label: string;
  baseGoalCalories: number;
  exerciseCalories: number;
  calorieDelta: number;
  adherencePercent: number;
};

type WeightEntryPoint = WeightTrendPoint & { notes?: string | null };

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

function toTrendPoint(day: {
  date: string;
  label: string;
  calories: number;
  goalCalories: number;
  adjustedGoalCalories?: number | null;
  exerciseCalories?: number | null;
  calorieDelta?: number | null;
  adherencePercent?: number | null;
}): TrendPoint {
  const adjustedGoalCalories = day.adjustedGoalCalories ?? day.goalCalories;
  return {
    date: day.date,
    label: day.label,
    calories: Math.round(day.calories),
    goalCalories: adjustedGoalCalories,
    baseGoalCalories: day.goalCalories,
    exerciseCalories: Math.round(day.exerciseCalories ?? 0),
    calorieDelta: day.calorieDelta ?? Math.round(day.calories - adjustedGoalCalories),
    adherencePercent: day.adherencePercent ?? (adjustedGoalCalories > 0 ? (day.calories / adjustedGoalCalories) * 100 : 0),
  };
}

function formatWeightDateLabel(date: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "UTC",
    day: "2-digit",
    month: "short",
  }).format(new Date(`${date}T12:00:00Z`));
}

function buildWeightPointsFromEntries(entries?: WeightEntryPoint[], allowedDates?: Set<string>): WeightTrendPoint[] {
  return (entries ?? [])
    .filter(entry => (!allowedDates || allowedDates.has(entry.date)) && Number.isFinite(entry.weightKg))
    .map(entry => ({ date: entry.date, label: entry.label ?? formatWeightDateLabel(entry.date), weightKg: entry.weightKg }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function buildWeightPointsFromSummary(
  weight?: { hasData?: boolean; entries?: WeightEntryPoint[]; firstWeightKg?: number | null; lastWeightKg?: number | null },
  allowedDates?: Set<string>,
): WeightTrendPoint[] {
  const entryPoints = buildWeightPointsFromEntries(weight?.entries, allowedDates);
  if (entryPoints.length) return entryPoints;
  if (!weight?.hasData || weight.firstWeightKg == null) return [];
  if (weight.lastWeightKg == null || weight.lastWeightKg === weight.firstWeightKg) {
    return [{ date: "initial", label: "Registro", weightKg: weight.firstWeightKg }];
  }
  return [
    { date: "initial", label: "Inicial", weightKg: weight.firstWeightKg },
    { date: "last", label: "Último", weightKg: weight.lastWeightKg },
  ];
}

function averageTrendValue(days: TrendPoint[], getValue: (day: TrendPoint) => number) {
  if (!days.length) return null;
  return days.reduce((total, day) => total + getValue(day), 0) / days.length;
}

function getReportCalorieBarColor(calories: number, goalCalories: number) {
  if (!goalCalories || !calories) return "#cbd5e1";
  const ratio = calories / goalCalories;
  if (ratio > 1.05) return "#dc2626";
  if (ratio < 0.9) return "#f59e0b";
  return "#16a34a";
}

const ACCESS_STATUS_LABELS: Record<string, string> = {
  pending: "Aguardando autorização",
  approved: "Autorizado",
  rejected: "Recusado",
  revoked: "Revogado",
};

const GOAL_WEEKDAYS = [
  { weekday: 0, label: "Segunda-feira", shortLabel: "seg." },
  { weekday: 1, label: "Terça-feira", shortLabel: "ter." },
  { weekday: 2, label: "Quarta-feira", shortLabel: "qua." },
  { weekday: 3, label: "Quinta-feira", shortLabel: "qui." },
  { weekday: 4, label: "Sexta-feira", shortLabel: "sex." },
  { weekday: 5, label: "Sábado", shortLabel: "sáb." },
  { weekday: 6, label: "Domingo", shortLabel: "dom." },
] as const;

function accessStatusLabel(status: AccessStatus) {
  return ACCESS_STATUS_LABELS[status] ?? status;
}

function accessDateLabel(access: { requestedAt: number; approvedAt: number | null; revokedAt: number | null; status: string }) {
  if (access.status === "approved" && access.approvedAt) return `Autorizado em ${new Date(access.approvedAt).toLocaleString("pt-BR")}`;
  if (access.status === "revoked" && access.revokedAt) return `Revogado em ${new Date(access.revokedAt).toLocaleString("pt-BR")}`;
  return `Solicitado em ${new Date(access.requestedAt).toLocaleString("pt-BR")}`;
}

function personLabel(access: { patient?: { name: string | null; email: string | null } | null; patientUserId: number }) {
  return access.patient?.name || access.patient?.email || `Pessoa #${access.patientUserId}`;
}

export default function ProfessionalPage() {
  const utils = trpc.useUtils();
  const [, setLocation] = useLocation();
  const profile = trpc.nutrition.professionals.profile.useQuery(undefined, { retry: false });
  const hasActiveProfile = Boolean(profile.data?.active);
  const accesses = trpc.nutrition.professionals.myAccesses.useQuery(undefined, { enabled: hasActiveProfile });
  const [patientContact, setPatientContact] = useState("");
  const [reason, setReason] = useState("Acompanhamento profissional com consentimento da pessoa acompanhada.");
  const [selectedPatientId, setSelectedPatientId] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [patientQuestion, setPatientQuestion] = useState("");
  const [patientAnswer, setPatientAnswer] = useState<PatientAiAnswer | null>(null);
  const [goalSuggestion, setGoalSuggestion] = useState({
    calories: "",
    proteinGrams: "",
    carbsGrams: "",
    fatGrams: "",
    rationale: "",
  });
  const [mealSuggestion, setMealSuggestion] = useState({
    mealLabel: "Almoço",
    title: "",
    description: "",
    rationale: "",
    notes: "",
  });
  const dashboard = trpc.nutrition.professionals.patientDashboard.useQuery(
    { patientId: selectedPatientId ?? 0 },
    { enabled: hasActiveProfile && Boolean(selectedPatientId) },
  );

  const approvedAccesses = accesses.data?.filter(access => access.status === "approved") ?? [];
  const pendingAccesses = accesses.data?.filter(access => access.status === "pending") ?? [];
  const nonApprovedAccesses = accesses.data?.filter(access => access.status !== "approved") ?? [];
  const nutritionGoal = dashboard.data?.nutritionGoal as NutritionGoalView | undefined;
  const defaultNutritionGoal = nutritionGoal?.defaultGoal;
  const goalSuggestions = dashboard.data?.goalSuggestions ?? [];
  const mealSuggestions = dashboard.data?.mealSuggestions ?? [];
  const suggestedCalories = Number(goalSuggestion.calories);
  const suggestedProtein = Number(goalSuggestion.proteinGrams);
  const suggestedCarbs = Number(goalSuggestion.carbsGrams);
  const suggestedFat = Number(goalSuggestion.fatGrams);
  const selectedAccess = approvedAccesses.find(access => access.patientUserId === selectedPatientId) ?? null;
  const weeklyReport = useMemo(() => (dashboard.data?.weeklyReport ?? []) as WeeklyReportDay[], [dashboard.data?.weeklyReport]);
  const trendData = useMemo(() => weeklyReport.map(day => toTrendPoint(day)), [weeklyReport]);
  const calorieAdherence = useMemo(() => calculateCalorieAdherence(trendData, 7), [trendData]);
  const consumedMacros = useMemo<MacroTotals>(() => ({
    protein: weeklyReport.reduce((t, d) => t + d.protein, 0),
    carbs: weeklyReport.reduce((t, d) => t + d.carbs, 0),
    fat: weeklyReport.reduce((t, d) => t + d.fat, 0),
  }), [weeklyReport]);
  const plannedMacros = useMemo<MacroTotals>(() => ({
    protein: weeklyReport.reduce((t, d) => t + (d.goalProtein ?? 0), 0),
    carbs: weeklyReport.reduce((t, d) => t + (d.goalCarbs ?? 0), 0),
    fat: weeklyReport.reduce((t, d) => t + (d.goalFat ?? 0), 0),
  }), [weeklyReport]);
  const dailyMacros = useMemo<MacroGoalDay[]>(() => weeklyReport.map(d => ({
    protein: d.protein, carbs: d.carbs, fat: d.fat,
    goalProtein: d.goalProtein ?? 0, goalCarbs: d.goalCarbs ?? 0, goalFat: d.goalFat ?? 0,
  })), [weeklyReport]);
  const weeklyQualityRaw = dashboard.data?.quality;
  const weeklyProgress = dashboard.data?.progress;
  const foodQuality = weeklyQualityRaw?.foodQuality as FoodQualitySummary | undefined;
  const waterConsumedMl = weeklyReport.reduce((t, d) => t + (d.waterConsumedMl ?? 0), 0);
  const waterGoalMl = weeklyReport.reduce((t, d) => t + (d.waterGoalMl ?? 0), 0);
  const waterHitDays = weeklyReport.filter(d => (d.waterGoalMl ?? 0) > 0 && (d.waterConsumedMl ?? 0) >= (d.waterGoalMl ?? 0)).length;
  const exerciseActiveDays = weeklyReport.filter(d => (d.exerciseCalories ?? 0) > 0).length;
  const exerciseCalories = weeklyReport.reduce((t, d) => t + (d.exerciseCalories ?? 0), 0);
  const selectedWeightDates = useMemo(() => new Set(trendData.map(d => d.date)), [trendData]);
  const weightTrendPoints = useMemo(() => buildWeightPointsFromSummary(weeklyProgress?.weight, selectedWeightDates), [weeklyProgress?.weight, selectedWeightDates]);
  const weightSummary = useMemo(() => calculateWeightTrendSummary(weightTrendPoints), [weightTrendPoints]);
  const waterAdherencePercent = progressPercent(waterConsumedMl, waterGoalMl);
  const weightSummaryValue = weightSummary.hasData && weightSummary.deltaKg != null ? `${formatSignedMacro(weightSummary.deltaKg)} kg` : "-";
  const qualitySummaryValue = foodQuality?.qualityIndex == null ? "-" : formatPercent(foodQuality.qualityIndex);
  const qualitySummaryDescription = foodQuality?.hasData
    ? `${foodQuality.daysWithRecords}/${7} dias com registros e ${formatPercent(foodQuality.unclassifiedCaloriesPercent)} não classificados.`
    : "Sem dados classificados suficientes no período selecionado.";
  const reportSummaryMetrics = [
    { title: "Aderência calórica", value: formatPercent(calorieAdherence.adherencePercent), description: `${calorieAdherence.daysWithinRange}/${7} dias dentro da faixa ideal.` },
    { title: "Média consumida", value: formatCalories(calorieAdherence.averageCalories), description: "Consumo diário médio no período selecionado." },
    { title: "Média da meta ajustada", value: formatCalories(calorieAdherence.averageGoalCalories), description: "Meta média após considerar exercícios registrados." },
    { title: "Desvio médio", value: formatCalories(calorieAdherence.averageDeltaCalories), description: "Diferença diária média entre consumo e meta ajustada." },
    { title: "Variação de peso", value: weightSummaryValue, description: weightSummary.hasData ? `${formatSignedMacro(weightSummary.deltaPercent)}% no período.` : "Sem registros suficientes no período." },
    { title: "Qualidade alimentar", value: qualitySummaryValue, description: qualitySummaryDescription },
    { title: "Água", value: formatPercent(waterAdherencePercent), description: `${waterHitDays}/${7} dias com meta batida; ${formatCountPtBr(Math.round(waterConsumedMl), " ml")} no total.` },
    { title: "Exercícios", value: `${exerciseActiveDays}/${7} dias`, description: `${formatCalories(exerciseCalories)} estimadas e consideradas na meta ajustada.` },
  ];
  const weeklyGoalDays = nutritionGoal?.days?.length ? nutritionGoal.days : GOAL_WEEKDAYS.map(day => ({
    ...day,
    source: "default",
    calories: defaultNutritionGoal?.calories ?? 0,
    proteinGrams: defaultNutritionGoal?.proteinGrams ?? 0,
    carbsGrams: defaultNutritionGoal?.carbsGrams ?? 0,
    fatGrams: defaultNutritionGoal?.fatGrams ?? 0,
  }));
  const weeklyGoalTotals = nutritionGoal?.weeklyTotals ?? weeklyGoalDays.reduce(
    (total, day) => ({
      calories: total.calories + day.calories,
      proteinGrams: total.proteinGrams + day.proteinGrams,
      carbsGrams: total.carbsGrams + day.carbsGrams,
      fatGrams: total.fatGrams + day.fatGrams,
    }),
    { calories: 0, proteinGrams: 0, carbsGrams: 0, fatGrams: 0 },
  );
  const activeExceptions = nutritionGoal?.exceptions?.filter(exception => exception.isActive !== false) ?? [];
  const canSuggestGoal = Boolean(
    selectedPatientId &&
    goalSuggestion.rationale.trim() &&
    suggestedCalories > 0 &&
    suggestedProtein > 0 &&
    suggestedCarbs > 0 &&
    suggestedFat > 0,
  );
  const canSuggestMeal = Boolean(
    selectedPatientId &&
    mealSuggestion.mealLabel.trim() &&
    mealSuggestion.title.trim() &&
    mealSuggestion.description.trim() &&
    mealSuggestion.rationale.trim(),
  );
  const canAskQuestion = Boolean(selectedPatientId && patientQuestion.trim().length >= 3);

  useEffect(() => {
    if (!selectedPatientId && approvedAccesses.length) {
      setSelectedPatientId(approvedAccesses[0].patientUserId);
    }
    if (selectedPatientId && approvedAccesses.length && !approvedAccesses.some(access => access.patientUserId === selectedPatientId)) {
      setSelectedPatientId(approvedAccesses[0].patientUserId);
    }
  }, [approvedAccesses, selectedPatientId]);

  useEffect(() => {
    setPatientAnswer(null);
  }, [selectedPatientId]);

  useEffect(() => {
    if (!defaultNutritionGoal) {
      setGoalSuggestion(previous => ({ ...previous, calories: "", proteinGrams: "", carbsGrams: "", fatGrams: "" }));
      return;
    }

    setGoalSuggestion(previous => ({
      ...previous,
      calories: String(defaultNutritionGoal.calories),
      proteinGrams: String(defaultNutritionGoal.proteinGrams),
      carbsGrams: String(defaultNutritionGoal.carbsGrams),
      fatGrams: String(defaultNutritionGoal.fatGrams),
    }));
  }, [
    defaultNutritionGoal?.calories,
    defaultNutritionGoal?.proteinGrams,
    defaultNutritionGoal?.carbsGrams,
    defaultNutritionGoal?.fatGrams,
    selectedPatientId,
  ]);

  const invalidate = async () => {
    await Promise.all([
      utils.auth.me.invalidate(),
      utils.nutrition.professionals.profile.invalidate(),
      utils.nutrition.professionals.myAccesses.invalidate(),
      utils.nutrition.professionals.patientRequests.invalidate(),
    ]);
    if (selectedPatientId) await utils.nutrition.professionals.patientDashboard.invalidate({ patientId: selectedPatientId });
  };

  const requestAccess = trpc.nutrition.professionals.requestAccess.useMutation({
    onSuccess: async () => {
      toast.success("Solicitação enviada. A pessoa acompanhada precisa autorizar antes do acesso.");
      setPatientContact("");
      await invalidate();
    },
    onError: error => toast.error(error.message || "Não foi possível solicitar acesso."),
  });

  const revokeAccess = trpc.nutrition.professionals.revokeAccess.useMutation({
    onSuccess: async () => {
      toast.success("Vínculo revogado.");
      setSelectedPatientId(null);
      await invalidate();
    },
    onError: error => toast.error(error.message || "Não foi possível revogar."),
  });

  const addComment = trpc.nutrition.professionals.addComment.useMutation({
    onSuccess: async () => {
      toast.success("Comentário adicionado.");
      setComment("");
      await invalidate();
    },
    onError: error => toast.error(error.message || "Não foi possível comentar."),
  });

  const suggestGoal = trpc.nutrition.professionals.suggestGoalAdjustment.useMutation({
    onSuccess: async () => {
      toast.success("Sugestão de meta registrada para acompanhamento.");
      setGoalSuggestion(previous => ({ ...previous, rationale: "" }));
      await invalidate();
    },
    onError: error => toast.error(error.message || "Não foi possível sugerir a meta."),
  });

  const suggestMeal = trpc.nutrition.professionals.suggestMealPlan.useMutation({
    onSuccess: async () => {
      toast.success("Sugestão de refeição registrada para acompanhamento.");
      setMealSuggestion(previous => ({ ...previous, title: "", description: "", rationale: "", notes: "" }));
      await invalidate();
    },
    onError: error => toast.error(error.message || "Não foi possível sugerir a refeição."),
  });

  const askPatientQuestion = trpc.nutrition.professionals.askPatientQuestion.useMutation({
    onSuccess: answer => {
      setPatientAnswer(answer);
      toast.success("Resposta gerada com contexto autorizado.");
    },
    onError: error => toast.error(error.message || "Não foi possível responder a pergunta."),
  });

  if (!profile.isLoading && !hasActiveProfile) {
    return (
      <DashboardLayout>
        <div className="mx-auto max-w-3xl">
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldAlert className="h-5 w-5 text-primary" />
                Perfil profissional necessário
              </CardTitle>
              <CardDescription>
                Ative a área Profissional em Configurações para solicitar vínculos, acompanhar pessoas autorizadas e consultar análises compartilhadas.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button className="rounded-full" onClick={() => setLocation("/settings")}>Ir para Configurações</Button>
            </CardContent>
          </Card>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <PageIntro
          eyebrow="Profissional"
          title="Acompanhamento profissional"
          description="Gerencie vínculos autorizados e analise cada pessoa acompanhada em uma área separada da sua conta pessoal."
          stats={
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <IntroStat label="Perfil" value={hasActiveProfile ? "Ativo" : "Carregando"} helper={profile.data?.displayName ?? "perfil profissional"} />
              <IntroStat label="Pessoas acompanhadas" value={String(approvedAccesses.length)} helper="com vínculo autorizado" />
              <IntroStat label="Aguardando autorização" value={String(pendingAccesses.length)} helper="solicitações enviadas" />
            </div>
          }
        />

        <Tabs defaultValue="vinculos" className="space-y-4">
          <TabsList className="grid h-auto w-full grid-cols-1 gap-2 rounded-2xl bg-muted/60 p-2 md:grid-cols-2">
            <TabsTrigger className="min-h-11 rounded-xl" value="vinculos">Vínculos de acompanhamento</TabsTrigger>
            <TabsTrigger className="min-h-11 rounded-xl" value="analise">Análise por pessoa acompanhada</TabsTrigger>
          </TabsList>

          <TabsContent value="vinculos" className="space-y-4">
            <Card className="border-0 shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><UserPlus className="h-5 w-5 text-primary" /> Vínculos de acompanhamento</CardTitle>
                <CardDescription>Envie convites, acompanhe autorizações e veja quem já compartilhou dados com você.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid gap-3 lg:grid-cols-[1fr_1.4fr_auto] lg:items-end">
                  <label className="space-y-2">
                    <Label>E-mail ou celular da pessoa</Label>
                    <Input
                      value={patientContact}
                      onChange={event => setPatientContact(event.target.value.trimStart())}
                      placeholder="pessoa@exemplo.com ou (11) 99999-9999"
                    />
                  </label>
                  <label className="space-y-2">
                    <Label>Motivo do acompanhamento</Label>
                    <Textarea value={reason} onChange={event => setReason(event.target.value)} className="min-h-11 lg:min-h-11" />
                  </label>
                  <Button
                    className="h-11 rounded-full"
                    disabled={requestAccess.isPending || !patientContact.trim()}
                    onClick={() => requestAccess.mutate({ patientContact: patientContact.trim(), reason })}
                  >
                    <Mail className="mr-2 h-4 w-4" />
                    Enviar convite
                  </Button>
                </div>

                {accesses.isLoading ? <StatusMessage text="Carregando vínculos de acompanhamento..." /> : null}
                {accesses.isError ? <ErrorMessage text="Não foi possível carregar seus vínculos. Tente novamente em instantes." /> : null}

                {!accesses.isLoading && !accesses.isError ? (
                  <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
                    <div className="space-y-3">
                      <SectionHeading title="Pessoas acompanhadas" description="Somente vínculos autorizados liberam análise, metas, registros recentes e comentários." />
                      {approvedAccesses.length ? approvedAccesses.map(access => (
                        <AccessRow
                          key={access.id}
                          access={access}
                          selected={access.patientUserId === selectedPatientId}
                          onSelect={() => setSelectedPatientId(access.patientUserId)}
                          onRevoke={() => revokeAccess.mutate({ accessId: access.id })}
                          revoking={revokeAccess.isPending}
                        />
                      )) : <Empty text="Nenhuma pessoa autorizou acompanhamento até agora." />}
                    </div>
                    <div className="space-y-3">
                      <SectionHeading title="Convites e autorizações" description="A pessoa acompanhada controla a autorização dos próprios dados." />
                      {nonApprovedAccesses.length ? nonApprovedAccesses.map(access => (
                        <div key={access.id} className="rounded-2xl border bg-background p-4 text-sm">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="font-medium">{personLabel(access)}</p>
                            <span className="rounded-full border bg-muted/30 px-3 py-1 text-xs text-muted-foreground">{accessStatusLabel(access.status)}</span>
                          </div>
                          <p className="mt-2 text-xs text-muted-foreground">{accessDateLabel(access)}</p>
                        </div>
                      )) : <Empty text="Nenhum convite pendente ou encerrado." />}
                    </div>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="analise" className="space-y-4">
            <Card className="border-0 shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><ClipboardList className="h-5 w-5 text-primary" /> Análise por pessoa acompanhada</CardTitle>
                <CardDescription>Escolha uma pessoa autorizada para revisar relatórios, metas, sugestões, IA e comentários.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <label className="block max-w-xl space-y-2">
                  <Label>Pessoa acompanhada</Label>
                  <select
                    className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    value={selectedPatientId ?? ""}
                    onChange={event => setSelectedPatientId(event.target.value ? Number(event.target.value) : null)}
                    disabled={!approvedAccesses.length}
                  >
                    <option value="">Selecione uma pessoa</option>
                    {approvedAccesses.map(access => (
                      <option key={access.id} value={access.patientUserId}>{personLabel(access)}</option>
                    ))}
                  </select>
                </label>

                {selectedAccess ? (
                  <div className="rounded-2xl border bg-muted/20 p-4 text-sm leading-6 text-muted-foreground">
                    <p className="font-medium text-foreground">{personLabel(selectedAccess)}</p>
                    <p>{selectedAccess.patient?.email || `ID interno #${selectedAccess.patientUserId}`}</p>
                    <p>{accessDateLabel(selectedAccess)}</p>
                  </div>
                ) : null}

                {dashboard.isLoading ? (
                  <div className="space-y-4">
                    <div className="grid gap-4 lg:grid-cols-4">
                      <Skeleton className="h-28 rounded-2xl" />
                      <Skeleton className="h-28 rounded-2xl" />
                      <Skeleton className="h-28 rounded-2xl" />
                      <Skeleton className="h-28 rounded-2xl" />
                    </div>
                    <Skeleton className="h-48 rounded-2xl" />
                    <div className="grid gap-6 xl:grid-cols-2">
                      <Skeleton className="h-64 rounded-2xl" />
                      <Skeleton className="h-64 rounded-2xl" />
                    </div>
                  </div>
                ) : null}
                {dashboard.isError ? <ErrorMessage text="Não foi possível carregar a análise autorizada. Tente novamente em instantes." /> : null}

                {dashboard.data ? (
                  <Tabs defaultValue="relatorios" className="gap-4">
                    <TabsList className="grid h-auto w-full grid-cols-1 gap-2 rounded-2xl bg-muted/60 p-2 md:grid-cols-5">
                      <TabsTrigger className="min-h-11 rounded-xl" value="relatorios">Relatórios</TabsTrigger>
                      <TabsTrigger className="min-h-11 rounded-xl" value="metas">Metas</TabsTrigger>
                      <TabsTrigger className="min-h-11 rounded-xl" value="sugestoes">Sugestões</TabsTrigger>
                      <TabsTrigger className="min-h-11 rounded-xl" value="ia">IA</TabsTrigger>
                      <TabsTrigger className="min-h-11 rounded-xl" value="comentarios">Comentários</TabsTrigger>
                    </TabsList>

                    <TabsContent value="relatorios" className="space-y-6">
                      <ReportSummarySection metrics={reportSummaryMetrics} />
                      <ReportCalorieAdherenceCard trendData={trendData} dayCount={7} />
                      <ReportCalorieTrendChart trendData={trendData} />
                      <ReportMacroAdherenceCard consumed={consumedMacros} planned={plannedMacros} dailyMacros={dailyMacros} />
                      <ReportQualityCard
                        proteinGrams={weeklyQualityRaw?.proteinGrams}
                        fiberGrams={weeklyQualityRaw?.fiberGrams}
                        fruitServings={weeklyQualityRaw?.fruitServings}
                        vegetableServings={weeklyQualityRaw?.vegetableServings}
                        ultraProcessedServings={weeklyQualityRaw?.ultraProcessedServings}
                        regularityScore={weeklyQualityRaw?.regularityScore}
                        foodQuality={foodQuality}
                      />
                      <ReportWeightCard points={weightTrendPoints} adherencePercent={calorieAdherence.adherencePercent} />
                      <ReportSupportHabitsCard
                        waterConsumedMl={waterConsumedMl}
                        waterGoalMl={waterGoalMl}
                        waterHitDays={waterHitDays}
                        exerciseActiveDays={exerciseActiveDays}
                        exerciseCalories={exerciseCalories}
                        dayCount={7}
                        trendData={trendData}
                      />
                      <ReportDailyCalorieBreakdown trendData={trendData} />
                      <Card className="border-0 shadow-sm">
                        <CardHeader>
                          <CardTitle className="flex items-center gap-2">
                            <UtensilsCrossed className="h-5 w-5 text-primary" />
                            Registros do período
                          </CardTitle>
                          <CardDescription>Refeições autorizadas agrupadas por dia. Abra apenas os dias que precisar investigar.</CardDescription>
                        </CardHeader>
                        <CardContent>
                          <MealsByDateSection meals={dashboard.data.meals} />
                        </CardContent>
                      </Card>
                    </TabsContent>

                    <TabsContent value="metas" className="space-y-4">
                      {defaultNutritionGoal ? (
                        <>
                          <div className="grid gap-3 md:grid-cols-4">
                            <Metric label="Meta base" value={formatCalories(defaultNutritionGoal.calories)} />
                            <Metric label="Proteína" value={formatGrams(defaultNutritionGoal.proteinGrams)} />
                            <Metric label="Carboidratos" value={formatGrams(defaultNutritionGoal.carbsGrams)} />
                            <Metric label="Gorduras" value={formatGrams(defaultNutritionGoal.fatGrams)} />
                          </div>

                          <Card className="border bg-muted/10 shadow-none">
                            <CardHeader>
                              <CardTitle className="flex items-center gap-2">
                                <Target className="h-5 w-5 text-primary" />
                                Soma planejada da semana
                              </CardTitle>
                              <CardDescription>Mesma lógica da tela Metas: regra base aplicada aos dias da semana, com exceções quando existirem.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                              <div className="grid gap-3 md:grid-cols-4">
                                <StatusTile label="Calorias semanais" value={formatCalories(weeklyGoalTotals.calories)} />
                                <StatusTile label="Proteínas" value={formatGrams(weeklyGoalTotals.proteinGrams)} />
                                <StatusTile label="Carboidratos" value={formatGrams(weeklyGoalTotals.carbsGrams)} />
                                <StatusTile label="Gorduras" value={formatGrams(weeklyGoalTotals.fatGrams)} />
                              </div>
                              <div className="grid auto-cols-[minmax(10rem,1fr)] grid-flow-col gap-3 overflow-x-auto pb-2 xl:grid-flow-row xl:grid-cols-7 xl:overflow-visible xl:pb-0">
                                {weeklyGoalDays.map(day => (
                                  <div key={day.weekday} className="min-w-0 rounded-2xl border border-l-4 border-l-emerald-500 bg-background p-3">
                                    <div className="space-y-2">
                                      <div className="flex items-center justify-between gap-2">
                                        <p className="truncate font-medium tracking-tight">{day.label}</p>
                                        <span className="rounded-full bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">{day.shortLabel ?? shortWeekdayLabel(day.weekday)}</span>
                                      </div>
                                      <p className="min-h-10 text-sm leading-5 text-foreground">
                                        {day.source === "exception" ? "Exceção aplicada neste dia." : "Usando a meta geral."}
                                      </p>
                                    </div>
                                    <div className="mt-3 space-y-1 text-sm text-foreground">
                                      <p>{formatCalories(day.calories)}</p>
                                      <p>{formatGrams(day.proteinGrams)} proteína</p>
                                      <p>{formatGrams(day.carbsGrams)} carbo</p>
                                      <p>{formatGrams(day.fatGrams)} gordura</p>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </CardContent>
                          </Card>

                          <ListSection title="Exceções ativas">
                            {activeExceptions.length ? activeExceptions.map(exception => (
                              <div key={`${exception.id ?? exception.weekday}-${exception.durationType}`} className="rounded-xl border bg-muted/20 p-3 text-sm">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <span className="font-medium">{exception.label ?? weekdayLabel(exception.weekday)}</span>
                                  <span className="text-xs text-muted-foreground">{durationTypeLabel(exception.durationType)}</span>
                                </div>
                                <div className="mt-2 grid gap-2 text-muted-foreground md:grid-cols-4">
                                  <span>{formatCalories(exception.calories)}</span>
                                  <span>{formatGrams(exception.proteinGrams)} proteína</span>
                                  <span>{formatGrams(exception.carbsGrams)} carboidratos</span>
                                  <span>{formatGrams(exception.fatGrams)} gorduras</span>
                                </div>
                              </div>
                            )) : <Empty text="Nenhuma exceção ativa. A meta base é aplicada a todos os dias da semana." />}
                          </ListSection>

                          <div className="rounded-2xl border bg-muted/20 p-4 text-sm leading-6 text-muted-foreground">
                            A sugestão fica registrada para avaliação posterior. A meta ativa da pessoa acompanhada não muda automaticamente.
                          </div>
                        </>
                      ) : <Empty text="Nenhuma meta nutricional encontrada para esta pessoa." />}

                      <SuggestionBox title="Sugerir ajuste de meta" description="Os campos começam com a meta atual para facilitar pequenos ajustes. As exceções ativas são preservadas na sugestão.">
                        <div className="grid gap-3 md:grid-cols-4">
                          <NumberField label="Calorias" min={800} value={goalSuggestion.calories} onChange={value => setGoalSuggestion(previous => ({ ...previous, calories: value }))} />
                          <NumberField label="Proteína (g)" min={20} value={goalSuggestion.proteinGrams} onChange={value => setGoalSuggestion(previous => ({ ...previous, proteinGrams: value }))} />
                          <NumberField label="Carboidratos (g)" min={20} value={goalSuggestion.carbsGrams} onChange={value => setGoalSuggestion(previous => ({ ...previous, carbsGrams: value }))} />
                          <NumberField label="Gorduras (g)" min={10} value={goalSuggestion.fatGrams} onChange={value => setGoalSuggestion(previous => ({ ...previous, fatGrams: value }))} />
                        </div>
                        <label className="mt-3 block space-y-2">
                          <Label>Justificativa</Label>
                          <Textarea
                            value={goalSuggestion.rationale}
                            onChange={event => setGoalSuggestion(previous => ({ ...previous, rationale: event.target.value }))}
                            placeholder="Ex.: reduzir calorias mantendo proteína alta para preservar saciedade."
                          />
                        </label>
                        <Button
                          className="mt-4 rounded-full"
                          disabled={!canSuggestGoal || suggestGoal.isPending}
                          onClick={() => selectedPatientId && nutritionGoal && suggestGoal.mutate({
                            patientId: selectedPatientId,
                            rationale: goalSuggestion.rationale.trim(),
                            status: "sent",
                            goal: {
                              defaultGoal: {
                                calories: suggestedCalories,
                                proteinGrams: suggestedProtein,
                                carbsGrams: suggestedCarbs,
                                fatGrams: suggestedFat,
                              },
                              exceptions: nutritionGoal.exceptions,
                            },
                          })}
                        >
                          <MessageSquarePlus className="mr-2 h-4 w-4" /> Enviar sugestão
                        </Button>
                      </SuggestionBox>

                      <ListSection title="Sugestões registradas">
                        {goalSuggestions.length ? goalSuggestions.map(suggestion => <GoalSuggestionRow key={suggestion.id} suggestion={suggestion} />) : <Empty text="Nenhuma sugestão de meta registrada para esta pessoa." />}
                      </ListSection>
                    </TabsContent>

                    <TabsContent value="sugestoes" className="space-y-4">
                      <div className="rounded-2xl border bg-muted/20 p-4 text-sm leading-6 text-muted-foreground">
                        Sugestões de refeição ficam registradas para acompanhamento e não criam refeições automaticamente no diário da pessoa acompanhada.
                      </div>
                      <SuggestionBox title="Sugerir refeição ou plano alimentar" description="Descreva a proposta em linguagem prática para a pessoa revisar depois.">
                        <div className="grid gap-3 md:grid-cols-[0.7fr_1.3fr]">
                          <TextField label="Refeição" value={mealSuggestion.mealLabel} onChange={value => setMealSuggestion(previous => ({ ...previous, mealLabel: value }))} placeholder="Almoço" />
                          <TextField label="Título" value={mealSuggestion.title} onChange={value => setMealSuggestion(previous => ({ ...previous, title: value }))} placeholder="Almoço rico em proteína" />
                        </div>
                        <TextAreaField label="Descrição da sugestão" value={mealSuggestion.description} onChange={value => setMealSuggestion(previous => ({ ...previous, description: value }))} placeholder="Ex.: arroz, feijão, frango grelhado, salada e uma fruta." />
                        <TextAreaField label="Justificativa" value={mealSuggestion.rationale} onChange={value => setMealSuggestion(previous => ({ ...previous, rationale: value }))} placeholder="Ex.: melhorar saciedade no almoço mantendo a meta de proteína." />
                        <TextAreaField label="Observações opcionais" value={mealSuggestion.notes} onChange={value => setMealSuggestion(previous => ({ ...previous, notes: value }))} placeholder="Ex.: trocar frango por ovos nos dias sem preparo." />
                        <Button
                          className="mt-4 rounded-full"
                          disabled={!canSuggestMeal || suggestMeal.isPending}
                          onClick={() => selectedPatientId && suggestMeal.mutate({
                            patientId: selectedPatientId,
                            mealLabel: mealSuggestion.mealLabel.trim(),
                            title: mealSuggestion.title.trim(),
                            description: mealSuggestion.description.trim(),
                            rationale: mealSuggestion.rationale.trim(),
                            notes: mealSuggestion.notes.trim() || undefined,
                            status: "sent",
                          })}
                        >
                          <MessageSquarePlus className="mr-2 h-4 w-4" /> Enviar sugestão
                        </Button>
                      </SuggestionBox>

                      <ListSection title="Sugestões de refeição registradas">
                        {mealSuggestions.length ? mealSuggestions.map(suggestion => <MealSuggestionRow key={suggestion.id} suggestion={suggestion} />) : <Empty text="Nenhuma sugestão de refeição registrada para esta pessoa." />}
                      </ListSection>
                    </TabsContent>

                    <TabsContent value="ia" className="space-y-4">
                      <div className="rounded-2xl border bg-muted/20 p-4 text-sm leading-6 text-muted-foreground">
                        Perguntas com IA usam apenas o contexto autorizado desta pessoa e retornam apoio educativo para análise profissional.
                      </div>
                      <SuggestionBox title="Perguntar sobre a pessoa acompanhada" description="Use perguntas objetivas sobre aderência, registros, metas ou tendências disponíveis.">
                        <TextAreaField label="Pergunta" value={patientQuestion} onChange={setPatientQuestion} placeholder="Ex.: O que chama atenção na aderência desta semana?" />
                        <Button
                          className="mt-4 rounded-full"
                          disabled={!canAskQuestion || askPatientQuestion.isPending}
                          onClick={() => selectedPatientId && askPatientQuestion.mutate({ patientId: selectedPatientId, question: patientQuestion.trim() })}
                        >
                          <MessageSquarePlus className="mr-2 h-4 w-4" /> Perguntar
                        </Button>
                      </SuggestionBox>
                      {patientAnswer ? <PatientAiAnswerCard answer={patientAnswer} /> : <Empty text="Faça uma pergunta para gerar uma resposta com base no contexto autorizado." />}
                    </TabsContent>

                    <TabsContent value="comentarios" className="space-y-3">
                      <p className="font-medium">Comentários profissionais</p>
                      <Textarea value={comment} onChange={event => setComment(event.target.value)} placeholder="Adicionar comentário de acompanhamento" />
                      <Button
                        className="rounded-full"
                        disabled={!selectedPatientId || !comment.trim()}
                        onClick={() => selectedPatientId && addComment.mutate({ patientId: selectedPatientId, comment })}
                      >
                        <MessageSquarePlus className="mr-2 h-4 w-4" /> Comentar
                      </Button>
                      {dashboard.data.comments.length ? dashboard.data.comments.map(item => (
                        <div key={item.id} className="rounded-xl border bg-muted/20 p-3 text-sm">{item.comment}</div>
                      )) : <Empty text="Nenhum comentário profissional registrado para esta pessoa." />}
                    </TabsContent>
                  </Tabs>
                ) : !dashboard.isLoading && !dashboard.isError ? (
                  <Empty text="Selecione uma pessoa autorizada para visualizar a análise." />
                ) : null}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}


function IntroStat({ label, value, helper }: { label: string; value: string; helper: string }) {
  return (
    <div className="rounded-2xl border bg-background p-4 shadow-sm">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{helper}</p>
    </div>
  );
}

function SectionHeading({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <h2 className="text-base font-semibold tracking-tight">{title}</h2>
      <p className="text-sm leading-6 text-muted-foreground">{description}</p>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-background p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 text-xl font-semibold tracking-tight">{value}</p>
    </div>
  );
}

function AccessRow({
  access,
  selected,
  onSelect,
  onRevoke,
  revoking,
}: {
  access: { id: string; patientUserId: number; patient?: { name: string | null; email: string | null } | null; status: string; requestedAt: number; approvedAt: number | null; revokedAt: number | null };
  selected: boolean;
  onSelect: () => void;
  onRevoke: () => void;
  revoking: boolean;
}) {
  return (
    <div className={`rounded-2xl border bg-background p-4 ${selected ? "ring-2 ring-primary/30" : ""}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-medium">{personLabel(access)}</p>
          <p className="text-xs text-muted-foreground">{access.patient?.email || `ID interno #${access.patientUserId}`}</p>
          <p className="text-xs text-muted-foreground">{accessDateLabel(access)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant={selected ? "default" : "outline"} className="rounded-full" onClick={onSelect}>Analisar</Button>
          <Button variant="outline" className="rounded-full" onClick={onRevoke} disabled={revoking}>
            <X className="mr-2 h-4 w-4" />
            Revogar vínculo
          </Button>
        </div>
      </div>
    </div>
  );
}

function MealRow({ meal }: { meal: MealSummary }) {
  return (
    <div className="rounded-xl border bg-background p-3 text-sm">
      <div className="flex justify-between gap-3">
        <span className="font-medium">{meal.mealLabel}</span>
        <span>{formatCalories(meal.totals.calories)}</span>
      </div>
      <p className="text-xs text-muted-foreground">{new Date(meal.occurredAt).toLocaleString("pt-BR")}</p>
    </div>
  );
}

function MealsByDateSection({ meals }: { meals: MealSummary[] }) {
  const mealsByDate = useMemo(() => {
    const groups = new Map<string, MealSummary[]>();
    for (const meal of meals) {
      const date = new Date(meal.occurredAt).toISOString().slice(0, 10);
      if (!groups.has(date)) groups.set(date, []);
      groups.get(date)!.push(meal);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => b.localeCompare(a));
  }, [meals]);

  if (!mealsByDate.length) return <Empty text="Nenhum registro recente encontrado." />;

  return (
    <div className="space-y-3">
      {mealsByDate.map(([date, dayMeals]) => {
        const totalCalories = dayMeals.reduce((sum, m) => sum + m.totals.calories, 0);
        const heading = new Date(`${date}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "short" });
        return (
          <details key={date} className="group rounded-3xl border bg-muted/10 p-4">
            <summary className="flex cursor-pointer list-none flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-base font-semibold tracking-tight capitalize">{heading}</p>
                <p className="text-sm text-muted-foreground">{dayMeals.length} refeições no dia</p>
              </div>
              <div className="flex items-center gap-3">
                <span className="rounded-full border px-3 py-1 text-xs font-medium">{formatCalories(totalCalories)}</span>
                <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
              </div>
            </summary>
            <div className="mt-4 space-y-2">
              {dayMeals.map(meal => <MealRow key={meal.id} meal={meal} />)}
            </div>
          </details>
        );
      })}
    </div>
  );
}

function SuggestionBox({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border bg-background p-4">
      <div className="mb-4">
        <p className="font-medium">{title}</p>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </div>
  );
}

function ListSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="font-medium">{title}</p>
      {children}
    </div>
  );
}

function TextField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return (
    <label className="space-y-2">
      <Label>{label}</Label>
      <Input value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} />
    </label>
  );
}

function NumberField({ label, value, min, onChange }: { label: string; value: string; min: number; onChange: (value: string) => void }) {
  return (
    <label className="space-y-2">
      <Label>{label}</Label>
      <Input type="number" min={min} value={value} onChange={event => onChange(event.target.value)} />
    </label>
  );
}

function TextAreaField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return (
    <label className="mt-3 block space-y-2">
      <Label>{label}</Label>
      <Textarea value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} />
    </label>
  );
}

function PatientAiAnswerCard({ answer }: { answer: PatientAiAnswer }) {
  return (
    <div className="rounded-2xl border bg-background p-4 text-sm leading-6">
      <p className="font-medium">Resposta</p>
      <p className="mt-2 text-muted-foreground">{answer.answer}</p>
      {answer.citedContext.length ? (
        <div className="mt-3">
          <p className="text-xs font-medium uppercase text-muted-foreground">Contexto usado</p>
          <div className="mt-2 grid gap-2 md:grid-cols-3">
            {answer.citedContext.map(item => <span key={item} className="rounded-xl border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">{item}</span>)}
          </div>
        </div>
      ) : null}
      {answer.caution ? <p className="mt-3 text-xs text-muted-foreground">{answer.caution}</p> : null}
      <p className="mt-3 text-xs text-muted-foreground">{answer.educationalNotice}</p>
    </div>
  );
}

function GoalSuggestionRow({ suggestion }: {
  suggestion: {
    id: string;
    status: string;
    rationale: string;
    createdAt: number;
    goal: {
      defaultGoal: {
        calories: number;
        proteinGrams: number;
        carbsGrams: number;
        fatGrams: number;
      };
    };
  };
}) {
  return (
    <div className="rounded-xl border bg-muted/20 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{suggestionStatusLabel(suggestion.status)}</span>
        <span className="text-xs text-muted-foreground">{new Date(suggestion.createdAt).toLocaleString("pt-BR")}</span>
      </div>
      <div className="mt-2 grid gap-2 text-muted-foreground md:grid-cols-4">
        <span>{formatCalories(suggestion.goal.defaultGoal.calories)}</span>
        <span>{formatGrams(suggestion.goal.defaultGoal.proteinGrams)} proteína</span>
        <span>{formatGrams(suggestion.goal.defaultGoal.carbsGrams)} carboidratos</span>
        <span>{formatGrams(suggestion.goal.defaultGoal.fatGrams)} gorduras</span>
      </div>
      <p className="mt-2 text-muted-foreground">{suggestion.rationale}</p>
    </div>
  );
}

function MealSuggestionRow({ suggestion }: {
  suggestion: {
    id: string;
    status: string;
    mealLabel: string;
    title: string;
    description: string;
    rationale: string;
    notes?: string;
    createdAt: number;
  };
}) {
  return (
    <div className="rounded-xl border bg-muted/20 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{suggestion.mealLabel} · {suggestion.title}</span>
        <span className="text-xs text-muted-foreground">{suggestionStatusLabel(suggestion.status)} · {new Date(suggestion.createdAt).toLocaleString("pt-BR")}</span>
      </div>
      <p className="mt-2 text-muted-foreground">{suggestion.description}</p>
      <p className="mt-2 text-muted-foreground">Justificativa: {suggestion.rationale}</p>
      {suggestion.notes ? <p className="mt-2 text-xs text-muted-foreground">Obs.: {suggestion.notes}</p> : null}
    </div>
  );
}

function suggestionStatusLabel(status: string) {
  const labels: Record<string, string> = {
    draft: "Rascunho",
    sent: "Enviada",
    accepted: "Aceita",
    refused: "Recusada",
    cancelled: "Cancelada",
  };
  return labels[status] ?? status;
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

function AnalyticsHeader({
  icon,
  title,
  scopeLabel,
  description,
}: {
  icon: ReactNode;
  title: string;
  scopeLabel: string;
  description: string;
}) {
  return (
    <CardHeader className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <CardTitle className="flex items-center gap-2">
          {icon}
          {title}
        </CardTitle>
        <span className="rounded-full border px-3 py-1 text-xs uppercase tracking-wide text-muted-foreground">
          {scopeLabel}
        </span>
      </div>
      <CardDescription>{description}</CardDescription>
    </CardHeader>
  );
}

function AnalyticsReading({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl border bg-background px-4 py-3 text-sm leading-6 text-muted-foreground">{children}</div>;
}

function CompactMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border bg-muted/10 px-4 py-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold tracking-tight">{value}</p>
    </div>
  );
}

function WaterAnalyticsCard({
  title,
  scopeLabel,
  description,
  totalConsumedMl,
  totalGoalMl,
  goalHitDays,
  totalDays,
  averageDailyMl,
  lowestDay,
  reading,
}: {
  title: string;
  scopeLabel: string;
  description: string;
  totalConsumedMl: number;
  totalGoalMl: number;
  goalHitDays: number;
  totalDays: number;
  averageDailyMl: number;
  lowestDay: string;
  reading: string;
}) {
  return (
    <Card className="border-0 shadow-sm">
      <AnalyticsHeader icon={<Droplets className="h-5 w-5 text-primary" />} title={title} scopeLabel={scopeLabel} description={description} />
      <CardContent className="space-y-4">
        <div className="rounded-3xl border bg-muted/20 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-sm font-medium tracking-tight">Aderência à meta de água</p>
            <p className="text-sm text-muted-foreground">{Math.round(progressPercent(totalConsumedMl, totalGoalMl))}%</p>
          </div>
          <Progress className="h-2" value={progressPercent(totalConsumedMl, totalGoalMl)} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <CompactMetric label="Meta do período" value={formatCountPtBr(Math.round(totalGoalMl), " ml")} />
          <CompactMetric label="Consumo acumulado" value={formatCountPtBr(Math.round(totalConsumedMl), " ml")} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <StatusTile label="Meta batida" value={`${goalHitDays}/${totalDays} dias`} />
          <StatusTile label="Média diária" value={formatCountPtBr(Math.round(averageDailyMl), " ml")} />
          <StatusTile label="Total consumido" value={formatCountPtBr(Math.round(totalConsumedMl), " ml")} />
          <StatusTile label="Menor dia" value={lowestDay} />
        </div>
        <AnalyticsReading>{reading}</AnalyticsReading>
      </CardContent>
    </Card>
  );
}

function ExerciseAnalyticsCard({
  title,
  scopeLabel,
  description,
  activeDays,
  totalDays,
  totalCalories,
  detailLabel,
  detailValue,
  averageCaloriesPerActiveDay,
  highestDay,
  reading,
}: {
  title: string;
  scopeLabel: string;
  description: string;
  activeDays: number;
  totalDays: number;
  totalCalories: number;
  detailLabel: string;
  detailValue: string;
  averageCaloriesPerActiveDay: number;
  highestDay: string;
  reading: string;
}) {
  return (
    <Card className="border-0 shadow-sm">
      <AnalyticsHeader icon={<Dumbbell className="h-5 w-5 text-primary" />} title={title} scopeLabel={scopeLabel} description={description} />
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <CompactMetric label="Dias ativos" value={`${activeDays}/${totalDays}`} />
          <CompactMetric label="Gasto total" value={formatCalories(totalCalories)} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <StatusTile label={detailLabel} value={detailValue} />
          <StatusTile label="Média por dia ativo" value={activeDays ? formatCalories(averageCaloriesPerActiveDay) : "0 kcal"} />
          <StatusTile label="Maior dia" value={highestDay} />
        </div>
        <AnalyticsReading>{reading}</AnalyticsReading>
      </CardContent>
    </Card>
  );
}

function StatusMessage({ text }: { text: string }) {
  return <div className="rounded-2xl border bg-muted/20 p-6 text-sm text-muted-foreground" role="status" aria-live="polite">{text}</div>;
}

function ErrorMessage({ text }: { text: string }) {
  return <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-6 text-sm text-destructive">{text}</div>;
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-2xl border border-dashed bg-muted/20 p-6 text-sm leading-6 text-muted-foreground">{text}</div>;
}

function progressPercent(value: number, goal: number) {
  if (!goal) return 0;
  return Math.min(Math.max((value / goal) * 100, 0), 100);
}

// ─── Report sub-components (mirrors ReportsGoalsPage week scope) ──────────────

type ReportMetric = { title: string; value: string; description: string };

function ReportMetricCard({ title, value, description }: ReportMetric) {
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

function ReportSectionTitle({ title, description, badge }: { title: string; description: string; badge?: string }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
      {badge ? <span className="rounded-full border px-3 py-1 text-xs uppercase tracking-wide text-muted-foreground">{badge}</span> : null}
    </div>
  );
}

function ReportSectionHeader({ icon, title, description, badge }: { icon: ReactNode; title: string; description: string; badge?: string }) {
  return (
    <CardHeader className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <CardTitle className="flex items-center gap-2">{icon}<span>{title}</span></CardTitle>
        {badge ? <span className="rounded-full border px-3 py-1 text-xs uppercase tracking-wide text-muted-foreground">{badge}</span> : null}
      </div>
      <CardDescription>{description}</CardDescription>
    </CardHeader>
  );
}

function ReportEmptyState({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl border border-dashed bg-muted/10 p-5 text-sm leading-6 text-muted-foreground">{children}</div>;
}

function ReportSummarySection({ metrics }: { metrics: ReportMetric[] }) {
  return (
    <section className="space-y-4">
      <ReportSectionTitle title="Resumo do período" description="Os principais sinais ficam juntos para mostrar rapidamente se o período está alinhado às metas." badge="Orientado a metas" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map(m => <ReportMetricCard key={m.title} {...m} />)}
      </div>
    </section>
  );
}

function ReportCalorieAdherenceCard({ trendData, dayCount }: { trendData: TrendPoint[]; dayCount: number }) {
  const summary = calculateCalorieAdherence(trendData, dayCount);
  return (
    <Card className="border-0 shadow-sm">
      <ReportSectionHeader icon={<Target className="h-5 w-5 text-primary" />} title="Aderência à meta calórica" description="Compara calorias consumidas com a meta ajustada do dia. A faixa ideal considera 90% a 105% da meta." badge="Meta ajustada" />
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

function ReportCalorieTrendChart({ trendData }: { trendData: TrendPoint[] }) {
  if (!trendData.length) {
    return <Card className="border-0 shadow-sm"><CardContent className="p-6 text-sm text-muted-foreground">Ainda não há registros suficientes para desenhar o gráfico de aderência calórica.</CardContent></Card>;
  }
  return (
    <Card className="border-0 shadow-sm">
      <ReportSectionHeader icon={<BarChart3 className="h-5 w-5 text-primary" />} title="Consumido vs meta ajustada" description="Cada barra compara o total consumido com a meta ajustada daquele dia." />
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
              {trendData.map(day => <Cell key={day.date} fill={getReportCalorieBarColor(day.calories, day.goalCalories)} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

function ReportDailyCalorieBreakdown({ trendData }: { trendData: TrendPoint[] }) {
  if (!trendData.length) return null;
  const totalCalories = trendData.reduce((t, d) => t + d.calories, 0);
  const totalGoalCalories = trendData.reduce((t, d) => t + d.goalCalories, 0);
  const totalDeltaCalories = trendData.reduce((t, d) => t + d.calorieDelta, 0);
  const totalExerciseCalories = trendData.reduce((t, d) => t + d.exerciseCalories, 0);
  const totalAdherencePercent = totalGoalCalories > 0 ? (totalCalories / totalGoalCalories) * 100 : 0;
  return (
    <Card className="border-0 shadow-sm">
      <ReportSectionHeader icon={<Target className="h-5 w-5 text-primary" />} title="Detalhe diário da meta ajustada" description="Cada dia mostra consumo, meta ajustada, diferença e percentual de aderência recalculados para o período." />
      <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {trendData.map(day => (
          <div key={day.date} className="rounded-2xl border bg-background p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="font-medium tracking-tight">{day.label}</p>
              <span className="rounded-full border px-2 py-0.5 text-xs">{formatPercent(day.adherencePercent)}</span>
            </div>
            <div className="grid gap-2 text-sm text-muted-foreground">
              <span>Consumido: <strong className="text-foreground">{formatCalories(day.calories)}</strong></span>
              <span>Meta ajustada: <strong className="text-foreground">{formatCalories(day.goalCalories)}</strong></span>
              <span>Diferença: <strong className="text-foreground">{formatCalories(day.calorieDelta)}</strong></span>
              {day.exerciseCalories > 0 ? <span>Exercícios adicionaram {formatCalories(day.exerciseCalories)} à meta.</span> : null}
            </div>
          </div>
        ))}
        <div className="rounded-2xl border bg-background p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="font-medium tracking-tight">Total da semana</p>
            <span className="rounded-full border px-2 py-0.5 text-xs">{formatPercent(totalAdherencePercent)}</span>
          </div>
          <div className="grid gap-2 text-sm text-muted-foreground">
            <span>Consumido: <strong className="text-foreground">{formatCalories(totalCalories)}</strong></span>
            <span>Meta ajustada: <strong className="text-foreground">{formatCalories(totalGoalCalories)}</strong></span>
            <span>Diferença: <strong className="text-foreground">{formatCalories(totalDeltaCalories)}</strong></span>
            {totalExerciseCalories > 0 ? <span>Exercícios adicionaram {formatCalories(totalExerciseCalories)} à meta.</span> : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ReportMacroAdherenceCard({ consumed, planned, dailyMacros }: { consumed: MacroTotals; planned: MacroTotals; dailyMacros: MacroGoalDay[] }) {
  const analysis = calculateMacroAdherence(consumed, planned);
  const dailySummary = calculateMacroDaySummary(dailyMacros);
  const hasMacroGoal = planned.protein > 0 || planned.carbs > 0 || planned.fat > 0;
  const chartData = analysis.items.map(item => ({ macro: item.label, planejado: item.plannedPercent, realizado: item.consumedPercent }));
  return (
    <Card className="border-0 shadow-sm">
      <ReportSectionHeader icon={<Activity className="h-5 w-5 text-primary" />} title="Macronutrientes planejados vs realizados" description="Compara gramas e distribuição percentual para mostrar se a composição acompanha a meta, não só as calorias." badge={hasMacroGoal ? `${formatPercent(analysis.distributionAdherencePercent)} aderência` : "Sem meta"} />
      <CardContent className="space-y-5">
        {!hasMacroGoal ? <ReportEmptyState>Configure metas de proteínas, carboidratos e gorduras para liberar a comparação completa de macros.</ReportEmptyState> : (
          <>
            <div className="grid gap-3 md:grid-cols-3">
              <StatusTile label="Proteína na faixa" value={`${dailySummary.proteinDaysWithinGoal}/${dailySummary.daysWithMacroRecords}`} />
              <StatusTile label="Gordura acima" value={dailySummary.fatDaysAboveGoal} />
              <StatusTile label="Macro mais distante" value={analysis.mostDistantMacro?.label ?? "-"} />
            </div>
            <div className="h-[280px] rounded-2xl border bg-background p-4 shadow-sm">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} barSize={32}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="macro" />
                  <YAxis tickFormatter={v => `${v}%`} />
                  <Tooltip formatter={v => formatPercent(Number(v))} />
                  <Legend />
                  <Bar dataKey="planejado" name="Planejado" fill="#94a3b8" radius={[8, 8, 0, 0]} />
                  <Bar dataKey="realizado" name="Realizado" fill="#16a34a" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              {analysis.items.map(item => (
                <div key={item.key} className="rounded-2xl border bg-background p-4 shadow-sm">
                  <div className="mb-3 flex items-center justify-between gap-3"><p className="text-sm font-medium">{item.label}</p><span className="h-3 w-3 rounded-full" style={{ backgroundColor: MACRO_COLORS[item.key] }} /></div>
                  <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-1 xl:grid-cols-2">
                    <StatusTile label="Planejado" value={`${formatMacro(item.plannedGrams)} g`} />
                    <StatusTile label="Realizado" value={`${formatMacro(item.consumedGrams)} g`} />
                  </div>
                  <p className="mt-3 text-sm text-muted-foreground">Desvio: {item.percentPointDelta > 0 ? "+" : ""}{formatPercent(item.percentPointDelta)} e {item.gramDelta > 0 ? "+" : ""}{formatMacro(item.gramDelta)} g.</p>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ReportQualityCard({ proteinGrams, fiberGrams, fruitServings, vegetableServings, ultraProcessedServings, regularityScore, foodQuality }: {
  proteinGrams?: number; fiberGrams?: number; fruitServings?: number; vegetableServings?: number; ultraProcessedServings?: number; regularityScore?: number; foodQuality?: FoodQualitySummary;
}) {
  const distribution = foodQuality?.distribution?.length ? foodQuality.distribution : EMPTY_FOOD_QUALITY_DISTRIBUTION;
  return (
    <Card className="border-0 shadow-sm">
      <ReportSectionHeader icon={<Leaf className="h-5 w-5 text-primary" />} title="Qualidade alimentar agregada" description="Indicadores do período sem detalhar alimento por alimento. Itens sem classificação ficam separados para não distorcer percentuais." badge="Agregado" />
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <StatusTile label="Dias com frutas" value={`${foodQuality?.fruitDays ?? 0}/${foodQuality?.dayCount ?? 0}`} />
          <StatusTile label="Dias com legumes/verduras" value={`${foodQuality?.vegetableDays ?? 0}/${foodQuality?.dayCount ?? 0}`} />
          <StatusTile label="Ultraprocessados" value={formatPercent(foodQuality?.ultraProcessedCaloriesPercent)} />
          <StatusTile label="In natura/minimamente" value={formatPercent(foodQuality?.naturalOrMinimallyProcessedCaloriesPercent)} />
          <StatusTile label="Índice de qualidade" value={foodQuality?.qualityIndex == null ? "-" : formatPercent(foodQuality.qualityIndex)} />
        </div>
        {!foodQuality?.hasData ? <ReportEmptyState>Ainda não há alimentos classificados suficientes para preencher estes indicadores no período selecionado.</ReportEmptyState> : null}
        <div className="grid gap-3 md:grid-cols-3">
          {distribution.map(item => (
            <div key={item.key} className="rounded-2xl border bg-background p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between gap-3"><p className="text-sm font-medium">{item.label}</p><span className="rounded-full border px-2 py-0.5 text-xs">{formatPercent(item.percent)}</span></div>
              <Progress className="h-2" value={item.percent} />
              <p className="mt-3 text-sm text-muted-foreground">{formatCalories(item.calories)} no período.</p>
            </div>
          ))}
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <StatusTile label="Proteína" value={`${formatMacro(proteinGrams ?? 0)} g`} />
          <StatusTile label="Fibras" value={`${formatMacro(fiberGrams ?? 0)} g`} />
          <StatusTile label="Porções de frutas" value={formatMacro(fruitServings ?? 0)} />
          <StatusTile label="Porções de legumes/verduras" value={formatMacro(vegetableServings ?? 0)} />
          <StatusTile label="Porções ultraprocessadas" value={formatMacro(ultraProcessedServings ?? 0)} />
        </div>
        <div className="rounded-2xl border bg-background p-4"><p className="text-sm text-muted-foreground">Regularidade das refeições</p><p className="mt-2 text-2xl font-semibold tracking-tight">{formatPercent(regularityScore ?? 0)}</p></div>
      </CardContent>
    </Card>
  );
}

function ReportWeightCard({ points, adherencePercent }: { points: WeightTrendPoint[]; adherencePercent: number }) {
  const summary = calculateWeightTrendSummary(points);
  const chartData = points.map(p => ({ date: p.date, label: p.label ?? p.date, weightKg: p.weightKg }));
  const badge = summary.trendDirection === "insufficient_data" ? "Tendência insuficiente" : summary.trendDirection === "stable" ? "Estável" : summary.trendDirection === "up" ? "Subiu" : "Caiu";
  return (
    <Card className="border-0 shadow-sm">
      <ReportSectionHeader icon={<Scale className="h-5 w-5 text-primary" />} title="Evolução do peso e aderência" description="Relaciona registros de peso do período com a aderência calórica média, sem tirar conclusões clínicas isoladas." badge={badge} />
      <CardContent className="space-y-5">
        {summary.hasData ? (
          <>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <StatusTile label="Peso inicial" value={`${formatMacro(summary.firstWeightKg ?? 0)} kg`} />
              <StatusTile label="Último peso" value={`${formatMacro(summary.lastWeightKg ?? 0)} kg`} />
              <StatusTile label="Variação" value={`${formatSignedMacro(summary.deltaKg)} kg`} />
              <StatusTile label="Aderência calórica" value={formatPercent(adherencePercent)} />
            </div>
            {chartData.length > 1 ? (
              <div className="h-[260px] rounded-2xl border bg-background p-4 shadow-sm">
                <ResponsiveContainer width="100%" height="100%"><LineChart data={chartData}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="label" /><YAxis domain={["dataMin - 1", "dataMax + 1"]} /><Tooltip formatter={v => `${formatMacro(Number(v))} kg`} /><Legend /><Line type="linear" dataKey="weightKg" name="Peso" stroke="#16a34a" strokeWidth={3} dot /></LineChart></ResponsiveContainer>
              </div>
            ) : null}
            <div className="rounded-2xl border bg-muted/20 p-4 text-sm leading-6 text-muted-foreground">{summary.trendMessage} A aderência calórica média do período foi de {formatPercent(adherencePercent)}.</div>
          </>
        ) : <ReportEmptyState>Ainda não há registros de peso no período selecionado para relacionar evolução corporal e aderência calórica.</ReportEmptyState>}
      </CardContent>
    </Card>
  );
}

function ReportSupportHabitsCard({ waterConsumedMl, waterGoalMl, waterHitDays, exerciseActiveDays, exerciseCalories, dayCount, trendData }: {
  waterConsumedMl: number; waterGoalMl: number; waterHitDays: number; exerciseActiveDays: number; exerciseCalories: number; dayCount: number; trendData: TrendPoint[];
}) {
  const waterAdherencePercent = progressPercent(waterConsumedMl, waterGoalMl);
  const averageDailyWaterMl = dayCount > 0 ? waterConsumedMl / dayCount : 0;
  const daysWithExercise = trendData.filter(d => d.exerciseCalories > 0);
  const daysWithoutExercise = trendData.filter(d => d.exerciseCalories <= 0);
  const adjustedGoalWithExercise = averageTrendValue(daysWithExercise, d => d.goalCalories);
  const adjustedGoalWithoutExercise = averageTrendValue(daysWithoutExercise, d => d.goalCalories);
  const adherenceWithExercise = averageTrendValue(daysWithExercise, d => d.adherencePercent);
  const adherenceWithoutExercise = averageTrendValue(daysWithoutExercise, d => d.adherencePercent);
  return (
    <Card className="border-0 shadow-sm">
      <ReportSectionHeader icon={<TrendingUp className="h-5 w-5 text-primary" />} title="Água e exercícios como apoio" description="Hábitos de suporte aparecem junto da meta ajustada para explicar o contexto do período, sem virar detalhe de treino." />
      <CardContent className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border bg-background p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-3"><p className="flex items-center gap-2 text-sm font-medium"><Droplets className="h-4 w-4 text-primary" /> Água vs meta</p><span className="text-sm text-muted-foreground">{formatPercent(waterAdherencePercent)}</span></div>
          <Progress className="h-2" value={waterAdherencePercent} />
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <StatusTile label="Consumido" value={formatCountPtBr(Math.round(waterConsumedMl), " ml")} />
            <StatusTile label="Média diária" value={formatCountPtBr(Math.round(averageDailyWaterMl), " ml")} />
            <StatusTile label="Aderência à água" value={formatPercent(waterAdherencePercent)} />
            <StatusTile label="Meta batida" value={`${waterHitDays}/${dayCount} dias`} />
          </div>
          {waterConsumedMl <= 0 ? <div className="mt-4"><ReportEmptyState>Ainda não há registros de água no período selecionado.</ReportEmptyState></div> : null}
        </div>
        <div className="rounded-2xl border bg-background p-4 shadow-sm">
          <p className="mb-4 flex items-center gap-2 text-sm font-medium"><Dumbbell className="h-4 w-4 text-primary" /> Exercícios e meta ajustada</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <StatusTile label="Dias ativos" value={`${exerciseActiveDays}/${dayCount}`} />
            <StatusTile label="Gasto estimado" value={formatCalories(exerciseCalories)} />
            <StatusTile label="Meta em dias ativos" value={adjustedGoalWithExercise == null ? "-" : formatCalories(adjustedGoalWithExercise)} />
            <StatusTile label="Meta sem exercício" value={adjustedGoalWithoutExercise == null ? "-" : formatCalories(adjustedGoalWithoutExercise)} />
            <StatusTile label="Aderência em dias ativos" value={adherenceWithExercise == null ? "-" : formatPercent(adherenceWithExercise)} />
            <StatusTile label="Aderência sem exercício" value={adherenceWithoutExercise == null ? "-" : formatPercent(adherenceWithoutExercise)} />
          </div>
          {exerciseActiveDays <= 0 ? <div className="mt-4"><ReportEmptyState>Ainda não há exercícios registrados nesta semana.</ReportEmptyState></div> : null}
        </div>
      </CardContent>
    </Card>
  );
}

function averageValue(total: number, count: number) {
  if (!count) return 0;
  return total / count;
}



function findExtreme<T>(items: T[], getValue: (item: T) => number, direction: "min" | "max") {
  return items.reduce<T | null>((current, item) => {
    if (!current) return item;
    const nextValue = getValue(item);
    const currentValue = getValue(current);
    return direction === "max" ? (nextValue > currentValue ? item : current) : (nextValue < currentValue ? item : current);
  }, null);
}

function weekdayLabel(weekday: number) {
  return GOAL_WEEKDAYS.find(day => day.weekday === weekday)?.label ?? "Dia";
}

function shortWeekdayLabel(weekday: number) {
  return GOAL_WEEKDAYS.find(day => day.weekday === weekday)?.shortLabel ?? "dia";
}

function durationTypeLabel(durationType: string) {
  const labels: Record<string, string> = {
    "1_week": "Por 1 semana",
    "2_weeks": "Por 2 semanas",
    "3_weeks": "Por 3 semanas",
    always: "Sempre",
  };
  return labels[durationType] ?? durationType;
}
