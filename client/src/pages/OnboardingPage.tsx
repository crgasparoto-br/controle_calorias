import { useAuth } from "@/_core/hooks/useAuth";
import PageIntro from "@/components/PageIntro";
import DashboardLayout from "@/components/DashboardLayout";
import ProfessionalProfileSettings from "@/components/ProfessionalProfileSettings";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { formatNumberPtBr, parseDecimalInputPtBr } from "@/lib/numberFormat";
import { trpc } from "@/lib/trpc";
import { Activity, ArrowRight, Clock3, MessageCircle, Plus, Save, Stethoscope, Target, Trash2, UserRound } from "lucide-react";
import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

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

const MEAL_LABEL_SUGGESTIONS = [
  "café da manhã",
  "almoço",
  "lanche da tarde",
  "pré-treino",
  "pós-treino",
  "jantar",
  "ceia",
  "outro",
] as const;

const DEFAULT_MEAL_SCHEDULES: MealScheduleState[] = [
  { mealLabel: "café da manhã", startTime: "05:00", endTime: "10:59", enabled: true },
  { mealLabel: "almoço", startTime: "11:00", endTime: "14:59", enabled: true },
  { mealLabel: "lanche da tarde", startTime: "15:00", endTime: "17:29", enabled: true },
  { mealLabel: "pré-treino", startTime: "17:30", endTime: "18:29", enabled: true },
  { mealLabel: "jantar", startTime: "18:30", endTime: "22:59", enabled: true },
  { mealLabel: "ceia", startTime: "23:00", endTime: "04:59", enabled: true },
];

const OPTIONAL_ONBOARDING_FALLBACK = {
  name: "Usuário",
  birthDate: "1990-01-01",
  heightCm: 170,
  currentWeightKg: 70,
} as const;

type MealScheduleState = {
  mealLabel: string;
  startTime: string;
  endTime: string;
  enabled: boolean;
};

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

function hasInvalidScheduleTime(schedules: MealScheduleState[]) {
  return schedules.some(
    schedule => !/^([01]\d|2[0-3]):[0-5]\d$/.test(schedule.startTime) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(schedule.endTime),
  );
}

function createNewMealSchedule(): MealScheduleState {
  return { mealLabel: "", startTime: "12:00", endTime: "12:59", enabled: true };
}

function phoneDigits(value: string) {
  return value.replace(/\D/g, "");
}

function hasValidWhatsappPhone(value: string) {
  const digits = phoneDigits(value);
  return digits.length >= 10 && digits.length <= 13;
}

function formatPhoneNumber(value: string) {
  const trimmed = value.trim();
  const digits = phoneDigits(trimmed);
  if (!digits) return "";

  if (digits.length === 13 && digits.startsWith("55")) {
    return `+55 (${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9)}`;
  }

  if (digits.length === 12 && digits.startsWith("55")) {
    return `+55 (${digits.slice(2, 4)}) ${digits.slice(4, 8)}-${digits.slice(8)}`;
  }

  if (digits.length === 11) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  }

  if (digits.length === 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }

  return trimmed;
}

export default function OnboardingPage() {
  const utils = trpc.useUtils();
  const { user } = useAuth();
  const [nameEdited, setNameEdited] = useState(false);
  const [savedProfileApplied, setSavedProfileApplied] = useState(false);
  const [schedulesApplied, setSchedulesApplied] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [sendWhatsappGreeting, setSendWhatsappGreeting] = useState(false);
  const [acceptedOperationalWhatsappGreeting, setAcceptedOperationalWhatsappGreeting] = useState(false);
  const [mealSchedules, setMealSchedules] = useState<MealScheduleState[]>(DEFAULT_MEAL_SCHEDULES);
  const [form, setForm] = useState<FormState>(() => ({
    ...initialForm,
    name: user?.name?.trim() ?? "",
  }));

  const whatsappStatusQuery = trpc.nutrition.whatsapp.status.useQuery();
  const savedProfileQuery = trpc.nutrition.onboarding.profile.useQuery();
  const mealSchedulesQuery = trpc.nutrition.mealSchedules.list.useQuery();
  const professionalProfileQuery = trpc.nutrition.professionals.profile.useQuery(undefined, { retry: false });
  const userName = user?.name?.trim() ?? "";
  const userEmail = user?.email?.trim() ?? "";
  const whatsappPhoneNumber = whatsappStatusQuery.data?.connection?.phoneNumber ?? "";
  const hasWhatsappConnection = Boolean(whatsappPhoneNumber);
  const canEditPhone = !hasWhatsappConnection;
  const shouldAttachWhatsappPhone = canEditPhone && Boolean(phoneNumber.trim());
  const contactPhoneNumber = formatPhoneNumber(hasWhatsappConnection ? whatsappPhoneNumber : phoneNumber);

  useEffect(() => {
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

  useEffect(() => {
    if (!nameEdited && userName && !form.name.trim()) {
      setForm(current => ({ ...current, name: userName }));
    }
  }, [form.name, nameEdited, userName]);

  useEffect(() => {
    if (!mealSchedulesQuery.data || schedulesApplied) return;
    setMealSchedules(mealSchedulesQuery.data as MealScheduleState[]);
    setSchedulesApplied(true);
  }, [mealSchedulesQuery.data, schedulesApplied]);

  useEffect(() => {
    setPhoneNumber(whatsappPhoneNumber);
    if (!whatsappPhoneNumber) {
      setSendWhatsappGreeting(false);
      setAcceptedOperationalWhatsappGreeting(false);
    }
  }, [whatsappPhoneNumber]);

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
    if (shouldAttachWhatsappPhone && !hasValidWhatsappPhone(phoneNumber)) return "Informe um telefone válido para vincular ao WhatsApp.";
    if ((shouldAttachWhatsappPhone || sendWhatsappGreeting) && !acceptedOperationalWhatsappGreeting) return "Autorize o contato operacional pelo WhatsApp para receber a saudação.";
    return null;
  }, [acceptedOperationalWhatsappGreeting, calculatedAgeYears, form.heightCm, parsed, phoneNumber, sendWhatsappGreeting, shouldAttachWhatsappPhone]);

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

  const sendWhatsappGreetingMutation = trpc.auth.sendWhatsappGreeting?.useMutation?.() ?? {
    isPending: false,
    mutateAsync: async () => ({ status: "skipped" as const, reason: "no_phone" as const, detail: "Saudação indisponível neste ambiente." }),
  };
  const saveWhatsappConnection = trpc.nutrition.whatsapp.upsertConnection.useMutation({
    onSuccess: async () => {
      await utils.nutrition.whatsapp.status.invalidate();
    },
  });

  async function sendGreetingToast() {
    const greeting = await sendWhatsappGreetingMutation.mutateAsync({ acceptedOperationalWhatsapp: true });
    if (greeting.status === "sent") {
      toast.success("Saudação enviada pelo WhatsApp.");
    } else if (greeting.reason === "duplicate") {
      toast.success("Saudação pelo WhatsApp já havia sido enviada.");
    } else {
      toast.error(greeting.detail || "Perfil salvo, mas a saudação não foi enviada pelo WhatsApp.");
    }
  }

  const completeOnboarding = trpc.nutrition.onboarding.complete.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.nutrition.onboarding.profile.invalidate(),
        utils.nutrition.goals.get.invalidate(),
        utils.nutrition.dashboard.overview.invalidate(),
        utils.nutrition.dashboard.today.invalidate(),
        utils.nutrition.reports.weekly.invalidate(),
      ]);

      if (shouldAttachWhatsappPhone) {
        try {
          await saveWhatsappConnection.mutateAsync({
            phoneNumber: phoneNumber.trim(),
            displayName: payload.name,
          });
          await sendGreetingToast();
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Perfil salvo, mas não foi possível vincular o telefone ao WhatsApp.");
          return;
        }
      } else if (sendWhatsappGreeting && acceptedOperationalWhatsappGreeting && hasWhatsappConnection) {
        try {
          await sendGreetingToast();
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Perfil salvo, mas a saudação não foi enviada pelo WhatsApp.");
        }
      }

      toast.success("Perfil salvo com sucesso.");
    },
    onError: error => toast.error(error.message || "Não foi possível salvar as configurações."),
  });

  const updateMealSchedules = trpc.nutrition.mealSchedules.update.useMutation({
    onSuccess: async () => {
      await utils.nutrition.mealSchedules.list.invalidate();
      toast.success("Refeições habituais salvas com sucesso.");
    },
    onError: error => toast.error(error.message || "Não foi possível salvar as refeições habituais."),
  });

  function updateField<K extends keyof FormState>(field: K, value: FormState[K]) {
    if (field === "name") setNameEdited(true);
    setForm(current => ({ ...current, [field]: value }));
  }

  function updateSchedule<K extends keyof MealScheduleState>(index: number, field: K, value: MealScheduleState[K]) {
    setMealSchedules(current => current.map((schedule, currentIndex) => currentIndex === index ? { ...schedule, [field]: value } : schedule));
  }

  function handleSaveProfile() {
    if (validationMessage) {
      toast.error(validationMessage);
      return;
    }
    completeOnboarding.mutate(payload);
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    handleSaveProfile();
  }

  function handleSaveMealSchedules() {
    const normalizedSchedules = mealSchedules.map(schedule => ({ ...schedule, mealLabel: schedule.mealLabel.trim() }));
    if (normalizedSchedules.some(schedule => !schedule.mealLabel)) {
      toast.error("Informe o nome de todas as refeições habituais.");
      return;
    }
    if (hasInvalidScheduleTime(normalizedSchedules)) {
      toast.error("Revise os horários das refeições habituais. Use o formato HH:mm.");
      return;
    }
    updateMealSchedules.mutate({ schedules: normalizedSchedules });
  }

  const activeSchedules = mealSchedules.filter(schedule => schedule.enabled).length;
  const professionalProfileActive = Boolean(professionalProfileQuery.data?.active);
  const isSavingProfile = completeOnboarding.isPending || saveWhatsappConnection.isPending || sendWhatsappGreetingMutation.isPending;
  const completionStats = (
    <div className="grid gap-3 sm:grid-cols-4">
      <IntroStat label="Perfil" value={form.name.trim() ? "preenchido" : "pendente"} helper={calculatedAgeYears === null ? "idade opcional" : `${calculatedAgeYears} anos`} />
      <IntroStat label="Objetivo" value={OBJECTIVE_OPTIONS.find(option => option.value === form.objective)?.label ?? "definido"} helper={ACTIVITY_OPTIONS.find(option => option.value === form.activityLevel)?.label ?? "rotina"} />
      <IntroStat label="Refeições" value={`${activeSchedules} ativas`} helper={`${mealSchedules.length} faixas configuradas`} />
      <IntroStat label="Profissional" value={professionalProfileActive ? "ativo" : "inativo"} helper="módulo nutricionista" />
    </div>
  );

  return (
    <DashboardLayout>
      <form className="mx-auto flex w-full max-w-7xl flex-col gap-6" onSubmit={handleSubmit}>
        <PageIntro
          eyebrow="Configurações"
          title="Ajuste seu perfil sem se perder em blocos longos"
          description="Organizamos a tela em etapas curtas para reduzir rolagem, facilitar revisões rápidas e deixar as refeições habituais mais simples de manter no dia a dia."
          stats={completionStats}
          actions={
            <Button className="h-11 rounded-full px-5" disabled={isSavingProfile} type="submit">
              {isSavingProfile ? "Salvando..." : "Salvar configurações"}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          }
        />

        {validationMessage ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {validationMessage}
          </div>
        ) : null}

        <Tabs defaultValue="perfil" className="gap-4">
          <TabsList className="grid h-auto w-full grid-cols-1 gap-2 rounded-2xl bg-muted/60 p-2 md:grid-cols-4">
            <TabsTrigger className="min-h-11 rounded-xl" value="perfil">
              <UserRound className="h-4 w-4" />
              Perfil
            </TabsTrigger>
            <TabsTrigger className="min-h-11 rounded-xl" value="objetivos">
              <Target className="h-4 w-4" />
              Objetivos e rotina
            </TabsTrigger>
            <TabsTrigger className="min-h-11 rounded-xl" value="refeicoes">
              <Clock3 className="h-4 w-4" />
              Refeições habituais
            </TabsTrigger>
            <TabsTrigger className="min-h-11 rounded-xl" value="profissional">
              <Stethoscope className="h-4 w-4" />
              Profissional
            </TabsTrigger>
          </TabsList>

          <TabsContent value="perfil" className="space-y-4">
            <Card defaultOpen className="border-0 shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-xl">
                  <UserRound className="h-5 w-5 text-primary" />
                  Identificação e base física
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
                  <TextField label="Nome" value={form.name} onChange={value => updateField("name", value)} optional />
                  {canEditPhone ? (
                    <TextField
                      label="Telefone para WhatsApp"
                      value={phoneNumber}
                      onChange={setPhoneNumber}
                      optional
                      inputMode="tel"
                      placeholder="Ex.: 5511999998888"
                    />
                  ) : (
                    <ReadOnlyField label="Telefone" value={contactPhoneNumber || "Não informado"} />
                  )}
                  <ReadOnlyField label="E-mail" value={userEmail || "Não informado"} />
                  <TextField label="Data de nascimento" type="date" value={form.birthDate} onChange={value => updateField("birthDate", value)} optional />
                  <ReadOnlyField label="Idade calculada" value={calculatedAgeYears === null ? "Preencha se quiser calcular" : `${calculatedAgeYears} anos`} />
                  <TextField label="Altura" suffix="m ou cm" inputMode="decimal" value={form.heightCm} onChange={value => updateField("heightCm", value)} optional placeholder="Ex.: 1,72 ou 172" />
                  <TextField label="Peso atual" suffix="kg" inputMode="decimal" value={form.currentWeightKg} onChange={value => updateField("currentWeightKg", value)} optional placeholder="Ex.: 72,5" />
                </div>
                <div className="flex justify-end">
                  <Button type="button" className="rounded-full" disabled={isSavingProfile} onClick={handleSaveProfile}>
                    <Save className="mr-2 h-4 w-4" />
                    {isSavingProfile ? "Salvando perfil..." : "Salvar perfil"}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {hasWhatsappConnection || shouldAttachWhatsappPhone ? (
              <Card className="border-0 shadow-sm">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-xl">
                    <MessageCircle className="h-5 w-5 text-primary" />
                    Saudação pelo WhatsApp
                  </CardTitle>
                  <CardDescription>
                    {shouldAttachWhatsappPhone
                      ? "Ao salvar este telefone pela primeira vez, enviaremos uma mensagem única de boas-vindas para confirmar o canal."
                      : "Envie uma mensagem única de boas-vindas para reforçar que este é o canal rápido para registrar refeições, água e exercícios."}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {hasWhatsappConnection ? (
                    <ConsentToggle
                      checked={sendWhatsappGreeting}
                      onChange={setSendWhatsappGreeting}
                      label="Enviar saudação de boas-vindas pelo WhatsApp após salvar."
                      description={`Será enviada para ${contactPhoneNumber}.`}
                    />
                  ) : null}
                  <ConsentToggle
                    checked={acceptedOperationalWhatsappGreeting}
                    disabled={hasWhatsappConnection && !sendWhatsappGreeting}
                    onChange={setAcceptedOperationalWhatsappGreeting}
                    label="Autorizo o contato operacional pelo WhatsApp para receber esta saudação."
                    description={shouldAttachWhatsappPhone ? `Será enviada para ${contactPhoneNumber}.` : "Este aceite é separado de marketing e não habilita disparos recorrentes."}
                  />
                </CardContent>
              </Card>
            ) : null}
          </TabsContent>

          <TabsContent value="objetivos">
            <Card defaultOpen className="border-0 shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-xl">
                  <Activity className="h-5 w-5 text-primary" />
                  Objetivos, rotina e contexto alimentar
                </CardTitle>
                <CardDescription>
                  Agrupamos as decisões de rotina em uma única superfície para deixar a leitura mais rápida em desktop e tablet.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
                  <SelectField label="Objetivo" value={form.objective} options={OBJECTIVE_OPTIONS} onChange={value => updateField("objective", value as FormState["objective"])} />
                  <SelectField label="Nível de atividade física" value={form.activityLevel} options={ACTIVITY_OPTIONS} onChange={value => updateField("activityLevel", value as FormState["activityLevel"])} />
                  <SelectField label="Experiência com controle alimentar" value={form.trackingExperience} options={EXPERIENCE_OPTIONS} onChange={value => updateField("trackingExperience", value as FormState["trackingExperience"])} />
                  <SelectField label="Rotina alimentar" value={form.eatingRoutine} options={ROUTINE_OPTIONS} onChange={value => updateField("eatingRoutine", value as FormState["eatingRoutine"])} />
                  <SelectField label="Principal dificuldade" value={form.mainDifficulty} options={DIFFICULTY_OPTIONS} onChange={value => updateField("mainDifficulty", value as FormState["mainDifficulty"])} />
                </div>
                <div className="grid gap-4 xl:grid-cols-2">
                  <TextAreaField label="Preferências alimentares" value={form.dietaryPreferences} onChange={value => updateField("dietaryPreferences", value)} placeholder="Ex.: comida caseira, vegetariano, café da manhã simples" optional />
                  <TextAreaField label="Restrições alimentares" value={form.dietaryRestrictions} onChange={value => updateField("dietaryRestrictions", value)} placeholder="Ex.: lactose, glúten, amendoim" optional />
                </div>
                <div className="flex justify-end">
                  <Button type="button" className="rounded-full" disabled={isSavingProfile} onClick={handleSaveProfile}>
                    <Save className="mr-2 h-4 w-4" />
                    {isSavingProfile ? "Salvando objetivos..." : "Salvar objetivos e rotina"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="refeicoes">
            <Card defaultOpen className="border-0 shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-xl">
                  <Clock3 className="h-5 w-5 text-primary" />
                  Refeições habituais
                </CardTitle>
                <CardDescription>
                  Os horários foram compactados em linhas editáveis para evitar cartões dentro de cartões e reduzir rolagem desnecessária.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 lg:grid-cols-[1.3fr_1fr]">
                  <div className="rounded-2xl border bg-muted/20 p-4 text-sm leading-6 text-muted-foreground">
                    Crie refeições com nomes livres, como “lanche da tarde”, “pré-treino”, “pós-treino” ou “ceia”. O registro usa esses horários para sugerir automaticamente a refeição mais adequada.
                  </div>
                  <div className="rounded-2xl border bg-background p-4">
                    <p className="text-sm font-medium tracking-tight">Resumo rápido</p>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <InlineMetric label="Faixas ativas" value={String(activeSchedules)} />
                      <InlineMetric label="Total configurado" value={String(mealSchedules.length)} />
                    </div>
                  </div>
                </div>

                <div className="grid gap-3">
                  {mealSchedules.map((schedule, index) => (
                    <div key={`${schedule.mealLabel}-${index}`} className="grid gap-3 rounded-2xl border bg-background p-4 lg:grid-cols-[minmax(0,1.2fr)_140px_140px_auto_auto] lg:items-center">
                      <div className="space-y-2">
                        <FieldLabel label={`Refeição ${index + 1}`} />
                        <Input
                          value={schedule.mealLabel}
                          onChange={event => updateSchedule(index, "mealLabel", event.target.value)}
                          placeholder="Ex.: lanche da tarde"
                          list="meal-label-suggestions"
                        />
                      </div>
                      <TextField compact label="Início" type="time" value={schedule.startTime} onChange={value => updateSchedule(index, "startTime", value)} />
                      <TextField compact label="Fim" type="time" value={schedule.endTime} onChange={value => updateSchedule(index, "endTime", value)} />
                      <label className="flex h-11 items-center justify-center gap-2 rounded-xl border px-3 text-sm font-medium">
                        <Checkbox checked={schedule.enabled} onCheckedChange={value => updateSchedule(index, "enabled", Boolean(value))} />
                        Ativa
                      </label>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-11 w-11 rounded-xl text-destructive hover:text-destructive"
                        disabled={mealSchedules.length <= 1}
                        onClick={() => setMealSchedules(current => current.filter((_, currentIndex) => currentIndex !== index))}
                        aria-label="Remover refeição habitual"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>

                <datalist id="meal-label-suggestions">
                  {MEAL_LABEL_SUGGESTIONS.map(label => <option key={label} value={label} />)}
                </datalist>

                <div className="flex flex-wrap justify-end gap-2">
                  <Button type="button" variant="outline" className="rounded-full" onClick={() => setMealSchedules(current => [...current, createNewMealSchedule()])} disabled={mealSchedules.length >= 12}>
                    <Plus className="mr-2 h-4 w-4" />
                    Adicionar refeição
                  </Button>
                  <Button type="button" variant="outline" className="rounded-full" onClick={() => setMealSchedules(DEFAULT_MEAL_SCHEDULES)}>
                    Restaurar padrão
                  </Button>
                  <Button type="button" className="rounded-full" disabled={updateMealSchedules.isPending} onClick={handleSaveMealSchedules}>
                    <Save className="mr-2 h-4 w-4" />
                    {updateMealSchedules.isPending ? "Salvando..." : "Salvar horários"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="profissional">
            <ProfessionalProfileSettings />
          </TabsContent>
        </Tabs>
      </form>
    </DashboardLayout>
  );
}

function IntroStat({ label, value, helper }: { label: string; value: string; helper: string }) {
  return (
    <div className="rounded-2xl border bg-background px-4 py-3 shadow-sm">
      <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-base font-semibold tracking-tight">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{helper}</p>
    </div>
  );
}

function InlineMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-muted/20 px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold tracking-tight">{value}</p>
    </div>
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

function ConsentToggle({ checked, onChange, label, description, disabled = false }: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  description: string;
  disabled?: boolean;
}) {
  return (
    <label className={`flex gap-3 rounded-xl border bg-background p-4 text-sm ${disabled ? "opacity-60" : ""}`}>
      <Checkbox checked={checked} disabled={disabled} onCheckedChange={value => onChange(Boolean(value))} />
      <span className="min-w-0">
        <span className="block font-medium leading-5">{label}</span>
        <span className="mt-1 block leading-5 text-muted-foreground">{description}</span>
      </span>
    </label>
  );
}

function TextField({ label, value, onChange, inputMode, suffix, type = "text", optional = false, placeholder, compact = false }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  suffix?: string;
  type?: React.InputHTMLAttributes<HTMLInputElement>["type"];
  optional?: boolean;
  placeholder?: string;
  compact?: boolean;
}) {
  return (
    <div className={`min-w-0 space-y-2 rounded-2xl border ${compact ? "bg-muted/10 p-4" : "bg-background p-5"}`}>
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
      <Textarea value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} className="min-h-28" />
    </div>
  );
}
