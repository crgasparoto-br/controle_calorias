import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { Save, Stethoscope } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

type ProfessionalFormState = {
  displayName: string;
  registrationNumber: string;
  active: boolean;
};

const initialForm: ProfessionalFormState = {
  displayName: "",
  registrationNumber: "",
  active: false,
};

export default function ProfessionalProfileSettings() {
  const utils = trpc.useUtils();
  const profile = trpc.nutrition.professionals.profile.useQuery(undefined, { retry: false });
  const [appliedSavedProfile, setAppliedSavedProfile] = useState(false);
  const [form, setForm] = useState<ProfessionalFormState>(initialForm);

  useEffect(() => {
    if (appliedSavedProfile || profile.isLoading) return;

    setForm({
      displayName: profile.data?.displayName ?? "",
      registrationNumber: profile.data?.registrationNumber ?? "",
      active: Boolean(profile.data?.active),
    });
    setAppliedSavedProfile(true);
  }, [appliedSavedProfile, profile.data, profile.isLoading]);

  const upsertProfile = trpc.nutrition.professionals.upsertProfile.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.nutrition.professionals.profile.invalidate(),
        utils.nutrition.professionals.myAccesses.invalidate(),
        utils.nutrition.professionals.history.invalidate(),
      ]);
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
      displayName: form.displayName.trim() || "Perfil profissional",
      registrationNumber: form.registrationNumber.trim() || undefined,
      active: form.active,
    });
  }

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl">
          <Stethoscope className="h-5 w-5 text-primary" />
          Perfil profissional de nutricionista
        </CardTitle>
        <CardDescription>
          O nutricionista continua usando a própria conta pessoal. Ao ativar este perfil, o menu e as funcionalidades profissionais ficam disponíveis como uma camada adicional.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {validationMessage ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {validationMessage}
          </div>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="min-w-0 space-y-2 rounded-2xl border bg-background p-5">
            <Label>Nome profissional</Label>
            <Input value={form.displayName} onChange={event => updateField("displayName", event.target.value)} placeholder="Nome usado com pacientes" />
          </div>
          <div className="min-w-0 space-y-2 rounded-2xl border bg-background p-5">
            <Label>Registro profissional</Label>
            <Input value={form.registrationNumber} onChange={event => updateField("registrationNumber", event.target.value)} placeholder="CRN ou outro registro" />
          </div>
        </div>

        <label className="flex items-start gap-3 rounded-2xl border bg-muted/20 p-4 text-sm leading-6">
          <Checkbox checked={form.active} onCheckedChange={value => updateField("active", Boolean(value))} className="mt-1" />
          <span>
            <span className="block font-medium text-foreground">Ativar perfil profissional de nutricionista</span>
            <span className="text-muted-foreground">Quando ativo, o menu Nutricionista aparece e as APIs profissionais aceitam solicitações, pacientes autorizados e acompanhamento.</span>
          </span>
        </label>

        <div className="flex justify-end">
          <Button type="button" className="rounded-full" disabled={upsertProfile.isPending} onClick={handleSave}>
            <Save className="mr-2 h-4 w-4" />
            {upsertProfile.isPending ? "Salvando..." : "Salvar perfil profissional"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
