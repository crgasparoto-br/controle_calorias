import React, { useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { trpc } from "@/lib/trpc";
import { CalendarRange, Goal, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";

type GoalTargetForm = {
  calories: number;
  proteinGrams: number;
  carbsGrams: number;
  fatGrams: number;
};

type DurationType = "1_week" | "2_weeks" | "3_weeks" | "always";

type GoalExceptionForm = GoalTargetForm & {
  id?: number;
  weekday: number;
  durationType: DurationType;
};

const WEEKDAY_META = [
  { weekday: 0, label: "Segunda-feira", shortLabel: "seg." },
  { weekday: 1, label: "Terça-feira", shortLabel: "ter." },
  { weekday: 2, label: "Quarta-feira", shortLabel: "qua." },
  { weekday: 3, label: "Quinta-feira", shortLabel: "qui." },
  { weekday: 4, label: "Sexta-feira", shortLabel: "sex." },
  { weekday: 5, label: "Sábado", shortLabel: "sáb." },
  { weekday: 6, label: "Domingo", shortLabel: "dom." },
] as const;

const DEFAULT_GOAL: GoalTargetForm = {
  calories: 2200,
  proteinGrams: 160,
  carbsGrams: 240,
  fatGrams: 70,
};

const DURATION_OPTIONS: Array<{ value: DurationType; label: string }> = [
  { value: "1_week", label: "Por 1 semana" },
  { value: "2_weeks", label: "Por 2 semanas" },
  { value: "3_weeks", label: "Por 3 semanas" },
  { value: "always", label: "Sempre" },
];

function getWeekdayIndex(date: Date) {
  return (date.getDay() + 6) % 7;
}

function buildException(weekday: number): GoalExceptionForm {
  return {
    weekday,
    durationType: "always",
    ...DEFAULT_GOAL,
  };
}

export default function GoalsPage() {
  const utils = trpc.useUtils();
  const goalQuery = trpc.nutrition.goals.get.useQuery();
  const updateGoal = trpc.nutrition.goals.update.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.nutrition.goals.get.invalidate(),
        utils.nutrition.dashboard.overview.invalidate(),
        utils.nutrition.reports.weekly.invalidate(),
      ]);
      toast.success("Meta padrão e exceções atualizadas com sucesso.");
    },
    onError: error => toast.error(error.message || "Falha ao atualizar metas."),
  });

  const [defaultGoal, setDefaultGoal] = useState<GoalTargetForm>(() => goalQuery.data ? {
    calories: goalQuery.data.defaultGoal.calories,
    proteinGrams: goalQuery.data.defaultGoal.proteinGrams,
    carbsGrams: goalQuery.data.defaultGoal.carbsGrams,
    fatGrams: goalQuery.data.defaultGoal.fatGrams,
  } : DEFAULT_GOAL);
  const [exceptions, setExceptions] = useState<GoalExceptionForm[]>(() => goalQuery.data ? goalQuery.data.exceptions.map(exception => ({
    id: exception.id,
    weekday: exception.weekday,
    durationType: exception.durationType,
    calories: exception.calories,
    proteinGrams: exception.proteinGrams,
    carbsGrams: exception.carbsGrams,
    fatGrams: exception.fatGrams,
  })) : []);

  useEffect(() => {
    if (!goalQuery.data) return;

    setDefaultGoal({
      calories: goalQuery.data.defaultGoal.calories,
      proteinGrams: goalQuery.data.defaultGoal.proteinGrams,
      carbsGrams: goalQuery.data.defaultGoal.carbsGrams,
      fatGrams: goalQuery.data.defaultGoal.fatGrams,
    });

    setExceptions(goalQuery.data.exceptions.map(exception => ({
      id: exception.id,
      weekday: exception.weekday,
      durationType: exception.durationType,
      calories: exception.calories,
      proteinGrams: exception.proteinGrams,
      carbsGrams: exception.carbsGrams,
      fatGrams: exception.fatGrams,
    })));
  }, [goalQuery.data]);

  const previewDays = useMemo(() => WEEKDAY_META.map(day => {
    const exception = exceptions.find(item => item.weekday === day.weekday);
    const applied = exception ?? defaultGoal;
    return {
      ...day,
      calories: applied.calories,
      proteinGrams: applied.proteinGrams,
      carbsGrams: applied.carbsGrams,
      fatGrams: applied.fatGrams,
      source: exception ? "exception" : "default",
      durationType: exception?.durationType,
    };
  }), [defaultGoal, exceptions]);

  const weeklyTotals = useMemo(() => previewDays.reduce(
    (acc, day) => {
      acc.calories += day.calories;
      acc.proteinGrams += day.proteinGrams;
      acc.carbsGrams += day.carbsGrams;
      acc.fatGrams += day.fatGrams;
      return acc;
    },
    { calories: 0, proteinGrams: 0, carbsGrams: 0, fatGrams: 0 },
  ), [previewDays]);

  const weeklyMacroCalories = weeklyTotals.proteinGrams * 4 + weeklyTotals.carbsGrams * 4 + weeklyTotals.fatGrams * 9;
  const alignment = weeklyTotals.calories ? Math.min((weeklyMacroCalories / weeklyTotals.calories) * 100, 140) : 0;
  const todayGoal = previewDays[getWeekdayIndex(new Date())] ?? previewDays[0];
  const availableWeekdays = WEEKDAY_META.filter(day => !exceptions.some(exception => exception.weekday === day.weekday));

  function updateDefaultGoal(field: keyof GoalTargetForm, value: number) {
    setDefaultGoal(current => ({ ...current, [field]: value }));
  }

  function updateException(index: number, patch: Partial<GoalExceptionForm>) {
    setExceptions(current => current.map((item, currentIndex) => currentIndex === index ? { ...item, ...patch } : item));
  }

  function removeException(index: number) {
    setExceptions(current => current.filter((_, currentIndex) => currentIndex !== index));
  }

  function addException() {
    const nextDay = availableWeekdays[0];
    if (!nextDay) {
      toast.error("Todos os dias da semana já possuem exceção configurada.");
      return;
    }
    setExceptions(current => [...current, buildException(nextDay.weekday)]);
  }

  return (
    <DashboardLayout>
      <div className="grid gap-6 xl:grid-cols-[1.5fr,1fr]">
        <div className="space-y-6">
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl">
                <Goal className="h-5 w-5 text-primary" />
                Meta geral da semana
              </CardTitle>
              <CardDescription>
                Defina uma regra base válida para todos os dias. Depois, se quiser, trate apenas alguns dias como exceção.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Field label="Calorias" value={defaultGoal.calories} onChange={value => updateDefaultGoal("calories", value)} suffix="kcal" />
              <Field label="Proteínas" value={defaultGoal.proteinGrams} onChange={value => updateDefaultGoal("proteinGrams", value)} suffix="g" />
              <Field label="Carboidratos" value={defaultGoal.carbsGrams} onChange={value => updateDefaultGoal("carbsGrams", value)} suffix="g" />
              <Field label="Gorduras" value={defaultGoal.fatGrams} onChange={value => updateDefaultGoal("fatGrams", value)} suffix="g" />
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between gap-4">
              <div>
                <CardTitle>Exceções por dia da semana</CardTitle>
                <CardDescription>
                  Escolha apenas os dias que precisam sair da meta geral e por quanto tempo essa exceção deve valer.
                </CardDescription>
              </div>
              <Button className="rounded-full" type="button" variant="outline" onClick={addException}>
                <Plus className="mr-2 h-4 w-4" />
                Adicionar exceção
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              {exceptions.length ? exceptions.map((exception, index) => {
                const selectedWeekdays = new Set(exceptions.map(item => item.weekday));
                const weekdayOptions = WEEKDAY_META.filter(day => day.weekday === exception.weekday || !selectedWeekdays.has(day.weekday));
                return (
                  <div key={`${exception.weekday}-${index}`} className="rounded-3xl border bg-muted/20 p-4">
                    <div className="grid gap-3 lg:grid-cols-[1fr,1fr,auto] lg:items-end">
                      <SelectField
                        label="Dia da exceção"
                        value={String(exception.weekday)}
                        options={weekdayOptions.map(day => ({ value: String(day.weekday), label: day.label }))}
                        onChange={value => updateException(index, { weekday: Number(value) })}
                      />
                      <SelectField
                        label="Duração"
                        value={exception.durationType}
                        options={DURATION_OPTIONS.map(option => ({ value: option.value, label: option.label }))}
                        onChange={value => updateException(index, { durationType: value as DurationType })}
                      />
                      <Button type="button" variant="ghost" className="rounded-full text-destructive hover:text-destructive" onClick={() => removeException(index)}>
                        <Trash2 className="mr-2 h-4 w-4" />
                        Remover
                      </Button>
                    </div>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      <Field label="Calorias" value={exception.calories} onChange={value => updateException(index, { calories: value })} suffix="kcal" />
                      <Field label="Proteínas" value={exception.proteinGrams} onChange={value => updateException(index, { proteinGrams: value })} suffix="g" />
                      <Field label="Carboidratos" value={exception.carbsGrams} onChange={value => updateException(index, { carbsGrams: value })} suffix="g" />
                      <Field label="Gorduras" value={exception.fatGrams} onChange={value => updateException(index, { fatGrams: value })} suffix="g" />
                    </div>
                  </div>
                );
              }) : (
                <div className="rounded-3xl border border-dashed bg-muted/20 p-6 text-sm text-muted-foreground">
                  Nenhuma exceção cadastrada. Neste caso, a meta geral será aplicada a todos os dias da semana.
                </div>
              )}

              <Button
                className="rounded-full"
                disabled={updateGoal.isPending}
                onClick={() => updateGoal.mutate({ defaultGoal, exceptions })}
              >
                <Save className="mr-2 h-4 w-4" />
                {updateGoal.isPending ? "Salvando..." : "Salvar regra geral e exceções"}
              </Button>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6">
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CalendarRange className="h-5 w-5 text-primary" />
                Soma planejada da semana
              </CardTitle>
              <CardDescription>
                A semana segue de segunda-feira a domingo, somando a meta geral com as exceções ativas no planejamento.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3">
                {previewDays.map(day => (
                  <div key={day.weekday} className="rounded-2xl border bg-muted/20 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-medium tracking-tight">{day.label}</p>
                        <p className="text-sm text-muted-foreground">
                          {day.source === "exception" ? "Exceção aplicada neste dia." : "Usando a meta geral."}
                        </p>
                      </div>
                      <span className="rounded-full bg-background px-3 py-1 text-xs font-medium text-muted-foreground">{day.shortLabel}</span>
                    </div>
                    <p className="mt-3 text-sm text-muted-foreground">
                      {Math.round(day.calories)} kcal · {Math.round(day.proteinGrams)} g proteína · {Math.round(day.carbsGrams)} g carbo · {Math.round(day.fatGrams)} g gordura
                    </p>
                  </div>
                ))}
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                <SummaryTile label="Calorias semanais" value={`${Math.round(weeklyTotals.calories)} kcal`} />
                <SummaryTile label="Proteínas na semana" value={`${Math.round(weeklyTotals.proteinGrams)} g`} />
                <SummaryTile label="Carboidratos na semana" value={`${Math.round(weeklyTotals.carbsGrams)} g`} />
                <SummaryTile label="Gorduras na semana" value={`${Math.round(weeklyTotals.fatGrams)} g`} />
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle>Foco do dia atual</CardTitle>
              <CardDescription>
                Meta efetiva usada hoje no dashboard e nos relatórios, considerando a regra geral e as exceções vigentes.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="rounded-3xl bg-muted/30 p-5">
                <p className="text-sm text-muted-foreground">Meta ativa hoje</p>
                <p className="mt-2 text-3xl font-semibold tracking-tight">{todayGoal.label}</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  {Math.round(todayGoal.calories)} kcal planejadas para o dia {todayGoal.source === "exception" ? "com exceção ativa" : "pela regra geral"}.
                </p>
              </div>
              <div className="grid gap-3">
                <MacroSplit label="Proteínas" value={todayGoal.proteinGrams} calorieFactor={4} accent="bg-emerald-500" />
                <MacroSplit label="Carboidratos" value={todayGoal.carbsGrams} calorieFactor={4} accent="bg-sky-500" />
                <MacroSplit label="Gorduras" value={todayGoal.fatGrams} calorieFactor={9} accent="bg-amber-500" />
              </div>
              <div className="rounded-3xl border bg-background p-4 shadow-sm">
                <p className="text-sm text-muted-foreground">Consistência energética da semana</p>
                <p className="mt-2 text-3xl font-semibold tracking-tight">{Math.round(weeklyMacroCalories)} kcal</p>
                <p className="mt-2 text-sm text-muted-foreground">Equivalente calórico estimado a partir dos macronutrientes planejados para a semana atual.</p>
                <Progress className="mt-4 h-2" value={alignment} />
                <p className="mt-3 text-sm text-muted-foreground">{Math.round(alignment)}% de alinhamento entre macros e calorias planejadas.</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}

function Field({
  label,
  value,
  onChange,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  suffix: string;
}) {
  return (
    <div className="space-y-2 rounded-2xl border bg-background p-4">
      <Label>{label}</Label>
      <div className="flex items-center gap-3">
        <Input type="number" value={value} onChange={event => onChange(Number(event.target.value))} />
        <span className="text-sm text-muted-foreground">{suffix}</span>
      </div>
    </div>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2 rounded-2xl border bg-background p-4">
      <Label>{label}</Label>
      <select
        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
        value={value}
        onChange={event => onChange(event.target.value)}
      >
        {options.map(option => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </div>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border bg-muted/20 p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
    </div>
  );
}

function MacroSplit({
  label,
  value,
  calorieFactor,
  accent,
}: {
  label: string;
  value: number;
  calorieFactor: number;
  accent: string;
}) {
  return (
    <div className="rounded-2xl border bg-background p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className={`h-3 w-3 rounded-full ${accent}`} />
          <p className="font-medium tracking-tight">{label}</p>
        </div>
        <p className="text-sm text-muted-foreground">{Math.round(value)} g</p>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{Math.round(value * calorieFactor)} kcal atribuídas a este macronutriente.</p>
    </div>
  );
}
