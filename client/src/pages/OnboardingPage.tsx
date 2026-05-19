import { useAuth } from "@/_core/hooks/useAuth";
import React, { useMemo, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatNumberPtBr, parseDecimalInputPtBr } from "@/lib/numberFormat";
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

const OPTIONAL_ONBOARDING_FALLBACK = {
  name: "Usuário",
  birthDate: "1990-01-01",
  heightCm: 170,
  currentWeightKg: 70,
} as const;

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

function joinList(value: string[] | null | undefined) {
  return value?.join(", ") ?? "";
}

function parseOptionalDecimalInput(value: string) {
  if (!value.trim()) return undefined;
  return parseDecimalInputPtBr(value);
}

function parseHeightInputToCentimeters(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const directDecimal = trimmed.replace(/\s/g, "").replace(",", ".");
  const parsed = /^\d+(\.\d+)?$/.test(directDecimal)
    ? Number(directDecimal)
    : parseDecimalInputPtBr(trimmed);

  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  if (parsed < 3) return Math.round(parsed * 1000) / 10;
  return parsed;
}

function formatHeightInputFromCentimeters(value: number | null | undefined) {
  if (!value) return "";
  if (value >= 100) {
    return formatNumberPtBr(value / 100, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
  return formatNumberPtBr(value, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function formatWeightInput(value: number | null | undefined) {
  if (!value) return "";
  return formatNumberPtBr(value, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  });
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
  const [savedProfileApplied, setSavedProfileApplied] = useState(false);
  const [form, setForm] = useState<FormState>(() => ({
    ...initialForm,
    name: user?.name?.trim() ?? "",
  }));

  const savedProfileQuery = trpc.nutrition.onboarding.profile.useQuery();
  const userName = user?.name?.trim() ?? "";

  React.useEffect(() => {
    const profile = savedProfileQuery.data;
    if (!profile || savedProfileApplied) return;

    setForm({
      name: profile.name || userName,
      birthDate: profile.birthDate ?? "",
      heightCm: formatHeightInputFromCentimeters(profile.heightCm),
      currentWeightKg: formatWeightInput(profile.currentWeightKg),
      objective: profile.objective,
      activityLevel: profile.activityLevel,
      trackingExperience: profile.trackingExperience,
      dietaryPreferences: joinList(profile.dietaryPreferences),
      dietaryRestrictions: joinList(profile.dietaryRestrictions),
      eatingRoutine: profile.eatingRoutine,
      mainDifficulty: profile.mainDifficulty,
    });
    setNameEdited(Boolean(profile.name));
    setSavedProfileApplied(true);
  }, [savedProfileApplied, savedProfileQuery.data, userName]);

  React.useEffect(() => {
    if (!nameEdited && userName && !form.name.trim()) {
      setForm(current => ({ ...current, name: userName }));
    }
  }, [form.name, nameEdited, userName]);

  const calculatedAgeYears = useMemo(() => calculateAgeYears(form.birthDate), [form.birthDate]);

  const parsed = useMemo(() => ({
    name: form.name.trim(),
    birthDate: form.birthDate,
    heightCm: parseHeightInputToCentimeters(form.heightCm),
    currentWeightKg: parseOptionalDecimalInput(form.currentWeightKg),
    objective: form.objective,
    activityLevel: form.activityLevel,
    trackingExperience: form.trackingExperience,
    dietaryPreferences: splitList(form.dietaryPreferences),
    dietaryRestrictions: splitList(form.dietaryRestrictions),
    eatingRoutine: form.eatingRoutine,
    mainDifficulty: form.mainDifficulty,
  }), [form]);

  const validationMessage = useMemo(() => {
    if (parsed.name && parsed.name.length < 2) return "Informe um nome com pelo menos 2 caracteres ou deixe o campo em branco.";
    if (parsed.birthDate && calculatedAgeYears === null) return "Informe uma data de nascimento válida ou deixe o campo em branco.";
    if (calculatedAgeYears !== null && (calculatedAgeYears < 13 || calculatedAgeYears > 120)) return "A idade calculada deve estar entre 13 e 120 anos.";
    if (form.heightCm.trim() && parsed.heightCm === undefined) return "Informe uma altura válida ou deixe o campo em branco.";
    if (parsed.heightCm !== undefined && (parsed.heightCm < 100 || parsed.heightCm > 250)) return "Informe uma altura válida entre 1,00 m e 2,50 m, ou deixe o campo em branco.";
    if (parsed.currentWeightKg !== undefined && (parsed.currentWeightKg < 25 || parsed.currentWeightKg > 350)) return "Informe um peso atual válido ou deixe o campo em branco.";
    return null;
  }, [calculatedAgeYears, form.heightCm, parsed]);

  const payload = useMemo(() => ({
    name: parsed.name || userName || OPTIONAL_ONBOARDING_FALLBACK.name,
    birthDate: parsed.birthDate || OPTIONAL_ONBOARDING_FALLBACK.birthDate,
    heightCm: parsed.heightCm ?? OPTIONAL_ONBOARDING_FALLBACK.heightCm,
    currentWeightKg: parsed.currentWeightKg ?? OPTIONAL_ONBOARDING_FALLBACK.currentWeightKg,
    objective: parsed.objective,
    activityLevel: parsed.activityLevel,
    trackingExperience: parsed.trackingExperience,
    dietaryPreferences: parsed.dietaryPreferences,
    dietaryRestrictions: parsed.dietaryRestrictions,
    eatingRoutine: parsed.eatingRoutine,
    mainDifficulty: parsed.mainDifficulty,
  }), [parsed, userName]);

  const completeOnboarding = trpc.nutrition.onboarding.complete.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.nutrition.onboarding.profile.invalidate(),
        utils.nutrition.goals.get.invalidate(),
        utils.nutrition.dashboard.overview.invalidate(),
        utils.nutrition.reports.weekly.invalidate(),
      ]);
      toast.success("Perfil salvo com sucesso.");
      setLocation("/");
    },
    onError: error => toast.error(error.message || "Não foi possível salvar o onboarding."),
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
    completeOnboarding.mutate(payload);
  }

  return (
    <DashboardLayout>
      <form className="mx-auto grid w-full max-w-7xl gap-6 px-1" onSubmit={handleSubmit}>
        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <UserRound className="h-5 w-5 text-primary" />
              Onboarding nutricional
            </CardTitle>
            <CardDescription>
              Os blocos estão expandidos e todos os campos podem ser preenchidos agora ou ajustados depois.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5 lg:grid-cols-2 xl:grid-cols-3">
            <TextField label="Nome" value={form.name} onChange={value => updateField("name", value)} optional />
            <TextField label="Data de nascimento" type="date" value={form.birthDate} onChange={value => updateField("birthDate", value)} optional />
            <ReadOnlyField label="Idade calculada" value={calculatedAgeYears === null ? "Preencha se quiser calcular" : `${calculatedAgeYears} anos`} />
            <TextField label="Altura" suffix="m ou cm" inputMode="decimal" value={form.heightCm} onChange={value => updateField("heightCm", value)} optional placeholder="Ex.: 1,72 ou 172" />
            <TextField label="Peso atual" suffix="kg" inputMode="decimal" value={form.currentWeightKg} onChange={value => updateField("currentWeightKg", value)} optional placeholder="Ex.: 72,5 ou 72.5" />
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-primary" />
              Rotina e objetivo
            </CardTitle>
            <CardDescription>
              As opções já vêm selecionadas para permitir salvar rapidamente, mas você pode alterá-las quando quiser.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5 lg:grid-cols-2 xl:grid-cols-3">
            <SelectField label="Objetivo" value={form.objective} options={OBJECTIVE_OPTIONS} onChange={value => updateField("objective", value as FormState["objective"])} />
            <SelectField label="Nível de atividade física" value={form.activityLevel} options={ACTIVITY_OPTIONS} onChange={value => updateField("activityLevel", value as FormState["activityLevel"])} />
            <SelectField label="Experiência com controle alimentar" value={form.trackingExperience} options={EXPERIENCE_OPTIONS} onChange={value => updateField("trackingExperience", value as FormState["trackingExperience"])} />
            <SelectField label="Rotina alimentar" value={form.eatingRoutine} options={ROUTINE_OPTIONS} onChange={value => updateField("eatingRoutine", value as FormState["eatingRoutine"])} />
            <SelectField label="Principal dificuldade" value={form.mainDifficulty} options={DIFFICULTY_OPTIONS} onChange={value => updateField("mainDifficulty", value as FormState["mainDifficulty"])} />
            <div className="grid gap-5 lg:col-span-2 xl:col-span-3 xl:grid-cols-2">
              <TextAreaField label="Preferências alimentares" value={form.dietaryPreferences} onChange={value => updateField("dietaryPreferences", value)} placeholder="Ex.: comida caseira, vegetariano, café da manhã simples" optional />
              <TextAreaField label="Restrições alimentares" value={form.dietaryRestrictions} onChange={value => updateField("dietaryRestrictions", value)} placeholder="Ex.: lactose, glúten, amendoim" optional />
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button className="h-11 rounded-full px-6" disabled={completeOnboarding.isPending} type="submit">
            {completeOnboarding.isPending ? "Salvando..." : "Salvar onboarding"}
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </form>
    </DashboardLayout>
  );
}

function FieldLabel({ label, optional = false }: { label: string; optional?: boolean }) {
  return (
    <Label className="flex items-center justify-between gap-3">
      <span>{label}</span>
      {optional ? <span className="text-xs font-normal text-muted-foreground">Opcional</span> : null}
    </Label>
  );
}

function TextField({ label, value, onChange, inputMode, suffix, type = "text", optional = false, placeholder }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  suffix?: string;
  type?: React.HTMLInputTypeAttribute;
  optional?: boolean;
  placeholder?: string;
}) {
  return (
    <div className="min-w-0 space-y-2 rounded-2xl border bg-background p-5">
      <FieldLabel label={label} optional={optional} />
      <div className="flex items-center gap-3">
        <Input type={type} inputMode={inputMode} value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} />
        {suffix ? <span className="shrink-0 text-sm text-muted-foreground">{suffix}</span> : null}
      </div>
    </div>
  );
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 space-y-2 rounded-2xl border bg-muted/20 p-5">
      <Label>{label}</Label>
      <div className="flex h-10 items-center rounded-md border border-input bg-background px-3 text-sm font-medium text-foreground">
        {value}
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
    <div className="min-w-0 space-y-2 rounded-2xl border bg-background p-5">
      <Label>{label}</Label>
      <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={value} onChange={event => onChange(event.target.value)}>
        {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </div>
  );
}

function TextAreaField({ label, value, onChange, placeholder, optional = false }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  optional?: boolean;
}) {
  return (
    <div className="min-w-0 space-y-2 rounded-2xl border bg-background p-5">
      <FieldLabel label={label} optional={optional} />
      <Textarea value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} />
    </div>
  );
}
