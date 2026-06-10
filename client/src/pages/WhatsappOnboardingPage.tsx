import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { parseDecimalInputPtBr } from "@/lib/numberFormat";
import { trpc } from "@/lib/trpc";
import { AlertCircle, CheckCircle2, Loader2, MessageCircle } from "lucide-react";
import React, { useMemo, useState } from "react";
import { toast } from "sonner";
import { useLocation, useRoute } from "wouter";

const OBJECTIVE_OPTIONS = [
  { value: "emagrecer", label: "Emagrecer" },
  { value: "manter_peso", label: "Manter peso" },
  { value: "ganhar_massa", label: "Ganhar massa" },
  { value: "melhorar_habitos", label: "Melhorar hábitos" },
] as const;

const ACTIVITY_OPTIONS = [
  { value: "sedentary", label: "Pouca atividade" },
  { value: "light", label: "Leve" },
  { value: "moderate", label: "Moderada" },
  { value: "active", label: "Alta" },
  { value: "very_active", label: "Muito alta" },
] as const;

const EXPERIENCE_OPTIONS = [
  { value: "beginner", label: "Estou começando" },
  { value: "intermediate", label: "Já acompanhei antes" },
  { value: "advanced", label: "Tenho bastante prática" },
] as const;

const ROUTINE_OPTIONS = [
  { value: "cozinha_em_casa", label: "Cozinha em casa" },
  { value: "come_fora", label: "Come fora" },
  { value: "delivery", label: "Delivery" },
  { value: "marmita", label: "Marmita" },
  { value: "misto", label: "Misto" },
] as const;

const DIFFICULTY_OPTIONS = [
  { value: "fome", label: "Fome" },
  { value: "ansiedade", label: "Ansiedade" },
  { value: "falta_de_tempo", label: "Falta de tempo" },
  { value: "beliscos", label: "Beliscos" },
  { value: "doces", label: "Doces" },
  { value: "comer_fora", label: "Comer fora" },
  { value: "falta_de_planejamento", label: "Falta de planejamento" },
] as const;

type FormState = {
  name: string;
  email: string;
  password: string;
  birthDate: string;
  heightCm: string;
  currentWeightKg: string;
  objective: typeof OBJECTIVE_OPTIONS[number]["value"];
  activityLevel: typeof ACTIVITY_OPTIONS[number]["value"];
  trackingExperience: typeof EXPERIENCE_OPTIONS[number]["value"];
  dietaryPreferences: string;
  dietaryRestrictions: string;
  eatingRoutine: typeof ROUTINE_OPTIONS[number]["value"];
  mainDifficulty: typeof DIFFICULTY_OPTIONS[number]["value"];
  acceptedTerms: boolean;
  acceptedPrivacyPolicy: boolean;
  acceptedHealthDataProcessing: boolean;
  acceptedOperationalWhatsapp: boolean;
  acceptedMarketingWhatsapp: boolean;
};

const initialForm: FormState = {
  name: "",
  email: "",
  password: "",
  birthDate: "",
  heightCm: "",
  currentWeightKg: "",
  objective: "melhorar_habitos",
  activityLevel: "moderate",
  trackingExperience: "beginner",
  dietaryPreferences: "",
  dietaryRestrictions: "",
  eatingRoutine: "misto",
  mainDifficulty: "falta_de_planejamento",
  acceptedTerms: false,
  acceptedPrivacyPolicy: false,
  acceptedHealthDataProcessing: false,
  acceptedOperationalWhatsapp: false,
  acceptedMarketingWhatsapp: false,
};

function splitList(value: string) {
  return value.split(/[,;\n]/).map(item => item.trim()).filter(Boolean);
}

function parseHeightInputToCentimeters(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const directDecimal = trimmed.replace(/\s/g, "").replace(",", ".");
  const parsed = /^\d+(\.\d+)?$/.test(directDecimal) ? Number(directDecimal) : parseDecimalInputPtBr(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  if (parsed < 3) return Math.round(parsed * 1000) / 10;
  return parsed;
}

function parseOptionalDecimalInput(value: string) {
  if (!value.trim()) return undefined;
  return parseDecimalInputPtBr(value);
}

export default function WhatsappOnboardingPage() {
  const [, params] = useRoute("/onboarding/whatsapp/:token");
  const [, setLocation] = useLocation();
  const token = params?.token ?? "";
  const [form, setForm] = useState<FormState>(initialForm);

  const leadQuery = trpc.auth.whatsappOnboarding.validate.useQuery({ token }, { enabled: Boolean(token), retry: false });
  const completeOnboarding = trpc.auth.whatsappOnboarding.complete.useMutation({
    onSuccess: () => {
      toast.success("Cadastro concluído. Seu WhatsApp já está vinculado.");
      setLocation("/onboarding");
    },
    onError: error => toast.error(error.message || "Não foi possível concluir o cadastro."),
  });

  const parsed = useMemo(() => ({
    name: form.name.trim(),
    email: form.email.trim(),
    password: form.password,
    heightCm: parseHeightInputToCentimeters(form.heightCm),
    currentWeightKg: parseOptionalDecimalInput(form.currentWeightKg),
    dietaryPreferences: splitList(form.dietaryPreferences),
    dietaryRestrictions: splitList(form.dietaryRestrictions),
  }), [form]);

  const validationMessage = useMemo(() => {
    if (!parsed.name || parsed.name.length < 2) return "Informe seu nome completo.";
    if (!parsed.email) return "Informe seu e-mail.";
    if (form.password.length < 8) return "Crie uma senha com pelo menos 8 caracteres.";
    if (!form.birthDate) return "Informe sua data de nascimento.";
    if (!parsed.heightCm || parsed.heightCm < 100 || parsed.heightCm > 250) return "Informe uma altura entre 1,00 m e 2,50 m.";
    if (!parsed.currentWeightKg || parsed.currentWeightKg < 25 || parsed.currentWeightKg > 350) return "Informe seu peso atual.";
    if (!form.acceptedTerms || !form.acceptedPrivacyPolicy || !form.acceptedHealthDataProcessing || !form.acceptedOperationalWhatsapp) return "Aceite os consentimentos obrigatórios para concluir.";
    return null;
  }, [form, parsed]);

  function updateField<K extends keyof FormState>(field: K, value: FormState[K]) {
    setForm(current => ({ ...current, [field]: value }));
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (validationMessage) {
      toast.error(validationMessage);
      return;
    }

    completeOnboarding.mutate({
      token,
      email: parsed.email,
      password: parsed.password,
      profile: {
        name: parsed.name,
        birthDate: form.birthDate,
        heightCm: parsed.heightCm ?? 0,
        currentWeightKg: parsed.currentWeightKg ?? 0,
        objective: form.objective,
        activityLevel: form.activityLevel,
        trackingExperience: form.trackingExperience,
        dietaryPreferences: parsed.dietaryPreferences,
        dietaryRestrictions: parsed.dietaryRestrictions,
        eatingRoutine: form.eatingRoutine,
        mainDifficulty: form.mainDifficulty,
      },
      consents: {
        acceptedTerms: form.acceptedTerms,
        acceptedPrivacyPolicy: form.acceptedPrivacyPolicy,
        acceptedHealthDataProcessing: form.acceptedHealthDataProcessing,
        acceptedOperationalWhatsapp: form.acceptedOperationalWhatsapp,
        acceptedMarketingWhatsapp: form.acceptedMarketingWhatsapp,
      },
    });
  }

  if (leadQuery.isLoading) {
    return <StatusScreen icon={<Loader2 className="h-5 w-5 animate-spin" />} title="Validando seu link" description="Estamos conferindo se o convite recebido pelo WhatsApp ainda está ativo." />;
  }

  if (leadQuery.isError || !leadQuery.data) {
    return <StatusScreen icon={<AlertCircle className="h-5 w-5" />} title="Link indisponível" description="Este link está inválido, expirado ou já foi utilizado. Envie uma nova mensagem pelo WhatsApp para receber outro acesso seguro." />;
  }

  return (
    <main className="min-h-screen bg-background px-4 py-8 text-foreground sm:px-6 lg:px-8">
      <form className="mx-auto flex w-full max-w-5xl flex-col gap-6" onSubmit={handleSubmit}>
        <section className="grid gap-4 rounded-2xl border bg-muted/20 p-5 shadow-sm md:grid-cols-[1fr_auto] md:items-center">
          <div>
            <p className="flex items-center gap-2 text-sm font-medium text-primary"><MessageCircle className="h-4 w-4" /> Cadastro iniciado pelo WhatsApp</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Finalize seu acesso</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Complete os dados obrigatórios para ativar sua conta. A etapa de pagamento não faz parte deste fluxo.</p>
          </div>
          <div className="rounded-xl border bg-background px-4 py-3 text-sm">
            <p className="text-muted-foreground">Telefone vinculado</p>
            <p className="mt-1 font-semibold">{leadQuery.data.phoneNumberMasked}</p>
          </div>
        </section>

        {validationMessage ? <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{validationMessage}</div> : null}

        <Card className="border shadow-sm">
          <CardHeader>
            <CardTitle>Dados de acesso e perfil</CardTitle>
            <CardDescription>Esses dados ativam a conta web e calibram as metas iniciais.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <TextField label="Nome" value={form.name} onChange={value => updateField("name", value)} />
            <TextField label="E-mail" type="email" value={form.email} onChange={value => updateField("email", value)} />
            <TextField label="Senha" type="password" value={form.password} onChange={value => updateField("password", value)} />
            <TextField label="Data de nascimento" type="date" value={form.birthDate} onChange={value => updateField("birthDate", value)} />
            <TextField label="Altura" suffix="m ou cm" inputMode="decimal" value={form.heightCm} onChange={value => updateField("heightCm", value)} placeholder="Ex.: 1,72" />
            <TextField label="Peso atual" suffix="kg" inputMode="decimal" value={form.currentWeightKg} onChange={value => updateField("currentWeightKg", value)} placeholder="Ex.: 72,5" />
          </CardContent>
        </Card>

        <Card className="border shadow-sm">
          <CardHeader>
            <CardTitle>Objetivo e rotina</CardTitle>
            <CardDescription>Use respostas simples. Você pode ajustar tudo depois nas configurações.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <SelectField label="Objetivo" value={form.objective} options={OBJECTIVE_OPTIONS} onChange={value => updateField("objective", value as FormState["objective"])} />
            <SelectField label="Atividade física" value={form.activityLevel} options={ACTIVITY_OPTIONS} onChange={value => updateField("activityLevel", value as FormState["activityLevel"])} />
            <SelectField label="Experiência" value={form.trackingExperience} options={EXPERIENCE_OPTIONS} onChange={value => updateField("trackingExperience", value as FormState["trackingExperience"])} />
            <SelectField label="Rotina alimentar" value={form.eatingRoutine} options={ROUTINE_OPTIONS} onChange={value => updateField("eatingRoutine", value as FormState["eatingRoutine"])} />
            <SelectField label="Principal dificuldade" value={form.mainDifficulty} options={DIFFICULTY_OPTIONS} onChange={value => updateField("mainDifficulty", value as FormState["mainDifficulty"])} />
            <div className="grid gap-4 md:col-span-2 xl:col-span-3 xl:grid-cols-2">
              <TextAreaField label="Preferências alimentares" value={form.dietaryPreferences} onChange={value => updateField("dietaryPreferences", value)} placeholder="Ex.: comida caseira, vegetariano" />
              <TextAreaField label="Restrições alimentares" value={form.dietaryRestrictions} onChange={value => updateField("dietaryRestrictions", value)} placeholder="Ex.: lactose, glúten" />
            </div>
          </CardContent>
        </Card>

        <Card className="border shadow-sm">
          <CardHeader>
            <CardTitle>Consentimentos</CardTitle>
            <CardDescription>Os aceites obrigatórios registram consentimento para uso do serviço e mensagens operacionais pelo WhatsApp.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <ConsentField checked={form.acceptedTerms} onChange={value => updateField("acceptedTerms", value)} label="Aceito os termos de uso." />
            <ConsentField checked={form.acceptedPrivacyPolicy} onChange={value => updateField("acceptedPrivacyPolicy", value)} label="Aceito a política de privacidade." />
            <ConsentField checked={form.acceptedHealthDataProcessing} onChange={value => updateField("acceptedHealthDataProcessing", value)} label="Autorizo o tratamento dos dados necessários para calcular metas, registrar refeições e acompanhar evolução." />
            <ConsentField checked={form.acceptedOperationalWhatsapp} onChange={value => updateField("acceptedOperationalWhatsapp", value)} label="Autorizo mensagens operacionais pelo WhatsApp, como respostas aos meus registros e avisos do serviço." />
            <ConsentField checked={form.acceptedMarketingWhatsapp} onChange={value => updateField("acceptedMarketingWhatsapp", value)} label="Aceito receber comunicações de marketing pelo WhatsApp." optional />
          </CardContent>
        </Card>

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">Ao concluir, sua conta será ativada e o WhatsApp ficará vinculado para uso operacional.</p>
          <Button type="submit" className="h-11 rounded-full px-6" disabled={completeOnboarding.isPending}>
            {completeOnboarding.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
            Concluir cadastro
          </Button>
        </div>
      </form>
    </main>
  );
}

function StatusScreen({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-8">
      <div className="w-full max-w-md rounded-2xl border bg-background p-6 text-center shadow-sm">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted text-primary">{icon}</div>
        <h1 className="mt-4 text-xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
    </main>
  );
}

function TextField({ label, value, onChange, inputMode, suffix, type = "text", placeholder }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  suffix?: string;
  type?: React.HTMLInputTypeAttribute;
  placeholder?: string;
}) {
  return (
    <div className="min-w-0 space-y-2">
      <Label>{label}</Label>
      <div className="flex items-center gap-3">
        <Input type={type} inputMode={inputMode} value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} />
        {suffix ? <span className="shrink-0 text-sm text-muted-foreground">{suffix}</span> : null}
      </div>
    </div>
  );
}

function SelectField<T extends readonly { value: string; label: string }[]>({ label, value, options, onChange }: {
  label: string;
  value: string;
  options: T;
  onChange: (value: string) => void;
}) {
  return (
    <div className="min-w-0 space-y-2">
      <Label>{label}</Label>
      <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={value} onChange={event => onChange(event.target.value)}>
        {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </div>
  );
}

function TextAreaField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return (
    <div className="min-w-0 space-y-2">
      <Label>{label}</Label>
      <Textarea value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} rows={3} />
    </div>
  );
}

function ConsentField({ checked, onChange, label, optional = false }: { checked: boolean; onChange: (value: boolean) => void; label: string; optional?: boolean }) {
  return (
    <label className="flex items-start gap-3 rounded-xl border bg-muted/10 p-3 text-sm leading-6">
      <Checkbox checked={checked} onCheckedChange={value => onChange(Boolean(value))} className="mt-1" />
      <span>{label} {optional ? <span className="text-muted-foreground">(opcional)</span> : null}</span>
    </label>
  );
}
