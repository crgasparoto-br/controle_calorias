import { useAuth } from "@/_core/hooks/useAuth";
import ProfessionalLayout from "@/components/ProfessionalLayout";
import PageIntro from "@/components/PageIntro";
import {
  ProfessionalAvailabilityCard,
  ProfessionalEntitlementSummaryCard,
  ProfessionalOperationalCriteriaCard,
} from "@/components/professional-settings/ProfessionalAccessSettingsCards";
import ProfessionalIdentitySettingsCard from "@/components/professional-settings/ProfessionalIdentitySettingsCard";
import ProfessionalPreferencesSettingsCard, {
  type TemplateDraft,
} from "@/components/professional-settings/ProfessionalPreferencesSettingsCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { AlertTriangle, RefreshCw } from "lucide-react";
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
  const [defaultReviewIntervalDays, setDefaultReviewIntervalDays] =
    useState("");
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
            remindersEnabled: true,
            defaultReminderLeadDays: 1,
            summaryFrequency: "disabled",
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
            "Desativar a Área Profissional? O histórico será preservado, mas novos acessos ficarão bloqueados até a reativação."
          );
          if (confirmed) setActive.mutate({ active: false });
        }}
      />
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
