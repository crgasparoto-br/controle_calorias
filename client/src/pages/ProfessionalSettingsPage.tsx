import { useAuth } from "@/_core/hooks/useAuth";
import ProfessionalLayout from "@/components/ProfessionalLayout";
import {
  ProfessionalAsyncState,
  ProfessionalLoadingState,
  ProfessionalPage,
  ProfessionalPageHeader,
} from "@/components/professional/ProfessionalUi";
import {
  ProfessionalAvailabilityCard,
  ProfessionalEntitlementSummaryCard,
  ProfessionalOperationalCriteriaCard,
} from "@/components/professional-settings/ProfessionalAccessSettingsCards";
import ProfessionalIdentitySettingsCard from "@/components/professional-settings/ProfessionalIdentitySettingsCard";
import ProfessionalPreferencesSettingsCard, {
  type TemplateDraft,
} from "@/components/professional-settings/ProfessionalPreferencesSettingsCard";
import { trpc } from "@/lib/trpc";
import React, { useEffect, useState } from "react";
import { useLocation } from "wouter";

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
  const [defaultReviewIntervalDays, setDefaultReviewIntervalDays] = useState("");
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
    setMessageTemplates(query.data.preferences.messageTemplates);
  }, [query.data]);

  const invalidateSettings = async () => {
    await Promise.all([
      utils.professionalRecord.settings.get.invalidate(),
      utils.professionalRecord.settings.entitlements.invalidate(),
      utils.nutrition.professionals.profile.invalidate(),
      utils.nutrition.professionals.myAccesses.invalidate(),
      utils.nutrition.professionals.portfolio.invalidate(),
    ]);
  };

  const clearProfessionalData = async () => {
    await Promise.all([
      utils.professionalRecord.get.cancel(),
      utils.professionalRecord.messages.list.cancel(),
      utils.professionalRecord.operationalAlerts.list.cancel(),
      utils.professionalRecord.ai.priorities.cancel(),
    ]);
    await Promise.all([
      utils.professionalRecord.get.reset(),
      utils.professionalRecord.messages.list.reset(),
      utils.professionalRecord.operationalAlerts.list.reset(),
      utils.professionalRecord.ai.priorities.reset(),
      utils.nutrition.professionals.patientDashboard.reset(),
      utils.nutrition.professionals.patientPeriodBundle.reset(),
      utils.nutrition.professionals.patientTimeZone.reset(),
    ]);
  };

  const updateIdentity =
    trpc.professionalRecord.settings.updateIdentity.useMutation({
      onSuccess: async () => {
        setSuccessMessage("Identidade profissional atualizada.");
        await invalidateSettings();
        await refreshAuth();
      },
    });
  const updatePreferences =
    trpc.professionalRecord.settings.updatePreferences.useMutation({
      onSuccess: async () => {
        setSuccessMessage("Preferências profissionais atualizadas.");
        await invalidateSettings();
      },
    });
  const setActive = trpc.professionalRecord.settings.setActive.useMutation({
    onSuccess: async result => {
      await clearProfessionalData();
      await invalidateSettings();
      await refreshAuth();
      if (!result.active) setLocation("/settings?tab=profissional");
    },
  });

  if (query.isLoading) {
    return <ProfessionalLoadingState label="Carregando configurações profissionais..." />;
  }

  if (query.isError || !query.data) {
    return (
      <ProfessionalAsyncState
        title="Não foi possível carregar as configurações"
        description="Nenhuma alteração foi realizada. Tente novamente."
        onRetry={() => void query.refetch()}
      />
    );
  }

  const mutationError =
    updateIdentity.error?.message ??
    updatePreferences.error?.message ??
    setActive.error?.message ??
    null;

  return (
    <ProfessionalPage>
      <ProfessionalPageHeader
        title="Configurações profissionais"
        description="Gerencie a identidade apresentada aos pacientes, preferências de acompanhamento, modelos, alertas e disponibilidade da Área Profissional."
      />

      {successMessage ? (
        <div role="status" className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm">
          {successMessage}
        </div>
      ) : null}
      {mutationError ? (
        <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {mutationError}
        </div>
      ) : null}

      <ProfessionalIdentitySettingsCard
        displayName={displayName}
        registrationNumber={registrationNumber}
        contactEmail={contactEmail}
        contactPhone={contactPhone}
        patientFacingBio={patientFacingBio}
        saving={updateIdentity.isPending}
        onDisplayNameChange={setDisplayName}
        onRegistrationNumberChange={setRegistrationNumber}
        onContactEmailChange={setContactEmail}
        onContactPhoneChange={setContactPhone}
        onPatientFacingBioChange={setPatientFacingBio}
        onSave={() => {
          setSuccessMessage(null);
          updateIdentity.mutate({
            displayName,
            registrationNumber,
            contactEmail,
            contactPhone,
            patientFacingBio,
          });
        }}
      />

      <ProfessionalPreferencesSettingsCard
        defaultReviewIntervalDays={defaultReviewIntervalDays}
        messageTemplates={messageTemplates}
        saving={updatePreferences.isPending}
        onDefaultReviewIntervalDaysChange={setDefaultReviewIntervalDays}
        onMessageTemplatesChange={setMessageTemplates}
        onSave={() => {
          setSuccessMessage(null);
          updatePreferences.mutate({
            defaultReviewIntervalDays: defaultReviewIntervalDays
              ? Number(defaultReviewIntervalDays)
              : null,
            messageTemplates,
          });
        }}
      />

      <ProfessionalOperationalCriteriaCard
        criteria={query.data.operationalAlertCriteria}
      />
      <ProfessionalEntitlementSummaryCard
        entitlements={query.data.entitlements}
      />
      <ProfessionalAvailabilityCard
        active={Boolean(query.data.profile?.active)}
        pending={setActive.isPending}
        onDeactivate={() => {
          const confirmed = window.confirm(
            "Desativar a Área Profissional? A navegação e novas operações serão bloqueadas. Vínculos, prontuários, mensagens e histórico serão preservados. Sua área pessoal continuará funcionando e a reativação poderá ser feita nas Configurações pessoais."
          );
          if (confirmed) setActive.mutate({ active: false });
        }}
      />
    </ProfessionalPage>
  );
}

export default function ProfessionalSettingsPage() {
  return (
    <ProfessionalLayout>
      <SettingsContent />
    </ProfessionalLayout>
  );
}
