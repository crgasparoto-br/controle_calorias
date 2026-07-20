import { useAuth } from "@/_core/hooks/useAuth";
import ProfessionalLayout from "@/components/ProfessionalLayout";
import PageIntro from "@/components/PageIntro";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import {
  AlertTriangle,
  BadgeCheck,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import React, { useEffect, useState } from "react";
import { useLocation } from "wouter";

type SummaryFrequency = "disabled" | "weekly" | "biweekly" | "monthly";
type MessageType =
  | "guidance"
  | "reminder"
  | "weigh_in_request"
  | "record_request"
  | "administrative"
  | "follow_up_summary";
type TemplateDraft = {
  id?: string;
  title: string;
  messageType: MessageType;
  content: string;
};

const messageTypeLabels: Record<MessageType, string> = {
  guidance: "Orientação",
  reminder: "Lembrete",
  weigh_in_request: "Solicitação de pesagem",
  record_request: "Solicitação de registro",
  administrative: "Administrativa",
  follow_up_summary: "Resumo de acompanhamento",
};

const frequencyLabels: Record<SummaryFrequency, string> = {
  disabled: "Sem resumo automático",
  weekly: "Semanal",
  biweekly: "Quinzenal",
  monthly: "Mensal",
};

function SettingsContent() {
  const [, setLocation] = useLocation();
  const { refresh: refreshAuth } = useAuth();
  const utils = trpc.useUtils();
  const query = trpc.professionalRecord.settings.get.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });

  const [displayName, setDisplayName] = useState("");
  const [registrationNumber, setRegistrationNumber] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [patientFacingBio, setPatientFacingBio] = useState("");
  const [defaultReviewIntervalDays, setDefaultReviewIntervalDays] =
    useState("");
  const [remindersEnabled, setRemindersEnabled] = useState(true);
  const [defaultReminderLeadDays, setDefaultReminderLeadDays] = useState("1");
  const [summaryFrequency, setSummaryFrequency] =
    useState<SummaryFrequency>("disabled");
  const [messageTemplates, setMessageTemplates] = useState<TemplateDraft[]>([]);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!query.data) return;
    setDisplayName(query.data.profile?.displayName ?? "");
    setRegistrationNumber(query.data.profile?.registrationNumber ?? "");
    setContactEmail(query.data.identity.contactEmail ?? "");
    setContactPhone(query.data.identity.contactPhone ?? "");
    setPatientFacingBio(query.data.identity.patientFacingBio ?? "");
    setDefaultReviewIntervalDays(
      query.data.preferences.defaultReviewIntervalDays?.toString() ?? ""
    );
    setRemindersEnabled(query.data.preferences.remindersEnabled);
    setDefaultReminderLeadDays(
      String(query.data.preferences.defaultReminderLeadDays)
    );
    setSummaryFrequency(query.data.preferences.summaryFrequency);
    setMessageTemplates(query.data.preferences.messageTemplates);
  }, [query.data]);

  const invalidate = async () => {
    await Promise.all([
      utils.professionalRecord.settings.get.invalidate(),
      utils.professionalRecord.settings.entitlements.invalidate(),
      utils.nutrition.professionals.profile.invalidate(),
    ]);
  };

  const updateIdentity =
    trpc.professionalRecord.settings.updateIdentity.useMutation({
      onSuccess: async () => {
        setSuccessMessage("Identificação profissional atualizada.");
        await invalidate();
        await refreshAuth();
      },
    });
  const updatePreferences =
    trpc.professionalRecord.settings.updatePreferences.useMutation({
      onSuccess: async () => {
        setSuccessMessage("Preferências profissionais atualizadas.");
        await invalidate();
      },
    });
  const setActive = trpc.professionalRecord.settings.setActive.useMutation({
    onSuccess: async result => {
      await invalidate();
      await refreshAuth();
      if (!result.active) setLocation("/settings");
    },
  });

  if (query.isLoading) {
    return (
      <div
        role="status"
        className="mx-auto max-w-5xl rounded-2xl border bg-card p-8 text-sm text-muted-foreground"
      >
        Carregando configurações profissionais...
      </div>
    );
  }

  if (query.isError || !query.data) {
    return (
      <Card className="mx-auto max-w-xl">
        <CardContent className="space-y-4 py-8 text-center">
          <AlertTriangle className="mx-auto h-9 w-9 text-destructive" />
          <div>
            <h1 className="font-semibold">
              Não foi possível carregar as configurações
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Nenhuma alteração foi realizada. Tente novamente.
            </p>
          </div>
          <Button variant="outline" onClick={() => void query.refetch()}>
            <RefreshCw className="h-4 w-4" />
            Tentar novamente
          </Button>
        </CardContent>
      </Card>
    );
  }

  const entitlements = query.data.entitlements;
  const mutationError =
    updateIdentity.error?.message ??
    updatePreferences.error?.message ??
    setActive.error?.message ??
    null;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageIntro
        title="Configurações profissionais"
        description="Gerencie sua identificação, preferências operacionais e veja quais recursos estão disponíveis no seu acesso profissional."
      />

      {successMessage ? (
        <div
          role="status"
          className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm"
        >
          {successMessage}
        </div>
      ) : null}
      {mutationError ? (
        <div
          role="alert"
          className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive"
        >
          {mutationError}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Identificação exibida ao paciente</CardTitle>
          <CardDescription>
            Somente os dados abaixo podem ser apresentados às pessoas que
            autorizaram seu acompanhamento. Preferências internas e modelos de
            mensagem permanecem privados.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Nome profissional</span>
              <Input
                value={displayName}
                onChange={event => setDisplayName(event.target.value)}
                maxLength={120}
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Registro profissional</span>
              <Input
                value={registrationNumber}
                onChange={event => setRegistrationNumber(event.target.value)}
                maxLength={80}
                placeholder="Ex.: CRN 00000"
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-medium">E-mail profissional</span>
              <Input
                type="email"
                value={contactEmail}
                onChange={event => setContactEmail(event.target.value)}
                maxLength={320}
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Telefone profissional</span>
              <Input
                value={contactPhone}
                onChange={event => setContactPhone(event.target.value)}
                maxLength={30}
              />
            </label>
          </div>
          <label className="grid gap-1 text-sm">
            <span className="font-medium">Apresentação para o paciente</span>
            <textarea
              className="min-h-28 rounded-md border bg-background p-3"
              value={patientFacingBio}
              onChange={event => setPatientFacingBio(event.target.value)}
              maxLength={1000}
            />
          </label>
          <Button
            className="w-fit"
            disabled={
              updateIdentity.isPending || displayName.trim().length < 2
            }
            onClick={() => {
              setSuccessMessage(null);
              updateIdentity.mutate({
                displayName,
                registrationNumber,
                contactEmail,
                contactPhone,
                patientFacingBio,
              });
            }}
          >
            <Save className="h-4 w-4" />
            {updateIdentity.isPending
              ? "Salvando identificação..."
              : "Salvar identificação"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Preferências operacionais</CardTitle>
          <CardDescription>
            Estes valores servem como padrão para novos acompanhamentos. Eles
            não alteram registros clínicos já existentes.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          <div className="grid gap-4 md:grid-cols-3">
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Revisão padrão (dias)</span>
              <Input
                type="number"
                min={1}
                max={365}
                value={defaultReviewIntervalDays}
                onChange={event =>
                  setDefaultReviewIntervalDays(event.target.value)
                }
                placeholder="Sem padrão"
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Antecedência do lembrete</span>
              <Input
                type="number"
                min={0}
                max={30}
                disabled={!remindersEnabled}
                value={defaultReminderLeadDays}
                onChange={event =>
                  setDefaultReminderLeadDays(event.target.value)
                }
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Frequência de resumo</span>
              <select
                className="h-10 rounded-md border bg-background px-3 text-sm"
                value={summaryFrequency}
                onChange={event =>
                  setSummaryFrequency(event.target.value as SummaryFrequency)
                }
              >
                {Object.entries(frequencyLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="flex items-center gap-3 rounded-xl border p-4 text-sm">
            <input
              type="checkbox"
              checked={remindersEnabled}
              onChange={event => setRemindersEnabled(event.target.checked)}
            />
            <span>
              <strong className="block">Habilitar lembretes operacionais</strong>
              <span className="text-muted-foreground">
                Nenhuma mensagem será enviada sem o fluxo explícito de envio.
              </span>
            </span>
          </label>

          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-semibold">Modelos de mensagem</h3>
                <p className="text-sm text-muted-foreground">
                  Os modelos apenas preenchem um rascunho e nunca são enviados
                  automaticamente.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                disabled={messageTemplates.length >= 20}
                onClick={() =>
                  setMessageTemplates(current => [
                    ...current,
                    {
                      title: "",
                      messageType: "reminder",
                      content: "",
                    },
                  ])
                }
              >
                Adicionar modelo
              </Button>
            </div>
            {messageTemplates.length === 0 ? (
              <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
                Nenhum modelo cadastrado.
              </p>
            ) : (
              <div className="grid gap-3">
                {messageTemplates.map((template, index) => (
                  <div
                    key={template.id ?? `new-${index}`}
                    className="grid gap-3 rounded-xl border p-4"
                  >
                    <div className="grid gap-3 md:grid-cols-[1fr_240px_auto]">
                      <Input
                        aria-label={`Título do modelo ${index + 1}`}
                        placeholder="Título do modelo"
                        value={template.title}
                        onChange={event =>
                          setMessageTemplates(current =>
                            current.map((item, itemIndex) =>
                              itemIndex === index
                                ? { ...item, title: event.target.value }
                                : item
                            )
                          )
                        }
                      />
                      <select
                        aria-label={`Tipo do modelo ${index + 1}`}
                        className="h-10 rounded-md border bg-background px-3 text-sm"
                        value={template.messageType}
                        onChange={event =>
                          setMessageTemplates(current =>
                            current.map((item, itemIndex) =>
                              itemIndex === index
                                ? {
                                    ...item,
                                    messageType: event.target
                                      .value as MessageType,
                                  }
                                : item
                            )
                          )
                        }
                      >
                        {Object.entries(messageTypeLabels).map(
                          ([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          )
                        )}
                      </select>
                      <Button
                        type="button"
                        variant="ghost"
                        aria-label={`Remover modelo ${index + 1}`}
                        onClick={() =>
                          setMessageTemplates(current =>
                            current.filter((_, itemIndex) => itemIndex !== index)
                          )
                        }
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    <textarea
                      aria-label={`Conteúdo do modelo ${index + 1}`}
                      className="min-h-24 rounded-md border bg-background p-3 text-sm"
                      placeholder="Conteúdo do rascunho"
                      value={template.content}
                      onChange={event =>
                        setMessageTemplates(current =>
                          current.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, content: event.target.value }
                              : item
                          )
                        )
                      }
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          <Button
            className="w-fit"
            disabled={
              updatePreferences.isPending ||
              messageTemplates.some(
                template => !template.title.trim() || !template.content.trim()
              )
            }
            onClick={() => {
              setSuccessMessage(null);
              updatePreferences.mutate({
                defaultReviewIntervalDays: defaultReviewIntervalDays
                  ? Number(defaultReviewIntervalDays)
                  : null,
                remindersEnabled,
                defaultReminderLeadDays: Number(defaultReminderLeadDays),
                summaryFrequency,
                messageTemplates,
              });
            }}
          >
            <Save className="h-4 w-4" />
            {updatePreferences.isPending
              ? "Salvando preferências..."
              : "Salvar preferências"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Critérios da central de alertas</CardTitle>
          <CardDescription>
            A tela mostra apenas critérios realmente suportados pelo avaliador
            central. Regras ainda fixas não podem ser alteradas localmente.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {query.data.operationalAlertCriteria.map(criterion => (
            <div key={criterion.key} className="rounded-xl border p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="font-medium">{criterion.label}</p>
                <span className="rounded-full bg-muted px-3 py-1 text-xs">
                  {criterion.configurable
                    ? "Configurável"
                    : `Regra atual: ${criterion.value} dias`}
                </span>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                {criterion.description}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Acesso comercial e recursos</CardTitle>
          <CardDescription>
            O backend é a fonte do plano, capacidade e recursos. A interface não
            calcula preços, limites nem elegibilidade.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border p-4">
              <p className="text-xs text-muted-foreground">Situação</p>
              <p className="mt-1 font-semibold">{entitlements.planName}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {entitlements.mode === "open_access"
                  ? "Modo aberto de transição"
                  : entitlements.commercialState}
              </p>
            </div>
            <div className="rounded-xl border p-4">
              <p className="text-xs text-muted-foreground">Capacidade</p>
              <p className="mt-1 font-semibold">
                {entitlements.capacity.limit === null
                  ? "Sem limite comercial configurado"
                  : `${entitlements.capacity.used ?? 0} de ${entitlements.capacity.limit}`}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {entitlements.capacity.usageAvailable
                  ? `${entitlements.capacity.used ?? 0} acompanhamentos ativos`
                  : "Uso temporariamente indisponível"}
              </p>
            </div>
            <div className="rounded-xl border p-4">
              <p className="text-xs text-muted-foreground">Avaliação</p>
              <div className="mt-1 flex items-center gap-2 font-semibold">
                {entitlements.allowed ? (
                  <BadgeCheck className="h-4 w-4" />
                ) : (
                  <AlertTriangle className="h-4 w-4" />
                )}
                {entitlements.allowed ? "Recursos liberados" : "Acesso bloqueado"}
              </div>
              {entitlements.fallbackUsed ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  Provider indisponível; fallback do modo aberto aplicado.
                </p>
              ) : null}
            </div>
          </div>
          <div>
            <p className="mb-2 text-sm font-medium">Recursos habilitados</p>
            <div className="flex flex-wrap gap-2">
              {entitlements.enabledResources.map(resource => (
                <span
                  key={resource}
                  className="inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs"
                >
                  <ShieldCheck className="h-3.5 w-3.5" />
                  {resource.replace(/^professional_/, "").replaceAll("_", " ")}
                </span>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle>Disponibilidade da Área Profissional</CardTitle>
          <CardDescription>
            Ao desativar, a navegação e as APIs profissionais ficam bloqueadas.
            Vínculos, prontuários, mensagens e histórico são preservados.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="destructive"
            disabled={setActive.isPending || !query.data.profile?.active}
            onClick={() => {
              const confirmed = window.confirm(
                "Desativar a Área Profissional? O histórico será preservado, mas novos acessos ficarão bloqueados até a reativação."
              );
              if (confirmed) setActive.mutate({ active: false });
            }}
          >
            {setActive.isPending
              ? "Desativando..."
              : "Desativar Área Profissional"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export default function ProfessionalSettingsPage() {
  return (
    <ProfessionalLayout>
      <SettingsContent />
    </ProfessionalLayout>
  );
}
