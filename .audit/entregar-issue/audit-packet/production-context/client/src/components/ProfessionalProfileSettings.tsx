import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  Power,
  Save,
  Stethoscope,
  UserCheck,
  X,
} from "lucide-react";
import React, { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import {
  professionalLabel,
  ProfessionalAsyncState,
  ProfessionalLoadingState,
  ProfessionalStatusBadge,
} from "@/components/professional/ProfessionalUi";

type ProfessionalFormState = {
  displayName: string;
  registrationNumber: string;
  active: boolean;
};

type PatientAccessRequestsCardProps = {
  embedded?: boolean;
};

const initialForm: ProfessionalFormState = {
  displayName: "",
  registrationNumber: "",
  active: false,
};

const PATIENT_ACCESS_PERMISSIONS = [
  "Resumo alimentar e painel diário",
  "Histórico de refeições e relatórios",
  "Metas nutricionais autorizadas",
  "Comentários e sugestões profissionais",
] as const;

function formatAuthorizationMessageStatus(status: string | null | undefined) {
  return status
    ? professionalLabel("authorizationMessage", status)
    : "Notificação não concluída";
}

function getAuthorizationMessageStatusClass(status: string | null | undefined) {
  if (status === "failed")
    return "border-destructive/30 bg-destructive/10 text-destructive";
  if (status === "skipped")
    return "border-amber-200 bg-amber-50 text-amber-800";
  if (status === "sent")
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  return "border-muted bg-muted/20 text-muted-foreground";
}

function permissionsTitle(status: string) {
  if (status === "approved") return "Permissões concedidas";
  if (status === "revoked") return "Permissões revogadas";
  if (status === "rejected") return "Permissões recusadas";
  return "Permissões solicitadas";
}

export default function ProfessionalProfileSettings() {
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();
  const { refresh: refreshAuth, user } = useAuth();
  const profile = trpc.nutrition.professionals.profile.useQuery(undefined, {
    retry: false,
  });
  const entitlements = trpc.professionalRecord.settings.entitlements.useQuery(
    undefined,
    {
      enabled: Boolean(profile.data?.active),
      retry: false,
    }
  );
  const [appliedSavedProfile, setAppliedSavedProfile] = useState(false);
  const [form, setForm] = useState<ProfessionalFormState>(initialForm);
  const suggestedProfessionalName = user?.name?.trim() ?? "";

  useEffect(() => {
    if (appliedSavedProfile || !profile.isSuccess) return;

    const confirmedActive = Boolean(profile.data?.active);
    utils.auth.me.setData(undefined, currentUser => {
      const confirmedUser = currentUser ?? user;
      if (!confirmedUser) return currentUser;
      if (confirmedUser.professionalProfileActive === confirmedActive) {
        return confirmedUser;
      }
      return {
        ...confirmedUser,
        professionalProfileActive: confirmedActive,
      };
    });
    setForm({
      displayName: profile.data?.displayName ?? suggestedProfessionalName,
      registrationNumber: profile.data?.registrationNumber ?? "",
      active: confirmedActive,
    });
    setAppliedSavedProfile(true);
  }, [
    appliedSavedProfile,
    profile.data,
    profile.isSuccess,
    suggestedProfessionalName,
  ]);

  const invalidateProfessionalSettings = async () => {
    await Promise.all([
      utils.auth.me.invalidate(),
      utils.nutrition.professionals.profile.invalidate(),
      utils.nutrition.professionals.myAccesses.invalidate(),
      utils.nutrition.professionals.patientRequests.invalidate(),
      utils.nutrition.professionals.history.invalidate(),
      utils.professionalRecord.settings.get.invalidate(),
      utils.professionalRecord.settings.entitlements.invalidate(),
    ]);
  };

  const clearProfessionalData = async () => {
    await Promise.allSettled([
      utils.professionalRecord.get.cancel(),
      utils.professionalRecord.messages.list.cancel(),
      utils.professionalRecord.operationalAlerts.list.cancel(),
      utils.professionalRecord.ai.priorities.cancel(),
    ]);
    await Promise.allSettled([
      utils.professionalRecord.get.reset(),
      utils.professionalRecord.messages.list.reset(),
      utils.professionalRecord.operationalAlerts.list.reset(),
      utils.professionalRecord.ai.priorities.reset(),
      utils.nutrition.professionals.patientDashboard.reset(),
      utils.nutrition.professionals.patientPeriodBundle.reset(),
      utils.nutrition.professionals.patientTimeZone.reset(),
    ]);
  };

  const applyConfirmedProfile = (savedProfile: {
    userId: number;
    displayName: string;
    registrationNumber?: string;
    active: boolean;
    createdAt: number;
    updatedAt: number;
  }) => {
    const confirmedProfile = {
      ...savedProfile,
      registrationNumber: savedProfile.registrationNumber,
    };
    utils.nutrition.professionals.profile.setData(undefined, confirmedProfile);
    utils.auth.me.setData(undefined, currentUser => {
      const confirmedUser = currentUser ?? user;
      return confirmedUser
        ? {
            ...confirmedUser,
            professionalProfileActive: Boolean(savedProfile.active),
          }
        : currentUser;
    });
    setForm({
      displayName: savedProfile.displayName ?? suggestedProfessionalName,
      registrationNumber: savedProfile.registrationNumber ?? "",
      active: Boolean(savedProfile.active),
    });
    setAppliedSavedProfile(true);
  };

  const applyConfirmedActive = (active: boolean) => {
    utils.nutrition.professionals.profile.setData(undefined, currentProfile =>
      currentProfile ? { ...currentProfile, active } : currentProfile
    );
    utils.professionalRecord.settings.get.setData(undefined, currentSettings =>
      currentSettings
        ? {
            ...currentSettings,
            profile: currentSettings.profile
              ? { ...currentSettings.profile, active }
              : currentSettings.profile,
          }
        : currentSettings
    );
    utils.auth.me.setData(undefined, currentUser => {
      const confirmedUser = currentUser ?? user;
      return confirmedUser
        ? { ...confirmedUser, professionalProfileActive: active }
        : currentUser;
    });
    setForm(current => ({ ...current, active }));
    setAppliedSavedProfile(true);
  };

  const setActive = trpc.professionalRecord.settings.setActive.useMutation({
    onSuccess: async result => {
      applyConfirmedActive(result.active);
      await Promise.allSettled([
        result.active ? Promise.resolve() : clearProfessionalData(),
        invalidateProfessionalSettings(),
        refreshAuth(),
      ]);
      toast.success(
        result.active
          ? "Área Profissional ativada."
          : "Área Profissional desativada."
      );
    },
    onError: error =>
      toast.error(
        error.message || "Não foi possível alterar a Área Profissional."
      ),
  });

  const upsertProfile = trpc.nutrition.professionals.upsertProfile.useMutation({
    onSuccess: async savedProfile => {
      applyConfirmedProfile(savedProfile);
      await Promise.allSettled([
        invalidateProfessionalSettings(),
        refreshAuth(),
      ]);
      toast.success("Perfil profissional salvo.");
    },
    onError: async error => {
      setAppliedSavedProfile(false);
      await Promise.allSettled([
        invalidateProfessionalSettings(),
        refreshAuth(),
      ]);
      try {
        const refreshedProfile = await profile.refetch();
        if (refreshedProfile.data !== undefined) {
          setForm({
            displayName:
              refreshedProfile.data?.displayName ?? suggestedProfessionalName,
            registrationNumber:
              refreshedProfile.data?.registrationNumber ?? "",
            active: Boolean(refreshedProfile.data?.active),
          });
          setAppliedSavedProfile(true);
        }
      } catch {
        // Mantém o formulário elegível para aplicar o próximo refetch bem-sucedido.
      }
      toast.error(
        error.message || "Não foi possível salvar o perfil profissional."
      );
    },
  });

  const validationMessage = (() => {
    if (!form.active) return null;
    if (form.displayName.trim().length < 2)
      return "Informe o nome profissional antes de ativar o perfil.";
    return null;
  })();

  function updateField<K extends keyof ProfessionalFormState>(
    field: K,
    value: ProfessionalFormState[K]
  ) {
    setForm(current => ({ ...current, [field]: value }));
  }

  function handleSave() {
    if (validationMessage) {
      toast.error(validationMessage);
      return;
    }

    upsertProfile.mutate({
      displayName:
        form.displayName.trim() ||
        suggestedProfessionalName ||
        "Perfil profissional",
      registrationNumber: form.registrationNumber.trim() || undefined,
      active: form.active,
    });
  }

  if (profile.isSuccess && profile.data?.active) {
    const settingsResourceAvailable = Boolean(
      entitlements.data?.allowed &&
        entitlements.data.enabledResources.includes("professional_settings")
    );
    const settingsAccessUnavailable = Boolean(
      !entitlements.isLoading &&
        (entitlements.isError ||
          (entitlements.data && !settingsResourceAvailable))
    );

    const confirmDeactivation = () => {
      const confirmed = window.confirm(
        "Desativar a Área Profissional? A navegação e novas operações serão bloqueadas. Vínculos, prontuários, mensagens e histórico serão preservados. Sua área pessoal continuará funcionando e a reativação poderá ser feita nestas Configurações pessoais."
      );
      if (confirmed) setActive.mutate({ active: false });
    };

    return (
      <Card className="border-emerald-500/30 bg-emerald-500/5 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <BadgeCheck className="h-5 w-5 text-emerald-700" />
            Perfil profissional ativo
          </CardTitle>
          <CardDescription>
            A identidade e as preferências operacionais são administradas na
            Área Profissional. A disponibilidade do perfil continua sob seu
            controle nestas Configurações pessoais.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">
                {profile.data.displayName || "Perfil profissional"}
              </p>
              {profile.data.registrationNumber ? (
                <p className="mt-1">{profile.data.registrationNumber}</p>
              ) : (
                <p className="mt-1">Registro profissional não informado.</p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                onClick={() => setLocation("/professional")}
              >
                <Stethoscope className="h-4 w-4" />
                Abrir Área Profissional
              </Button>
              {settingsResourceAvailable ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setLocation("/professional/settings")}
                >
                  Abrir configurações profissionais
                  <ArrowRight className="h-4 w-4" />
                </Button>
              ) : null}
            </div>
          </div>

          {entitlements.isLoading ? (
            <div
              role="status"
              className="rounded-2xl border bg-background/70 px-4 py-3 text-sm text-muted-foreground"
            >
              Verificando a disponibilidade das configurações profissionais...
            </div>
          ) : null}

          {settingsAccessUnavailable ? (
            <div className="flex flex-col gap-3 rounded-2xl border border-amber-300/70 bg-amber-50 p-4 text-sm text-amber-950 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                <div>
                  <p className="font-medium">
                    Configurações profissionais indisponíveis no acesso atual
                  </p>
                  <p className="mt-1 leading-6">
                    Seu perfil permanece ativo. Caso não queira mantê-lo assim,
                    você pode desativar a Área Profissional sem apagar vínculos,
                    prontuários, mensagens ou histórico.
                  </p>
                </div>
              </div>
              <Button
                type="button"
                variant="destructive"
                disabled={setActive.isPending}
                onClick={confirmDeactivation}
              >
                <Power className="h-4 w-4" />
                {setActive.isPending
                  ? "Desativando..."
                  : "Desativar Área Profissional"}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl">
          <Stethoscope className="h-5 w-5 text-primary" />
          Perfil profissional
        </CardTitle>
        <CardDescription>
          Ative a área Profissional para acompanhar pessoas autorizadas,
          solicitar vínculos e consultar dados compartilhados com consentimento.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {profile.isLoading ? (
          <ProfessionalLoadingState label="Carregando perfil profissional..." />
        ) : null}

        {profile.isError ? (
          <ProfessionalAsyncState
            variant="panel"
            title="Não foi possível carregar o perfil profissional"
            description="Os campos permanecem visíveis, mas salvar fica indisponível até esta seção ser atualizada."
            onRetry={() => {
              setAppliedSavedProfile(false);
              void profile.refetch();
            }}
          />
        ) : null}

        {validationMessage ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {validationMessage}
          </div>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="min-w-0 space-y-2 rounded-2xl border bg-background p-5">
            <Label htmlFor="professional-display-name">Nome profissional</Label>
            <Input
              id="professional-display-name"
              value={form.displayName}
              onChange={event => updateField("displayName", event.target.value)}
              placeholder={
                suggestedProfessionalName ||
                "Nome exibido para pessoas acompanhadas"
              }
            />
          </div>
          <div className="min-w-0 space-y-2 rounded-2xl border bg-background p-5">
            <Label htmlFor="professional-registration-number">
              Registro profissional
            </Label>
            <Input
              id="professional-registration-number"
              value={form.registrationNumber}
              onChange={event =>
                updateField("registrationNumber", event.target.value)
              }
              placeholder="Registro, conselho ou identificação profissional"
            />
          </div>
        </div>

        <label className="flex items-start gap-3 rounded-2xl border bg-muted/20 p-4 text-sm leading-6">
          <Checkbox
            checked={form.active}
            onCheckedChange={value => updateField("active", Boolean(value))}
            className="mt-1"
          />
          <span>
            <span className="block font-medium text-foreground">
              Ativar área Profissional
            </span>
            <span className="text-muted-foreground">
              Quando ativo, o menu Profissional aparece e você pode solicitar
              vínculos de acompanhamento com pessoas que autorizarem o acesso.
            </span>
          </span>
        </label>

        <div className="flex justify-end">
          <Button
            type="button"
            className="rounded-full"
            disabled={
              upsertProfile.isPending || profile.isLoading || profile.isError
            }
            onClick={handleSave}
          >
            <Save className="mr-2 h-4 w-4" />
            {upsertProfile.isPending
              ? "Salvando..."
              : "Salvar perfil profissional"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function PatientAccessRequestsCard({
  embedded = false,
}: PatientAccessRequestsCardProps) {
  const utils = trpc.useUtils();
  const patientRequests = trpc.nutrition.professionals.patientRequests.useQuery(
    undefined,
    { retry: false }
  );

  const invalidateProfessionalSettings = async () => {
    await Promise.all([
      utils.auth.me.invalidate(),
      utils.nutrition.professionals.profile.invalidate(),
      utils.nutrition.professionals.myAccesses.invalidate(),
      utils.nutrition.professionals.patientRequests.invalidate(),
      utils.nutrition.professionals.history.invalidate(),
      utils.professionalRecord.settings.get.invalidate(),
      utils.professionalRecord.settings.entitlements.invalidate(),
    ]);
  };

  const approveAccess = trpc.nutrition.professionals.approveAccess.useMutation({
    onSuccess: async () => {
      await invalidateProfessionalSettings();
      toast.success("Acesso profissional aprovado.");
    },
    onError: error =>
      toast.error(error.message || "Não foi possível aprovar a solicitação."),
  });

  const revokeAccess = trpc.nutrition.professionals.revokeAccess.useMutation({
    onSuccess: async () => {
      await invalidateProfessionalSettings();
      toast.success("Acesso profissional revogado.");
    },
    onError: error =>
      toast.error(error.message || "Não foi possível revogar o acesso."),
  });

  const requests = patientRequests.data ?? [];
  const content = (
    <div className="space-y-3">
      {patientRequests.isLoading ? (
        <ProfessionalLoadingState label="Carregando solicitações recebidas..." />
      ) : null}

      {patientRequests.isError ? (
        <ProfessionalAsyncState
          variant="panel"
          title="Não foi possível carregar as solicitações recebidas"
          description="O restante das configurações permanece disponível. Tente novamente para atualizar somente esta seção."
          onRetry={() => void patientRequests.refetch()}
        />
      ) : null}

      {!patientRequests.isLoading && !patientRequests.isError && requests.length
        ? requests.map(request => (
            <div
              key={request.id}
              className="rounded-2xl border bg-background p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 space-y-3">
                  <div>
                    <p className="font-medium">
                      {request.professional?.displayName ?? "Profissional"}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                      <span className="text-muted-foreground">Vínculo</span>
                      <ProfessionalStatusBadge
                        kind="authorization"
                        value={request.status}
                      />
                      <span
                        className={`rounded-full border px-3 py-1 ${getAuthorizationMessageStatusClass(request.authorizationMessageStatus)}`}
                      >
                        {formatAuthorizationMessageStatus(
                          request.authorizationMessageStatus
                        )}
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Solicitado em{" "}
                      {new Date(request.requestedAt).toLocaleString("pt-BR")}
                    </p>
                    {request.authorizationMessageSentAt ? (
                      <p className="text-xs text-muted-foreground">
                        Notificação registrada em{" "}
                        {new Date(
                          request.authorizationMessageSentAt
                        ).toLocaleString("pt-BR")}
                      </p>
                    ) : null}
                    {request.authorizationMessageError ? (
                      <p className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
                        A notificação não foi concluída. O vínculo pode ser
                        revisado normalmente.
                      </p>
                    ) : null}
                  </div>
                  <div className="space-y-2">
                    <p className="text-xs font-medium uppercase text-muted-foreground">
                      {permissionsTitle(request.status)}
                    </p>
                    <ul
                      className="flex flex-wrap gap-2"
                      aria-label={permissionsTitle(request.status)}
                    >
                      {PATIENT_ACCESS_PERMISSIONS.map(permission => (
                        <li
                          key={permission}
                          className="rounded-full border bg-muted/30 px-3 py-1 text-xs text-muted-foreground"
                        >
                          {permission}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {request.status === "pending" ? (
                    <Button
                      type="button"
                      className="rounded-full"
                      onClick={() =>
                        approveAccess.mutate({ accessId: request.id })
                      }
                      disabled={approveAccess.isPending}
                    >
                      <UserCheck className="mr-2 h-4 w-4" />
                      Aprovar
                    </Button>
                  ) : null}
                  {request.status !== "revoked" ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="rounded-full"
                      onClick={() =>
                        revokeAccess.mutate({ accessId: request.id })
                      }
                      disabled={revokeAccess.isPending}
                    >
                      <X className="mr-2 h-4 w-4" />
                      Revogar
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
          ))
        : null}

      {!patientRequests.isLoading &&
      !patientRequests.isError &&
      !requests.length ? (
        <div className="rounded-2xl border border-dashed bg-muted/20 p-6 text-sm leading-6 text-muted-foreground">
          Nenhuma solicitação recebida até agora.
        </div>
      ) : null}
    </div>
  );

  if (embedded) {
    return (
      <section className="rounded-2xl border bg-muted/10 p-4">
        <div className="mb-3">
          <h3 className="flex items-center gap-2 text-base font-semibold tracking-tight">
            <UserCheck className="h-5 w-5 text-primary" />
            Solicitações de acesso
          </h3>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Revise pedidos de acompanhamento e acompanhe o status das
            notificações enviadas aos profissionais.
          </p>
        </div>
        {content}
      </section>
    );
  }

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl">
          <UserCheck className="h-5 w-5 text-primary" />
          Solicitações recebidas
        </CardTitle>
        <CardDescription>
          Revise pedidos de acompanhamento e acompanhe o status das notificações
          enviadas aos profissionais.
        </CardDescription>
      </CardHeader>
      <CardContent>{content}</CardContent>
    </Card>
  );
}
