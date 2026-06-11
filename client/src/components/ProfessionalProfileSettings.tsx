import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { Save, Stethoscope, UserCheck, X } from "lucide-react";
import React, { useEffect, useState } from "react";
import { toast } from "sonner";

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

function formatAccessStatus(status: string) {
  const labels: Record<string, string> = {
    pending: "Pendente",
    approved: "Aprovado",
    rejected: "Recusado",
    revoked: "Revogado",
  };
  return labels[status] ?? status;
}

function permissionsTitle(status: string) {
  if (status === "approved") return "Permissões concedidas";
  if (status === "revoked") return "Permissões revogadas";
  if (status === "rejected") return "Permissões recusadas";
  return "Permissões solicitadas";
}

export default function ProfessionalProfileSettings() {
  const utils = trpc.useUtils();
  const { user } = useAuth();
  const profile = trpc.nutrition.professionals.profile.useQuery(undefined, { retry: false });
  const [appliedSavedProfile, setAppliedSavedProfile] = useState(false);
  const [form, setForm] = useState<ProfessionalFormState>(initialForm);
  const suggestedProfessionalName = user?.name?.trim() ?? "";

  useEffect(() => {
    if (appliedSavedProfile || !profile.isSuccess) return;

    setForm({
      displayName: profile.data?.displayName ?? suggestedProfessionalName,
      registrationNumber: profile.data?.registrationNumber ?? "",
      active: Boolean(profile.data?.active),
    });
    setAppliedSavedProfile(true);
  }, [appliedSavedProfile, profile.data, profile.isSuccess, suggestedProfessionalName]);

  const invalidateProfessionalSettings = async () => {
    await Promise.all([
      utils.auth.me.invalidate(),
      utils.nutrition.professionals.profile.invalidate(),
      utils.nutrition.professionals.myAccesses.invalidate(),
      utils.nutrition.professionals.patientRequests.invalidate(),
      utils.nutrition.professionals.history.invalidate(),
    ]);
  };

  const upsertProfile = trpc.nutrition.professionals.upsertProfile.useMutation({
    onSuccess: async savedProfile => {
      setForm({
        displayName: savedProfile.displayName ?? suggestedProfessionalName,
        registrationNumber: savedProfile.registrationNumber ?? "",
        active: Boolean(savedProfile.active),
      });
      setAppliedSavedProfile(true);
      await invalidateProfessionalSettings();
      toast.success("Perfil profissional salvo.");
    },
    onError: error => toast.error(error.message || "Não foi possível salvar o perfil profissional."),
  });

  const validationMessage = (() => {
    if (!form.active) return null;
    if (form.displayName.trim().length < 2) return "Informe o nome profissional antes de ativar o perfil.";
    return null;
  })();

  function updateField<K extends keyof ProfessionalFormState>(field: K, value: ProfessionalFormState[K]) {
    setForm(current => ({ ...current, [field]: value }));
  }

  function handleSave() {
    if (validationMessage) {
      toast.error(validationMessage);
      return;
    }

    upsertProfile.mutate({
      displayName: form.displayName.trim() || suggestedProfessionalName || "Perfil profissional",
      registrationNumber: form.registrationNumber.trim() || undefined,
      active: form.active,
    });
  }

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl">
          <Stethoscope className="h-5 w-5 text-primary" />
          Perfil profissional
        </CardTitle>
        <CardDescription>
          Ative a área Profissional para acompanhar pessoas autorizadas, solicitar vínculos e consultar dados compartilhados com consentimento.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {profile.isLoading ? (
          <div className="rounded-2xl border bg-muted/20 px-4 py-3 text-sm text-muted-foreground" role="status" aria-live="polite">
            Carregando perfil profissional...
          </div>
        ) : null}

        {profile.isError ? (
          <div className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            Não foi possível carregar o perfil profissional. Tente novamente antes de salvar alterações.
          </div>
        ) : null}

        {validationMessage ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {validationMessage}
          </div>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="min-w-0 space-y-2 rounded-2xl border bg-background p-5">
            <Label>Nome profissional</Label>
            <Input value={form.displayName} onChange={event => updateField("displayName", event.target.value)} placeholder={suggestedProfessionalName || "Nome exibido para pessoas acompanhadas"} />
          </div>
          <div className="min-w-0 space-y-2 rounded-2xl border bg-background p-5">
            <Label>Registro profissional</Label>
            <Input value={form.registrationNumber} onChange={event => updateField("registrationNumber", event.target.value)} placeholder="Registro, conselho ou identificação profissional" />
          </div>
        </div>

        <label className="flex items-start gap-3 rounded-2xl border bg-muted/20 p-4 text-sm leading-6">
          <Checkbox checked={form.active} onCheckedChange={value => updateField("active", Boolean(value))} className="mt-1" />
          <span>
            <span className="block font-medium text-foreground">Ativar área Profissional</span>
            <span className="text-muted-foreground">Quando ativo, o menu Profissional aparece e você pode solicitar vínculos de acompanhamento com pessoas que autorizarem o acesso.</span>
          </span>
        </label>

        <div className="flex justify-end">
          <Button type="button" className="rounded-full" disabled={upsertProfile.isPending || profile.isLoading} onClick={handleSave}>
            <Save className="mr-2 h-4 w-4" />
            {upsertProfile.isPending ? "Salvando..." : "Salvar perfil profissional"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function PatientAccessRequestsCard({ embedded = false }: PatientAccessRequestsCardProps) {
  const utils = trpc.useUtils();
  const patientRequests = trpc.nutrition.professionals.patientRequests.useQuery(undefined, { retry: false });

  const invalidateProfessionalSettings = async () => {
    await Promise.all([
      utils.auth.me.invalidate(),
      utils.nutrition.professionals.profile.invalidate(),
      utils.nutrition.professionals.myAccesses.invalidate(),
      utils.nutrition.professionals.patientRequests.invalidate(),
      utils.nutrition.professionals.history.invalidate(),
    ]);
  };

  const approveAccess = trpc.nutrition.professionals.approveAccess.useMutation({
    onSuccess: async () => {
      await invalidateProfessionalSettings();
      toast.success("Acesso profissional aprovado.");
    },
    onError: error => toast.error(error.message || "Não foi possível aprovar a solicitação."),
  });

  const revokeAccess = trpc.nutrition.professionals.revokeAccess.useMutation({
    onSuccess: async () => {
      await invalidateProfessionalSettings();
      toast.success("Acesso profissional revogado.");
    },
    onError: error => toast.error(error.message || "Não foi possível revogar o acesso."),
  });

  const requests = patientRequests.data ?? [];
  const content = (
    <div className="space-y-3">
      {patientRequests.isLoading ? (
        <div className="rounded-2xl border bg-muted/20 p-6 text-sm text-muted-foreground" role="status" aria-live="polite">
          Carregando solicitações recebidas...
        </div>
      ) : null}

      {patientRequests.isError ? (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-6 text-sm text-destructive">
          Não foi possível carregar as solicitações recebidas. Tente novamente em instantes.
        </div>
      ) : null}

      {!patientRequests.isLoading && !patientRequests.isError && requests.length ? requests.map(request => (
        <div key={request.id} className="rounded-2xl border bg-background p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-3">
              <div>
                <p className="font-medium">{request.professional?.displayName ?? `Profissional #${request.professionalUserId}`}</p>
                <p className="text-xs text-muted-foreground">Status: {formatAccessStatus(request.status)}</p>
                <p className="text-xs text-muted-foreground">Solicitado em {new Date(request.requestedAt).toLocaleString("pt-BR")}</p>
              </div>
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase text-muted-foreground">{permissionsTitle(request.status)}</p>
                <ul className="flex flex-wrap gap-2" aria-label={permissionsTitle(request.status)}>
                  {PATIENT_ACCESS_PERMISSIONS.map(permission => (
                    <li key={permission} className="rounded-full border bg-muted/30 px-3 py-1 text-xs text-muted-foreground">
                      {permission}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {request.status === "pending" ? (
                <Button type="button" className="rounded-full" onClick={() => approveAccess.mutate({ accessId: request.id })} disabled={approveAccess.isPending}>
                  <UserCheck className="mr-2 h-4 w-4" />
                  Aprovar
                </Button>
              ) : null}
              {request.status !== "revoked" ? (
                <Button type="button" variant="outline" className="rounded-full" onClick={() => revokeAccess.mutate({ accessId: request.id })} disabled={revokeAccess.isPending}>
                  <X className="mr-2 h-4 w-4" />
                  Revogar
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      )) : null}

      {!patientRequests.isLoading && !patientRequests.isError && !requests.length ? (
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
            Revise pedidos de acompanhamento e escolha quais profissionais podem acessar seus dados autorizados.
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
          Revise pedidos de acompanhamento e escolha quais profissionais podem acessar seus dados autorizados.
        </CardDescription>
      </CardHeader>
      <CardContent>{content}</CardContent>
    </Card>
  );
}
