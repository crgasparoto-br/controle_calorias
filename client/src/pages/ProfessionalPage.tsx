import DashboardLayout from "@/components/DashboardLayout";
import PageIntro from "@/components/PageIntro";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatCalories, formatGrams, formatPercentPtBr } from "@/lib/numberFormat";
import { trpc } from "@/lib/trpc";
import { ClipboardList, Mail, MessageSquarePlus, ShieldAlert, UserCheck, UserPlus, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";

export default function ProfessionalPage() {
  const utils = trpc.useUtils();
  const [, setLocation] = useLocation();
  const profile = trpc.nutrition.professionals.profile.useQuery(undefined, { retry: false });
  const hasActiveProfile = Boolean(profile.data?.active);
  const accesses = trpc.nutrition.professionals.myAccesses.useQuery(undefined, { enabled: hasActiveProfile });
  const history = trpc.nutrition.professionals.history.useQuery(undefined, { enabled: hasActiveProfile });
  const [patientContact, setPatientContact] = useState("");
  const [reason, setReason] = useState("Acompanhamento nutricional com consentimento do paciente.");
  const [selectedPatientId, setSelectedPatientId] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const dashboard = trpc.nutrition.professionals.patientDashboard.useQuery(
    { patientId: selectedPatientId ?? 0 },
    { enabled: hasActiveProfile && Boolean(selectedPatientId) },
  );

  const invalidate = async () => {
    await Promise.all([
      utils.nutrition.professionals.profile.invalidate(),
      utils.nutrition.professionals.myAccesses.invalidate(),
      utils.nutrition.professionals.patientRequests.invalidate(),
      utils.nutrition.professionals.history.invalidate(),
    ]);
    if (selectedPatientId) await utils.nutrition.professionals.patientDashboard.invalidate({ patientId: selectedPatientId });
  };

  const requestAccess = trpc.nutrition.professionals.requestAccess.useMutation({
    onSuccess: async () => {
      toast.success("Solicitação enviada. O paciente precisa aprovar antes do acesso.");
      setPatientContact("");
      await invalidate();
    },
    onError: error => toast.error(error.message || "Não foi possível solicitar acesso."),
  });

  const revokeAccess = trpc.nutrition.professionals.revokeAccess.useMutation({
    onSuccess: async () => {
      toast.success("Acesso revogado.");
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
                A área Nutricionista é uma camada adicional da sua conta pessoal. Ative o perfil profissional em Configurações para liberar pacientes, solicitações e acompanhamento.
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

  const approvedAccesses = accesses.data?.filter(access => access.status === "approved") ?? [];
  const awaitingApprovalCount = accesses.data?.filter(access => access.status === "pending").length ?? 0;
  const historyCount = history.data?.length ?? 0;
  const defaultNutritionGoal = dashboard.data?.nutritionGoal?.defaultGoal;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <PageIntro
          eyebrow="Nutricionista"
          title="Acompanhamento profissional"
          description="A área profissional fica separada do uso pessoal: você continua registrando suas refeições normalmente e acessa pacientes apenas quando há vínculo autorizado."
          stats={
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <IntroStat label="Perfil" value="Ativo" helper={profile.data?.displayName ?? "nutricionista"} />
              <IntroStat label="Pacientes autorizados" value={String(approvedAccesses.length)} helper="com acesso aprovado" />
              <IntroStat label="Aguardando aprovação" value={String(awaitingApprovalCount)} helper="solicitações enviadas" />
              <IntroStat label="Eventos no histórico" value={String(historyCount)} helper="ações registradas" />
            </div>
          }
        />

        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><UserPlus className="h-5 w-5 text-primary" /> Solicitar acesso</CardTitle>
            <CardDescription>Informe o e-mail ou celular vinculado ao paciente. O acesso só abre após aprovação.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 lg:grid-cols-[1fr_1.4fr_auto] lg:items-end">
            <label className="space-y-2">
              <Label>E-mail ou celular do paciente</Label>
              <Input
                value={patientContact}
                onChange={event => setPatientContact(event.target.value.trimStart())}
                placeholder="paciente@exemplo.com ou (11) 99999-9999"
              />
            </label>
            <label className="space-y-2">
              <Label>Motivo</Label>
              <Textarea value={reason} onChange={event => setReason(event.target.value)} className="min-h-11 lg:min-h-11" />
            </label>
            <Button
              className="h-11 rounded-full"
              disabled={requestAccess.isPending || !patientContact.trim()}
              onClick={() => requestAccess.mutate({ patientContact: patientContact.trim(), reason })}
            >
              <Mail className="mr-2 h-4 w-4" />
              Solicitar
            </Button>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><UserCheck className="h-5 w-5 text-primary" /> Pacientes autorizados</CardTitle>
            <CardDescription>Somente vínculos aprovados liberam dados de Hoje, Relatórios, metas e registros recentes.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {approvedAccesses.length ? approvedAccesses.map(access => (
              <div key={access.id} className="rounded-2xl border bg-background p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">{access.patient?.name || access.patient?.email || `Paciente #${access.patientUserId}`}</p>
                    <p className="text-xs text-muted-foreground">
                      {access.patient?.email || `ID interno #${access.patientUserId}`}
                    </p>
                    <p className="text-xs text-muted-foreground">Aprovado em {access.approvedAt ? new Date(access.approvedAt).toLocaleString("pt-BR") : "-"}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" className="rounded-full" onClick={() => setSelectedPatientId(access.patientUserId)}>Abrir acompanhamento</Button>
                    <Button variant="outline" className="rounded-full" onClick={() => revokeAccess.mutate({ accessId: access.id })}>
                      <X className="mr-2 h-4 w-4" />
                      Revogar vínculo
                    </Button>
                  </div>
                </div>
              </div>
            )) : (
              <Empty text="Nenhum paciente autorizado ainda." />
            )}
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><ClipboardList className="h-5 w-5 text-primary" /> Acompanhamento do paciente</CardTitle>
            <CardDescription>Dados agregados equivalentes às telas Hoje e Relatórios, incluindo metas nutricionais autorizadas.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {dashboard.data ? (
              <>
                <div className="rounded-2xl border bg-muted/20 p-4 text-sm leading-6 text-muted-foreground">
                  <p className="font-medium text-foreground">Paciente selecionado</p>
                  <p>{dashboard.data.patient?.name || dashboard.data.patient?.email || `Paciente #${dashboard.data.patientId}`}</p>
                  <p>{dashboard.data.patient?.email || `ID interno #${dashboard.data.patientId}`}</p>
                </div>
                <div className="grid gap-3 md:grid-cols-4">
                  <Metric label="Aderência semanal" value={`${formatPercentPtBr(dashboard.data.weeklyAdherence)}%`} />
                  <Metric label="Calorias consumidas" value={formatCalories(dashboard.data.calories.consumed)} />
                  <Metric label="Proteínas" value={formatGrams(dashboard.data.macros.protein)} />
                  <Metric label="Variação de peso" value={`${dashboard.data.weight.deltaKg ?? 0} kg`} />
                </div>
                {defaultNutritionGoal ? (
                  <div className="grid gap-3 md:grid-cols-4">
                    <Metric label="Meta calórica" value={formatCalories(defaultNutritionGoal.calories)} />
                    <Metric label="Meta proteína" value={formatGrams(defaultNutritionGoal.proteinGrams)} />
                    <Metric label="Meta carboidratos" value={formatGrams(defaultNutritionGoal.carbsGrams)} />
                    <Metric label="Meta gorduras" value={formatGrams(defaultNutritionGoal.fatGrams)} />
                  </div>
                ) : null}
                <div className="grid gap-4 xl:grid-cols-2">
                  <div className="space-y-2">
                    <p className="font-medium">Refeições registradas</p>
                    {dashboard.data.meals.slice(0, 6).map(meal => (
                      <div key={meal.id} className="rounded-xl border bg-background p-3 text-sm">
                        <div className="flex justify-between gap-3">
                          <span className="font-medium">{meal.mealLabel}</span>
                          <span>{formatCalories(meal.totals.calories)}</span>
                        </div>
                        <p className="text-xs text-muted-foreground">{new Date(meal.occurredAt).toLocaleString("pt-BR")}</p>
                      </div>
                    ))}
                  </div>
                  <div className="space-y-3">
                    <p className="font-medium">Comentários profissionais</p>
                    <Textarea value={comment} onChange={event => setComment(event.target.value)} placeholder="Adicionar comentário de acompanhamento" />
                    <Button
                      className="rounded-full"
                      disabled={!selectedPatientId || !comment.trim()}
                      onClick={() => selectedPatientId && addComment.mutate({ patientId: selectedPatientId, comment })}
                    >
                      <MessageSquarePlus className="mr-2 h-4 w-4" /> Comentar
                    </Button>
                    {dashboard.data.comments.map(item => (
                      <div key={item.id} className="rounded-xl border bg-muted/20 p-3 text-sm">{item.comment}</div>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <Empty text="Selecione um paciente autorizado para visualizar o acompanhamento." />
            )}
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle>Histórico de alterações</CardTitle>
            <CardDescription>Registro de perfil, solicitações, aprovações, revogações e comentários.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            {history.data?.slice(-10).reverse().map(event => (
              <div key={event.id} className="rounded-xl border bg-background px-3 py-2 text-sm">
                {event.eventType} · paciente #{event.patientUserId} · profissional #{event.professionalUserId}
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

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-background p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 text-xl font-semibold tracking-tight">{value}</p>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-2xl border border-dashed bg-muted/20 p-6 text-sm leading-6 text-muted-foreground">{text}</div>;
}
