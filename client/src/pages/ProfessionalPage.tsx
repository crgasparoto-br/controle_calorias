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
import { formatCalories, formatCountPtBr, formatGrams, formatPercentPtBr } from "@/lib/numberFormat";
import { trpc } from "@/lib/trpc";
import {
  BarChart3,
  CalendarDays,
  ChevronDown,
  ClipboardList,
  Droplets,
  Dumbbell,
  Lightbulb,
  Mail,
  MessageSquarePlus,
  Scale,
  ShieldAlert,
  Target,
  UserPlus,
  UtensilsCrossed,
  X,
} from "lucide-react";
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
  protein: number;
  carbs: number;
  fat: number;
  waterConsumedMl?: number | null;
  waterGoalMl?: number | null;
  exerciseCalories?: number | null;
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

type ReportInsight = {
  title: string;
  description: string;
};

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
  const weeklyTrend = useMemo(() => weeklyReport.map(day => ({
    ...day,
    goalCalories: Math.round(day.goalCalories ?? 0),
    calories: Math.round(day.calories ?? 0),
    protein: Math.round(day.protein ?? 0),
    carbs: Math.round(day.carbs ?? 0),
    fat: Math.round(day.fat ?? 0),
  })), [weeklyReport]);
  const weeklyQuality = useMemo(() => weeklyReport.reduce(
    (acc, day) => ({
      proteinGrams: acc.proteinGrams + (day.quality?.proteinGrams ?? day.protein ?? 0),
      fiberGrams: acc.fiberGrams + (day.quality?.fiberGrams ?? 0),
      waterMl: acc.waterMl + (day.quality?.waterMl ?? day.waterConsumedMl ?? 0),
      fruitServings: acc.fruitServings + (day.quality?.fruitServings ?? 0),
      vegetableServings: acc.vegetableServings + (day.quality?.vegetableServings ?? 0),
      ultraProcessedServings: acc.ultraProcessedServings + (day.quality?.ultraProcessedServings ?? 0),
      mealCount: acc.mealCount + (day.quality?.mealCount ?? 0),
      regularityScore: acc.regularityScore + ((day.quality?.regularityScore ?? 0) / Math.max(weeklyReport.length, 1)),
    }),
    {
      proteinGrams: 0,
      fiberGrams: 0,
      waterMl: 0,
      fruitServings: 0,
      vegetableServings: 0,
      ultraProcessedServings: 0,
      mealCount: 0,
      regularityScore: 0,
    },
  ), [weeklyReport]);
  const weeklyWaterTotal = weeklyReport.reduce((total, day) => total + (day.waterConsumedMl ?? 0), 0);
  const weeklyWaterGoalTotal = weeklyReport.reduce((total, day) => total + (day.waterGoalMl ?? 0), 0);
  const weeklyWaterGoalHitDays = weeklyReport.filter(day => (day.waterGoalMl ?? 0) > 0 && (day.waterConsumedMl ?? 0) >= (day.waterGoalMl ?? 0)).length;
  const lowestWaterDay = findExtreme(weeklyReport.filter(day => (day.waterConsumedMl ?? 0) > 0), day => day.waterConsumedMl ?? 0, "min");
  const weeklyExerciseActiveDays = weeklyReport.filter(day => (day.exerciseCalories ?? 0) > 0).length;
  const highestExerciseDay = findExtreme(weeklyReport.filter(day => (day.exerciseCalories ?? 0) > 0), day => day.exerciseCalories ?? 0, "max");
  const daysWithinGoal = weeklyReport.filter(day => day.goalCalories > 0 && Math.abs(day.calories - day.goalCalories) <= Math.max(day.goalCalories * 0.1, 100)).length;
  const daysAboveGoal = weeklyReport.filter(day => day.goalCalories > 0 && day.calories > day.goalCalories).length;
  const daysBelowGoal = weeklyReport.filter(day => day.goalCalories > 0 && day.calories > 0 && day.calories < day.goalCalories).length;
  const daysWithoutRecords = weeklyReport.filter(day => day.calories <= 0).length;
  const reportInsights = useMemo(() => buildReportInsights({
    weeklyReport,
    weeklyAdherence: dashboard.data?.weeklyAdherence ?? 0,
    weeklyExerciseActiveDays,
    weeklyWaterGoalHitDays,
  }), [dashboard.data?.weeklyAdherence, weeklyExerciseActiveDays, weeklyReport, weeklyWaterGoalHitDays]);
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

                    <TabsContent value="relatorios" className="space-y-4">
                      <div className="grid gap-4 lg:grid-cols-4">
                        <HighlightCard title="Aderência semanal" value={`${formatPercentPtBr(dashboard.data.weeklyAdherence)}%`} description="Comparativo entre consumo e meta da semana autorizada." />
                        <HighlightCard title="Total da semana" value={formatCalories(dashboard.data.calories.consumed)} description={`Meta semanal: ${formatCalories(dashboard.data.calories.planned)}.`} />
                        <HighlightCard title="Proteína registrada" value={formatGrams(dashboard.data.macros.protein)} description="Soma de proteínas consumidas no período semanal." />
                        <HighlightCard title="Calorias líquidas" value={formatCalories(dashboard.data.calories.consumed - dashboard.data.calories.burned)} description={`Exercícios registrados: ${formatCalories(dashboard.data.calories.burned)}.`} />
                      </div>

                      <Card className="border-0 shadow-sm">
                        <CardHeader>
                          <CardTitle className="flex items-center gap-2">
                            <CalendarDays className="h-5 w-5 text-primary" />
                            Dias da semana
                          </CardTitle>
                          <CardDescription>Mesma leitura da tela Relatórios: dias dentro da meta, acima, abaixo e sem registro.</CardDescription>
                        </CardHeader>
                        <CardContent className="grid gap-4 xl:grid-cols-[1.2fr,0.8fr]">
                          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                            <StatusTile label="Dentro da meta" value={daysWithinGoal} />
                            <StatusTile label="Acima da meta" value={daysAboveGoal} />
                            <StatusTile label="Abaixo da meta" value={daysBelowGoal} />
                            <StatusTile label="Sem registro" value={daysWithoutRecords} />
                          </div>
                          <Card className="border bg-muted/10 shadow-none">
                            <CardHeader>
                              <CardTitle className="flex items-center gap-2">
                                <Scale className="h-5 w-5 text-primary" />
                                Evolução do peso
                              </CardTitle>
                            </CardHeader>
                            <CardContent>
                              {dashboard.data.weight.hasData ? (
                                <div className="grid gap-3 sm:grid-cols-3">
                                  <StatusTile label="Inicial" value={`${dashboard.data.weight.firstWeightKg ?? dashboard.data.weight.lastWeightKg ?? 0} kg`} />
                                  <StatusTile label="Atual" value={`${dashboard.data.weight.lastWeightKg ?? 0} kg`} />
                                  <StatusTile label="Variação" value={`${dashboard.data.weight.deltaKg ?? 0} kg`} />
                                </div>
                              ) : (
                                <div className="rounded-2xl border border-dashed bg-background/70 p-5 text-sm leading-6 text-muted-foreground">
                                  Ainda não há peso registrado para compor a leitura da semana.
                                </div>
                              )}
                            </CardContent>
                          </Card>
                        </CardContent>
                      </Card>

                      <div className="grid gap-6 xl:grid-cols-2">
                        <WaterAnalyticsCard
                          title="Hidratação na semana"
                          scopeLabel="Semanal"
                          description="A leitura usa aderência à meta, média diária e ponto mais fraco da semana."
                          totalConsumedMl={weeklyWaterTotal}
                          totalGoalMl={weeklyWaterGoalTotal}
                          goalHitDays={weeklyWaterGoalHitDays}
                          totalDays={weeklyReport.length}
                          averageDailyMl={averageValue(weeklyWaterTotal, weeklyReport.length)}
                          lowestDay={lowestWaterDay ? `${lowestWaterDay.label} · ${formatCountPtBr(Math.round(lowestWaterDay.waterConsumedMl ?? 0), " ml")}` : "-"}
                          reading={weeklyWaterGoalHitDays > 0 ? `${weeklyWaterGoalHitDays} de ${weeklyReport.length} dias bateram a meta de água.` : "Nenhum dia bateu a meta de água nesta semana ou os dados ainda não foram registrados."}
                        />

                        <ExerciseAnalyticsCard
                          title="Atividade física na semana"
                          scopeLabel="Semanal"
                          description="Mostra frequência, distribuição e concentração do gasto ao longo da semana."
                          activeDays={weeklyExerciseActiveDays}
                          totalDays={weeklyReport.length}
                          totalCalories={dashboard.data.calories.burned}
                          detailLabel="Distribuição"
                          detailValue={`${weeklyExerciseActiveDays}/${weeklyReport.length || 0} dias`}
                          averageCaloriesPerActiveDay={averageValue(dashboard.data.calories.burned, weeklyExerciseActiveDays)}
                          highestDay={highestExerciseDay ? `${highestExerciseDay.label} · ${formatCalories(highestExerciseDay.exerciseCalories ?? 0)}` : "Sem exercício"}
                          reading={weeklyExerciseActiveDays > 1 ? `Os exercícios ficaram distribuídos em ${weeklyExerciseActiveDays} dias da semana.` : weeklyExerciseActiveDays === 1 ? "Toda a atividade física registrada ficou concentrada em um único dia da semana." : "Nenhum exercício foi registrado nesta semana."}
                        />
                      </div>

                      <div className="grid gap-6 xl:grid-cols-[1.2fr,0.8fr]">
                        <Card className="border-0 shadow-sm">
                          <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                              <BarChart3 className="h-5 w-5 text-primary" />
                              Calorias consumidas em relação à meta
                            </CardTitle>
                            <CardDescription>Comparativo diário dentro da semana selecionada para a pessoa acompanhada.</CardDescription>
                          </CardHeader>
                          <CardContent className="h-[360px]">
                            {weeklyTrend.length ? (
                              <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={weeklyTrend} barSize={28}>
                                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                  <XAxis dataKey="label" />
                                  <YAxis />
                                  <Tooltip />
                                  <Legend />
                                  <Bar dataKey="goalCalories" name="Meta" fill="#cbd5e1" radius={[8, 8, 0, 0]} />
                                  <Bar dataKey="calories" name="Consumido" radius={[8, 8, 0, 0]}>
                                    {weeklyTrend.map(day => (
                                      <Cell key={day.date} fill={getCalorieBarColor(day.calories, day.goalCalories)} />
                                    ))}
                                  </Bar>
                                </BarChart>
                              </ResponsiveContainer>
                            ) : <Empty text="Ainda não há dados suficientes para montar o gráfico semanal." />}
                          </CardContent>
                        </Card>

                        <Card className="border-0 shadow-sm">
                          <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                              <Lightbulb className="h-5 w-5 text-primary" />
                              Qualidade e insights
                            </CardTitle>
                            <CardDescription>Leitura de qualidade alimentar e consistência para apoiar a avaliação profissional.</CardDescription>
                          </CardHeader>
                          <CardContent className="space-y-4">
                            <div className="grid gap-3 sm:grid-cols-2">
                              <StatusTile label="Proteína" value={formatGrams(weeklyQuality.proteinGrams)} />
                              <StatusTile label="Fibras" value={formatGrams(weeklyQuality.fiberGrams)} />
                              <StatusTile label="Água" value={formatCountPtBr(Math.round(weeklyQuality.waterMl), " ml")} />
                              <StatusTile label="Regularidade" value={`${Math.round(weeklyQuality.regularityScore)}%`} />
                            </div>
                            {reportInsights.length ? (
                              <div className="space-y-3">
                                {reportInsights.map(insight => (
                                  <div key={insight.title} className="rounded-2xl border bg-muted/10 p-4">
                                    <p className="text-sm font-semibold tracking-tight">{insight.title}</p>
                                    <p className="mt-2 text-sm leading-6 text-muted-foreground">{insight.description}</p>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="rounded-2xl border border-dashed bg-muted/10 p-6 text-sm leading-6 text-muted-foreground">
                                Ainda não há dados suficientes para gerar insights automáticos nesta semana.
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      </div>

                      <Card className="border-0 shadow-sm">
                        <CardHeader>
                          <CardTitle>Distribuição de macronutrientes</CardTitle>
                          <CardDescription>Evolução agregada de proteínas, carboidratos e gorduras ao longo da semana.</CardDescription>
                        </CardHeader>
                        <CardContent className="h-[320px]">
                          {weeklyTrend.length ? (
                            <ResponsiveContainer width="100%" height="100%">
                              <LineChart data={weeklyTrend}>
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
                          ) : <Empty text="Ainda não há dados suficientes para mostrar a distribuição de macronutrientes." />}
                        </CardContent>
                      </Card>

                      <Card className="border-0 shadow-sm">
                        <CardHeader>
                          <CardTitle className="flex items-center gap-2">
                            <UtensilsCrossed className="h-5 w-5 text-primary" />
                            Registros recentes
                          </CardTitle>
                          <CardDescription>Registros alimentares autorizados agrupados por dia. Abra apenas os dias que precisar investigar.</CardDescription>
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

function buildReportInsights({
  weeklyReport,
  weeklyAdherence,
  weeklyExerciseActiveDays,
  weeklyWaterGoalHitDays,
}: {
  weeklyReport: WeeklyReportDay[];
  weeklyAdherence: number;
  weeklyExerciseActiveDays: number;
  weeklyWaterGoalHitDays: number;
}): ReportInsight[] {
  if (!weeklyReport.length) {
    return [{ title: "Dados insuficientes", description: "Ainda não há registros suficientes para gerar uma leitura semanal consistente." }];
  }

  const registeredDays = weeklyReport.filter(day => day.calories > 0).length;
  const aboveGoalDays = weeklyReport.filter(day => day.goalCalories > 0 && day.calories > day.goalCalories).length;

  return [
    {
      title: "Aderência semanal",
      description: `A semana está com ${formatPercentPtBr(weeklyAdherence)}% de aderência e ${registeredDays} dias com registro alimentar.`,
    },
    {
      title: "Distribuição calórica",
      description: aboveGoalDays ? `${aboveGoalDays} dias ficaram acima da meta calórica, o que merece revisão de refeições e horários.` : "Nenhum dia registrado ficou acima da meta calórica semanal.",
    },
    {
      title: "Hábitos de apoio",
      description: `${weeklyWaterGoalHitDays} dias bateram a meta de água e ${weeklyExerciseActiveDays} dias tiveram atividade física registrada.`,
    },
  ];
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

function averageValue(total: number, count: number) {
  if (!count) return 0;
  return total / count;
}

function getCalorieBarColor(calories: number, goalCalories: number) {
  return goalCalories > 0 && calories > goalCalories ? "#dc2626" : "#10b981";
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
