import { useAuth } from "@/_core/hooks/useAuth";
import React, { useMemo, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { parseDecimalInputPtBr } from "@/lib/numberFormat";
import { trpc } from "@/lib/trpc";
import { Activity, ArrowRight, UserRound } from "lucide-react";
import { toast } from "sonner";
import { useLocation } from "wouter";

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
};

const initialForm: FormState = {
  name: "",
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
};

function splitList(value: string) {
  return value
    .split(/[,;\n]/)
    .map(item => item.trim())
    .filter(Boolean);
}

function calculateAgeYears(birthDate: string, referenceDate = new Date()) {
  if (!birthDate) return null;
  const [year, month, day] = birthDate.split("-").map(Number);
  if (!year || !month || !day) return null;

  const parsedDate = new Date(year, month - 1, day);
  const isSameDate = parsedDate.getFullYear() === year && parsedDate.getMonth() === month - 1 && parsedDate.getDate() === day;
  if (!isSameDate || parsedDate.getTime() > referenceDate.getTime()) return null;

  let age = referenceDate.getFullYear() - year;
  const birthdayAlreadyHappened = referenceDate.getMonth() > month - 1 || (referenceDate.getMonth() === month - 1 && referenceDate.getDate() >= day);
  if (!birthdayAlreadyHappened) age -= 1;
  return age;
}

export default function OnboardingPage() {
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();
  const { user } = useAuth();
  const [nameEdited, setNameEdited] = useState(false);
  const [form, setForm] = useState<FormState>(() => ({
    ...initialForm,
    name: user?.name?.trim() ?? "",
  }));

  const userName = user?.name?.trim() ?? "";
  React.useEffect(() => {
    if (!nameEdited && userName && !form.name.trim()) {
      setForm(current => ({ ...current, name: userName }));
    }
  }, [form.name, nameEdited, userName]);

  const calculatedAgeYears = useMemo(() => calculateAgeYears(form.birthDate), [form.birthDate]);

  const parsed = useMemo(() => ({
    name: form.name.trim(),
    birthDate: form.birthDate,
    heightCm: parseDecimalInputPtBr(form.heightCm),
    currentWeightKg: parseDecimalInputPtBr(form.currentWeightKg),
    objective: form.objective,
    activityLevel: form.activityLevel,
    trackingExperience: form.trackingExperience,
    dietaryPreferences: splitList(form.dietaryPreferences),
    dietaryRestrictions: splitList(form.dietaryRestrictions),
    eatingRoutine: form.eatingRoutine,
    mainDifficulty: form.mainDifficulty,
  }), [form]);

  const validationMessage = useMemo(() => {
    if (parsed.name.length < 2) return "Informe seu nome.";
    if (!parsed.birthDate) return "Informe sua data de nascimento.";
    if (calculatedAgeYears === null) return "Informe uma data de nascimento válida.";
    if (calculatedAgeYears < 13 || calculatedAgeYears > 120) return "A idade calculada deve estar entre 13 e 120 anos.";
    if (parsed.heightCm < 100 || parsed.heightCm > 250) return "Informe uma altura válida.";
    if (parsed.currentWeightKg < 25 || parsed.currentWeightKg > 350) return "Informe um peso atual válido.";
    return null;
  }, [calculatedAgeYears, parsed]);

  const completeOnboarding = trpc.nutrition.onboarding.complete.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.nutrition.goals.get.invalidate(),
        utils.nutrition.dashboard.overview.invalidate(),
        utils.nutrition.reports.weekly.invalidate(),
      ]);
      toast.success("Perfil criado e meta inicial calculada.");
      setLocation("/");
    },
    onError: error => toast.error(error.message || "Não foi possível concluir o onboarding."),
  });

  function updateField<K extends keyof FormState>(field: K, value: FormState[K]) {
    if (field === "name") setNameEdited(true);
    setForm(current => ({ ...current, [field]: value }));
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (validationMessage) {
      toast.error(validationMessage);
      return;
    }
    completeOnboarding.mutate(parsed);
  }

  return (
    <DashboardLayout>
      <form className="mx-auto grid max-w-5xl gap-6" onSubmit={handleSubmit}>
        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <UserRound className="h-5 w-5 text-primary" />
              Onboarding nutricional
            </CardTitle>
            <CardDescription>
              Essas informações ajudam a criar uma meta inicial personalizada e ajustável.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <TextField label="Nome" value={form.name} onChange={value => updateField("name", value)} />
            <TextField label="Data de nascimento" type="date" value={form.birthDate} onChange={value => updateField("birthDate", value)} />
            <TextField label="Altura" suffix="cm" inputMode="decimal" value={form.heightCm} onChange={value => updateField("heightCm", value)} />
            <TextField label="Peso atual" suffix="kg" inputMode="decimal" value={form.currentWeightKg} onChange={value => updateField("currentWeightKg", value)} />
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-primary" />
              Rotina e objetivo
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <SelectField label="Objetivo" value={form.objective} options={OBJECTIVE_OPTIONS} onChange={value => updateField("objective", value as FormState["objective"])} />
            <SelectField label="Nível de atividade física" value={form.activityLevel} options={ACTIVITY_OPTIONS} onChange={value => updateField("activityLevel", value as FormState["activityLevel"])} />
            <SelectField label="Experiência com controle alimentar" value={form.trackingExperience} options={EXPERIENCE_OPTIONS} onChange={value => updateField("trackingExperience", value as FormState["trackingExperience"])} />
            <SelectField label="Rotina alimentar" value={form.eatingRoutine} options={ROUTINE_OPTIONS} onChange={value => updateField("eatingRoutine", value as FormState["eatingRoutine"])} />
            <SelectField label="Principal dificuldade" value={form.mainDifficulty} options={DIFFICULTY_OPTIONS} onChange={value => updateField("mainDifficulty", value as FormState["mainDifficulty"])} />
            <div className="grid gap-4 md:col-span-2 md:grid-cols-2">
              <TextAreaField label="Preferências alimentares" value={form.dietaryPreferences} onChange={value => updateField("dietaryPreferences", value)} placeholder="Ex.: comida caseira, vegetariano, café da manhã simples" />
              <TextAreaField label="Restrições alimentares" value={form.dietaryRestrictions} onChange={value => updateField("dietaryRestrictions", value)} placeholder="Ex.: lactose, glúten, amendoim" />
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button className="h-11 rounded-full px-6" disabled={completeOnboarding.isPending} type="submit">
            {completeOnboarding.isPending ? "Calculando..." : "Concluir onboarding"}
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </form>
    </DashboardLayout>
  );
}

function TextField({ label, value, onChange, inputMode, suffix, type = "text" }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  suffix?: string;
  type?: React.HTMLInputTypeAttribute;
}) {
  return (
    <div className="space-y-2 rounded-2xl border bg-background p-4">
      <Label>{label}</Label>
      <div className="flex items-center gap-3">
        <Input type={type} inputMode={inputMode} value={value} onChange={event => onChange(event.target.value)} />
        {suffix ? <span className="text-sm text-muted-foreground">{suffix}</span> : null}
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
    <div className="space-y-2 rounded-2xl border bg-background p-4">
      <Label>{label}</Label>
      <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={value} onChange={event => onChange(event.target.value)}>
        {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </div>
  );
}

function TextAreaField({ label, value, onChange, placeholder }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <div className="space-y-2 rounded-2xl border bg-background p-4">
      <Label>{label}</Label>
      <Textarea value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} />
    </div>
  );
}
