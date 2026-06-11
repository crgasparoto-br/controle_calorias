import DashboardLayout from "@/components/DashboardLayout";
import PageIntro from "@/components/PageIntro";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { formatCalories, formatGrams, formatPercentPtBr } from "@/lib/numberFormat";
import { trpc } from "@/lib/trpc";
import { ClipboardList, Mail, MessageSquarePlus, ShieldAlert, UserCheck, UserPlus, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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

const ACCESS_STATUS_LABELS: Record<string, string> = {
  pending: "Aguardando autorização",
  approved: "Autorizado",
  rejected: "Recusado",
  revoked: "Revogado",
};

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
  const history = trpc.nutrition.professionals.history.useQuery(undefined, { enabled: hasActiveProfile });
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
  const historyCount = history.data?.length ?? 0;
  const defaultNutritionGoal = dashboard.data?.nutritionGoal?.defaultGoal;
  const goalSuggestions = dashboard.data?.goalSuggestions ?? [];
  const mealSuggestions = dashboard.data?.mealSuggestions ?? [];
  const suggestedCalories = Number(goalSuggestion.calories);
  const suggestedProtein = Number(goalSuggestion.proteinGrams);
  const suggestedCarbs = Number(goalSuggestion.carbsGrams);
  const suggestedFat = Number(goalSuggestion.fatGrams);
  const selectedAccess = approvedAccesses.find(access => access.patientUserId === selectedPatientId) ?? null;
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
  const todayMeals = useMemo(() => {
    const todayKey = new Date().toLocaleDateString("pt-BR");
    return dashboard.data?.meals.filter(meal => new Date(meal.occurredAt).toLocaleDateString("pt-BR") === todayKey) ?? [];
  }, [dashboard.data?.meals]);

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
      utils.nutrition.professionals.history.invalidate(),
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
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <IntroStat label="Perfil" value={hasActiveProfile ? "Ativo" : "Carregando"} helper={profile.data?.displayName ?? "perfil profissional"} />
              <IntroStat label="Pessoas acompanhadas" value={String(approvedAccesses.length)} helper="com vínculo autorizado" />
              <IntroStat label="Aguardando autorização" value={String(pendingAccesses.length)} helper="solicitações enviadas" />
              <IntroStat label="Eventos no histórico" value={String(historyCount)} helper="ações registradas" />
            </div>
          }
        />

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
                  )) : <Empty text="Nenhuma pessoa autorizou acompanhamento ainda." />}
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

        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><ClipboardList className="h-5 w-5 text-primary" /> Análise por pessoa acompanhada</CardTitle>
            <CardDescription>Escolha uma pessoa autorizada para revisar métricas, registros, metas, sugestões e comentários.</CardDescription>
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

            {dashboard.isLoading ? <StatusMessage text="Carregando análise da pessoa selecionada..." /> : null}
            {dashboard.isError ? <ErrorMessage text="Não foi possível carregar a análise autorizada. Tente novamente em instantes." /> : null}

            {dashboard.data ? (
              <Tabs defaultValue="resumo" className="gap-4">
                <TabsList className="grid h-auto w-full grid-cols-1 gap-2 rounded-2xl bg-muted/60 p-2 md:grid-cols-7">
                  <TabsTrigger className="min-h-11 rounded-xl" value="resumo">Resumo</TabsTrigger>
                  <TabsTrigger className="min-h-11 rounded-xl" value="hoje">Hoje</TabsTrigger>
                  <TabsTrigger className="min-h-11 rounded-xl" value="relatorios">Relatórios</TabsTrigger>
                  <TabsTrigger className="min-h-11 rounded-xl" value="metas">Metas</TabsTrigger>
                  <TabsTrigger className="min-h-11 rounded-xl" value="sugestoes">Sugestões</TabsTrigger>
                  <TabsTrigger className="min-h-11 rounded-xl" value="ia">IA</TabsTrigger>
                  <TabsTrigger className="min-h-11 rounded-xl" value="comentarios">Comentários</TabsTrigger>
                </TabsList>

                <TabsContent value="resumo" className="space-y-4">
                  <div className="grid gap-3 md:grid-cols-4">
                    <Metric label="Aderência semanal" value={`${formatPercentPtBr(dashboard.data.weeklyAdherence)}%`} />
                    <Metric label="Calorias consumidas" value={formatCalories(dashboard.data.calories.consumed)} />
                    <Metric label="Proteínas" value={formatGrams(dashboard.data.macros.protein)} />
                    <Metric label="Variação de peso" value={`${dashboard.data.weight.deltaKg ?? 0} kg`} />
                  </div>
                  <div className="rounded-2xl border bg-muted/20 p-4 text-sm leading-6 text-muted-foreground">
                    Esta análise mostra dados autorizados da pessoa selecionada. Sua conta pessoal continua separada deste acompanhamento.
                  </div>
                </TabsContent>

                <TabsContent value="hoje" className="space-y-3">
                  <div className="grid gap-3 md:grid-cols-3">
                    <Metric label="Refeições hoje" value={String(todayMeals.length)} />
                    <Metric label="Calorias semanais" value={formatCalories(dashboard.data.calories.consumed)} />
                    <Metric label="Proteína semanal" value={formatGrams(dashboard.data.macros.protein)} />
                  </div>
                  <div className="space-y-2">
                    <p className="font-medium">Registros do dia</p>
                    {todayMeals.length ? todayMeals.map(meal => <MealRow key={meal.id} meal={meal} />) : <Empty text="Nenhuma refeição registrada hoje para esta pessoa." />}
                  </div>
                </TabsContent>

                <TabsContent value="relatorios" className="space-y-3">
                  <div className="grid gap-3 md:grid-cols-4">
                    <Metric label="Planejado na semana" value={formatCalories(dashboard.data.calories.planned)} />
                    <Metric label="Consumido na semana" value={formatCalories(dashboard.data.calories.consumed)} />
                    <Metric label="Gasto estimado" value={formatCalories(dashboard.data.calories.burned)} />
                    <Metric label="Peso" value={dashboard.data.weight.hasData ? `${dashboard.data.weight.lastWeightKg} kg` : "Sem dados"} />
                  </div>
                  <div className="space-y-2">
                    <p className="font-medium">Registros recentes</p>
                    {dashboard.data.meals.slice(0, 8).length ? dashboard.data.meals.slice(0, 8).map(meal => <MealRow key={meal.id} meal={meal} />) : <Empty text="Nenhum registro recente encontrado." />}
                  </div>
                </TabsContent>

                <TabsContent value="metas" className="space-y-4">
                  {defaultNutritionGoal ? (
                    <>
                      <div className="grid gap-3 md:grid-cols-5">
                        <Metric label="Meta calórica" value={formatCalories(defaultNutritionGoal.calories)} />
                        <Metric label="Meta proteína" value={formatGrams(defaultNutritionGoal.proteinGrams)} />
                        <Metric label="Meta carboidratos" value={formatGrams(defaultNutritionGoal.carbsGrams)} />
                        <Metric label="Meta gorduras" value={formatGrams(defaultNutritionGoal.fatGrams)} />
                        <Metric label="Exceções" value={String(dashboard.data.nutritionGoal.exceptions.length)} />
                      </div>
                      <div className="rounded-2xl border bg-muted/20 p-4 text-sm leading-6 text-muted-foreground">
                        A sugestão fica registrada para avaliação posterior. A meta ativa da pessoa acompanhada não muda automaticamente.
                      </div>
                    </>
                  ) : <Empty text="Nenhuma meta nutricional encontrada para esta pessoa." />}

                  <SuggestionBox title="Sugerir ajuste de meta" description="Os campos começam com a meta atual para facilitar pequenos ajustes.">
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
                      onClick={() => selectedPatientId && dashboard.data?.nutritionGoal && suggestGoal.mutate({
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
                          exceptions: dashboard.data.nutritionGoal.exceptions,
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

        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle>Histórico de alterações</CardTitle>
            <CardDescription>Registro de perfil, solicitações, autorizações, revogações, sugestões e comentários.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            {history.data?.slice(-10).reverse().map(event => (
              <div key={event.id} className="rounded-xl border bg-background px-3 py-2 text-sm">
                {event.eventType} · pessoa #{event.patientUserId} · profissional #{event.professionalUserId}
              </div>
            )) ?? <Empty text="Sem histórico ainda." />}
          </CardContent>
        </Card>
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

function MealRow({ meal }: { meal: { id: number; mealLabel: string; occurredAt: string | number | Date; totals: { calories: number } } }) {
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

function SuggestionBox({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
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

function ListSection({ title, children }: { title: string; children: React.ReactNode }) {
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

function StatusMessage({ text }: { text: string }) {
  return <div className="rounded-2xl border bg-muted/20 p-6 text-sm text-muted-foreground" role="status" aria-live="polite">{text}</div>;
}

function ErrorMessage({ text }: { text: string }) {
  return <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-6 text-sm text-destructive">{text}</div>;
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-2xl border border-dashed bg-muted/20 p-6 text-sm leading-6 text-muted-foreground">{text}</div>;
}
