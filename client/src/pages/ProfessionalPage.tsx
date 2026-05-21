import DashboardLayout from "@/components/DashboardLayout";
import PageIntro from "@/components/PageIntro";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatCalories, formatGrams, formatPercentPtBr } from "@/lib/numberFormat";
import { trpc } from "@/lib/trpc";
import { ClipboardList, Mail, MessageSquarePlus, ShieldCheck, UserCheck, UserPlus, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export default function ProfessionalPage() {
  const utils = trpc.useUtils();
  const profile = trpc.nutrition.professionals.profile.useQuery();
  const accesses = trpc.nutrition.professionals.myAccesses.useQuery();
  const history = trpc.nutrition.professionals.history.useQuery();
  const [displayName, setDisplayName] = useState("");
  const [registrationNumber, setRegistrationNumber] = useState("");
  const [patientEmail, setPatientEmail] = useState("");
  const [reason, setReason] = useState("Acompanhamento nutricional com consentimento do paciente.");
  const [selectedPatientId, setSelectedPatientId] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const dashboard = trpc.nutrition.professionals.patientDashboard.useQuery(
    { patientId: selectedPatientId ?? 0 },
    { enabled: Boolean(selectedPatientId) },
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

  const upsertProfile = trpc.nutrition.professionals.upsertProfile.useMutation({
    onSuccess: async () => {
      toast.success("Perfil profissional salvo.");
      await invalidate();
    },
    onError: error => toast.error(error.message || "Não foi possível salvar o perfil."),
  });

  const requestAccess = trpc.nutrition.professionals.requestAccess.useMutation({
    onSuccess: async () => {
      toast.success("Solicitação enviada. O paciente precisa aprovar antes do acesso.");
      setPatientEmail("");
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

  const approvedAccesses = accesses.data?.filter(access => access.status === "approved") ?? [];
  const awaitingApprovalCount = accesses.data?.filter(access => access.status === "pending").length ?? 0;
  const historyCount = history.data?.length ?? 0;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <PageIntro
          eyebrow="Profissional"
          title="Acompanhamento profissional"
          description="A tela ficou focada em perfil, solicitações enviadas, pacientes autorizados e acompanhamento ativo. As aprovações recebidas como paciente agora ficam centralizadas em Configurações."
          stats={
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <IntroStat label="Perfil" value={profile.data ? "Ativo" : "Pendente"} helper="dados do profissional" />
              <IntroStat label="Pacientes autorizados" value={String(approvedAccesses.length)} helper="com acesso aprovado" />
              <IntroStat label="Aguardando aprovação" value={String(awaitingApprovalCount)} helper="solicitações enviadas" />
              <IntroStat label="Eventos no histórico" value={String(historyCount)} helper="ações registradas" />
            </div>
          }
        />

        <div className="grid gap-4 xl:grid-cols-2">
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-primary" /> Perfil profissional</CardTitle>
              <CardDescription>Crie seu perfil antes de solicitar acesso a pacientes.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-2">
                  <Label>Nome profissional</Label>
                  <Input value={displayName || profile.data?.displayName || ""} onChange={event => setDisplayName(event.target.value)} />
                </label>
                <label className="space-y-2">
                  <Label>Registro</Label>
                  <Input value={registrationNumber || profile.data?.registrationNumber || ""} onChange={event => setRegistrationNumber(event.target.value)} />
                </label>
              </div>
              <Button
                className="rounded-full"
                onClick={() => upsertProfile.mutate({
                  displayName: displayName || profile.data?.displayName || "",
                  registrationNumber: registrationNumber || profile.data?.registrationNumber || undefined,
                })}
                disabled={upsertProfile.isPending}
              >
                Salvar perfil
              </Button>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><UserPlus className="h-5 w-5 text-primary" /> Solicitar acesso</CardTitle>
              <CardDescription>Informe o e-mail do paciente. O acesso só abre após aprovação.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <label className="space-y-2">
                <Label>E-mail do paciente</Label>
                <Input
                  type="email"
                  value={patientEmail}
                  onChange={event => setPatientEmail(event.target.value.trimStart())}
                  placeholder="paciente@exemplo.com"
                />
              </label>
              <label className="space-y-2">
                <Label>Motivo</Label>
                <Textarea value={reason} onChange={event => setReason(event.target.value)} className="min-h-24" />
              </label>
              <Button
                className="rounded-full"
                disabled={requestAccess.isPending || !patientEmail.trim()}
                onClick={() => requestAccess.mutate({ patientEmail: patientEmail.trim(), reason })}
              >
                <Mail className="mr-2 h-4 w-4" />
                Solicitar consentimento
              </Button>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 xl:grid-cols-[1fr,0.9fr]">
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><UserCheck className="h-5 w-5 text-primary" /> Pacientes autorizados</CardTitle>
              <CardDescription>Somente vínculos aprovados liberam o dashboard.</CardDescription>
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
                      <Button variant="outline" className="rounded-full" onClick={() => setSelectedPatientId(access.patientUserId)}>Abrir dashboard</Button>
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
              <CardTitle>Consentimento do paciente</CardTitle>
              <CardDescription>
                As solicitações recebidas como paciente foram movidas para Configurações, junto do vínculo do WhatsApp e dos demais ajustes pessoais.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <InfoStep title="1. Envie a solicitação" text="Use o e-mail do paciente para iniciar o pedido de compartilhamento com contexto claro." />
              <InfoStep title="2. O paciente decide em Configurações" text="A aprovação ou revogação agora fica na área pessoal do usuário para reduzir duplicidade entre telas." />
              <InfoStep title="3. Acompanhe após aprovação" text="Assim que o consentimento for aprovado, o dashboard do paciente já pode ser aberto por aqui." />
            </CardContent>
          </Card>
        </div>

        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><ClipboardList className="h-5 w-5 text-primary" /> Dashboard do paciente</CardTitle>
            <CardDescription>Dados agregados e registros recentes do paciente autorizado.</CardDescription>
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

function InfoStep({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-2xl border bg-background p-4">
      <p className="font-medium tracking-tight">{title}</p>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{text}</p>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-2xl border border-dashed bg-muted/20 p-6 text-sm leading-6 text-muted-foreground">{text}</div>;
}
