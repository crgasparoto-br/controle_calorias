import React, { useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import PageIntro from "@/components/PageIntro";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  assessNutritionGoalTargets,
} from "@shared/nutritionSafety";
import type { NutritionGoalSafetyIssue } from "@shared/nutritionSafety";
import { SAFE_NUTRITION_MESSAGES } from "@shared/safeMessages";
import {
  formatCalories,
  formatDecimalInputPtBr,
  formatGrams,
  formatIntegerPtBr,
  formatPercentPtBr,
  parseDecimalInputPtBr,
  parseIntegerInputPtBr,
} from "@/lib/numberFormat";
import { trpc } from "@/lib/trpc";
import { AlertCircle, CalendarRange, Goal, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";

type MacroInputMode = "grams" | "percent";
type DurationType = "1_week" | "2_weeks" | "3_weeks" | "always";

type GoalTargetBase = {
  calories: number;
  proteinGrams: number;
  carbsGrams: number;
  fatGrams: number;
};

type GoalTargetForm = GoalTargetBase & {
  inputMode: MacroInputMode;
  proteinPercent: number;
  carbsPercent: number;
  fatPercent: number;
};

type GoalExceptionForm = GoalTargetForm & {
  id?: number;
  weekday: number;
  durationType: DurationType;
};

type GoalExceptionQuery = {
  id?: number;
  weekday: number;
  durationType: DurationType;
  calories: number;
  proteinGrams: number;
  carbsGrams: number;
  fatGrams: number;
  isActive?: boolean;
  updatedAt?: Date | string | number | null;
  effectiveFrom?: Date | string | number | null;
};

type MacroPercentField = "proteinPercent" | "carbsPercent" | "fatPercent";
type MacroGramField = "proteinGrams" | "carbsGrams" | "fatGrams";

type GoalPayload = {
  calories: number;
  proteinGrams: number;
  carbsGrams: number;
  fatGrams: number;
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

const DEFAULT_GOAL_BASE: GoalTargetBase = {
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

function roundToOneDecimal(value: number) {
  return Math.round(value * 10) / 10;
}

function derivePercentagesFromGoal(goal: GoalTargetBase) {
  const proteinCalories = goal.proteinGrams * 4;
  const carbsCalories = goal.carbsGrams * 4;
  const fatCalories = goal.fatGrams * 9;
  const totalMacroCalories = proteinCalories + carbsCalories + fatCalories;

  if (!totalMacroCalories) {
    return {
      proteinPercent: 0,
      carbsPercent: 0,
      fatPercent: 0,
    };
  }

  const proteinPercent = roundToOneDecimal((proteinCalories / totalMacroCalories) * 100);
  const carbsPercent = roundToOneDecimal((carbsCalories / totalMacroCalories) * 100);
  const fatPercent = roundToOneDecimal(Math.max(0, 100 - proteinPercent - carbsPercent));

  return {
    proteinPercent,
    carbsPercent,
    fatPercent,
  };
}

function applyPercentagesToGoal(goal: GoalTargetForm, percentages: Pick<GoalTargetForm, MacroPercentField>): GoalTargetForm {
  const calories = Math.max(0, goal.calories);
  const proteinPercent = roundToOneDecimal(percentages.proteinPercent);
  const carbsPercent = roundToOneDecimal(percentages.carbsPercent);
  const fatPercent = roundToOneDecimal(percentages.fatPercent);

  return {
    ...goal,
    proteinPercent,
    carbsPercent,
    fatPercent,
    proteinGrams: Math.round((calories * (proteinPercent / 100)) / 4),
    carbsGrams: Math.round((calories * (carbsPercent / 100)) / 4),
    fatGrams: Math.round((calories * (fatPercent / 100)) / 9),
  };
}

function createGoalTargetForm(goal: GoalTargetBase, inputMode: MacroInputMode = "grams"): GoalTargetForm {
  const percentages = derivePercentagesFromGoal(goal);
  const form = {
    ...goal,
    inputMode,
    ...percentages,
  };

  return inputMode === "percent" ? applyPercentagesToGoal(form, percentages) : form;
}

function buildException(weekday: number): GoalExceptionForm {
  return {
    weekday,
    durationType: "always",
    ...createGoalTargetForm(DEFAULT_GOAL_BASE),
  };
}

function getPercentSum(goal: GoalTargetForm) {
  return roundToOneDecimal(goal.proteinPercent + goal.carbsPercent + goal.fatPercent);
}

function isPercentModeValid(goal: GoalTargetForm) {
  return goal.inputMode !== "percent" || getPercentSum(goal) === 100;
}

function toGoalPayload(goal: GoalTargetForm): GoalPayload {
  return {
    calories: goal.calories,
    proteinGrams: goal.proteinGrams,
    carbsGrams: goal.carbsGrams,
    fatGrams: goal.fatGrams,
  };
}

function normalizeExceptionsForEditing(exceptions: GoalExceptionQuery[]) {
  const editableExceptions = exceptions.some(exception => typeof exception.isActive === "boolean")
    ? exceptions.filter(exception => exception.isActive !== false)
    : exceptions;

  const sorted = editableExceptions.slice().sort((a, b) => {
    const updatedDiff = new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime();
    if (updatedDiff !== 0) return updatedDiff;
    return new Date(b.effectiveFrom ?? 0).getTime() - new Date(a.effectiveFrom ?? 0).getTime();
  });

  const seenWeekdays = new Set<number>();
  return sorted.filter(exception => {
    if (seenWeekdays.has(exception.weekday)) {
      return false;
    }
    seenWeekdays.add(exception.weekday);
    return true;
  });
}

export default function GoalsPage() {
  const utils = trpc.useUtils();
  const goalQuery = trpc.nutrition.goals.get.useQuery();
  const updateGoal = trpc.nutrition.goals.update.useMutation({
    onSuccess: async result => {
      await Promise.all([
        utils.nutrition.goals.get.invalidate(),
        utils.nutrition.dashboard.overview.invalidate(),
        utils.nutrition.dashboard.today.invalidate(),
        utils.nutrition.reports.weekly.invalidate(),
      ]);
      if (result.safetyWarnings.length) {
        toast.warning("Metas salvas. Há alguns pontos para revisar com calma.");
      } else {
        toast.success("Metas atualizadas com sucesso.");
      }
    },
    onError: error => toast.error(error.message || SAFE_NUTRITION_MESSAGES.couldNotUpdateGoals),
  });

  const [defaultGoal, setDefaultGoal] = useState<GoalTargetForm>(() => goalQuery.data ? createGoalTargetForm({
    calories: goalQuery.data.defaultGoal.calories,
    proteinGrams: goalQuery.data.defaultGoal.proteinGrams,
    carbsGrams: goalQuery.data.defaultGoal.carbsGrams,
    fatGrams: goalQuery.data.defaultGoal.fatGrams,
  }, "percent") : createGoalTargetForm(DEFAULT_GOAL_BASE, "percent"));
  const [exceptions, setExceptions] = useState<GoalExceptionForm[]>(() => goalQuery.data ? normalizeExceptionsForEditing(goalQuery.data.exceptions).map(exception => ({
    id: exception.id,
    weekday: exception.weekday,
    durationType: exception.durationType,
    ...createGoalTargetForm({
      calories: exception.calories,
      proteinGrams: exception.proteinGrams,
      carbsGrams: exception.carbsGrams,
      fatGrams: exception.fatGrams,
    }),
  })) : []);

  useEffect(() => {
    if (!goalQuery.data) return;

    setDefaultGoal(createGoalTargetForm({
      calories: goalQuery.data.defaultGoal.calories,
      proteinGrams: goalQuery.data.defaultGoal.proteinGrams,
      carbsGrams: goalQuery.data.defaultGoal.carbsGrams,
      fatGrams: goalQuery.data.defaultGoal.fatGrams,
    }, "percent"));

    setExceptions(normalizeExceptionsForEditing(goalQuery.data.exceptions).map(exception => ({
      id: exception.id,
      weekday: exception.weekday,
      durationType: exception.durationType,
      ...createGoalTargetForm({
        calories: exception.calories,
        proteinGrams: exception.proteinGrams,
        carbsGrams: exception.carbsGrams,
        fatGrams: exception.fatGrams,
      }),
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
  const defaultPercentSum = getPercentSum(defaultGoal);
  const hasInvalidPercentages = !isPercentModeValid(defaultGoal) || exceptions.some(exception => !isPercentModeValid(exception));
  const safetyAssessment = useMemo(() => assessNutritionGoalTargets([
    { label: "Meta geral", ...toGoalPayload(defaultGoal) },
    ...exceptions.map(exception => ({
      label: WEEKDAY_META.find(day => day.weekday === exception.weekday)?.label ?? "Exceção",
      ...toGoalPayload(exception),
    })),
  ]), [defaultGoal, exceptions]);

  function updateGoalTargetField(current: GoalTargetForm, field: keyof GoalPayload, value: number) {
    const nextGoal = { ...current, [field]: value };

    if (field === "calories" && current.inputMode === "percent") {
      return applyPercentagesToGoal(nextGoal, {
        proteinPercent: current.proteinPercent,
        carbsPercent: current.carbsPercent,
        fatPercent: current.fatPercent,
      });
    }

    return {
      ...nextGoal,
      ...derivePercentagesFromGoal(nextGoal),
    };
  }

  function updateGoalTargetPercent(current: GoalTargetForm, field: MacroPercentField, value: number) {
    return applyPercentagesToGoal({ ...current, inputMode: "percent" }, {
      proteinPercent: field === "proteinPercent" ? value : current.proteinPercent,
      carbsPercent: field === "carbsPercent" ? value : current.carbsPercent,
      fatPercent: field === "fatPercent" ? value : current.fatPercent,
    });
  }

  function updateGoalInputMode(current: GoalTargetForm, mode: MacroInputMode) {
    if (mode === current.inputMode) return current;

    if (mode === "percent") {
      return applyPercentagesToGoal({ ...current, inputMode: mode }, {
        proteinPercent: current.proteinPercent,
        carbsPercent: current.carbsPercent,
        fatPercent: current.fatPercent,
      });
    }

    return {
      ...current,
      inputMode: mode,
      ...derivePercentagesFromGoal(current),
    };
  }

  function updateDefaultGoal(field: keyof GoalPayload, value: number) {
    setDefaultGoal(current => updateGoalTargetField(current, field, value));
  }

  function updateDefaultGoalPercent(field: MacroPercentField, value: number) {
    setDefaultGoal(current => updateGoalTargetPercent(current, field, value));
  }

  function updateDefaultInputMode(mode: MacroInputMode) {
    setDefaultGoal(current => updateGoalInputMode(current, mode));
  }

  function updateException(index: number, patch: Partial<GoalExceptionForm>) {
    setExceptions(current => current.map((item, currentIndex) => currentIndex === index ? { ...item, ...patch } : item));
  }

  function updateExceptionField(index: number, field: keyof GoalPayload, value: number) {
    setExceptions(current => current.map((item, currentIndex) => currentIndex === index ? {
      ...item,
      ...updateGoalTargetField(item, field, value),
    } : item));
  }

  function updateExceptionPercent(index: number, field: MacroPercentField, value: number) {
    setExceptions(current => current.map((item, currentIndex) => currentIndex === index ? {
      ...item,
      ...updateGoalTargetPercent(item, field, value),
    } : item));
  }

  function updateExceptionInputMode(index: number, mode: MacroInputMode) {
    setExceptions(current => current.map((item, currentIndex) => currentIndex === index ? {
      ...item,
      ...updateGoalInputMode(item, mode),
    } : item));
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

  function handleSave() {
    if (hasInvalidPercentages) {
      toast.error("Quando o modo percentual estiver ativo, a soma de proteínas, carboidratos e gorduras precisa fechar em 100%.");
      return;
    }

    if (safetyAssessment.blockers.length) {
      toast.error(safetyAssessment.blockers[0].message);
      return;
    }

    updateGoal.mutate({
      defaultGoal: toGoalPayload(defaultGoal),
      exceptions: exceptions.map(exception => ({
        weekday: exception.weekday,
        durationType: exception.durationType,
        ...toGoalPayload(exception),
      })),
    });
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <PageIntro
          eyebrow="Planejamento nutricional"
          title="Metas e exceções da semana"
          description="Defina a meta usada na maior parte dos dias e ajuste somente os dias que precisam de valores diferentes. As metas salvas passam a valer a partir de hoje e aparecem no dashboard e nos relatórios."
          actions={(
            <Button
              className="rounded-full"
              type="button"
              variant="outline"
              onClick={addException}
              disabled={!availableWeekdays.length}
            >
              <Plus className="mr-2 h-4 w-4" />
              Adicionar exceção
            </Button>
          )}
          stats={(
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <IntroStat
                label="Meta de hoje"
                value={todayGoal.label}
                supporting={formatCalories(todayGoal.calories)}
              />
              <IntroStat
                label="Exceções ativas"
                value={String(exceptions.length)}
                supporting={exceptions.length ? "dias com meta própria" : "todos os dias usam a meta geral"}
              />
              <IntroStat
                label="Meta geral"
                value={formatCalories(defaultGoal.calories)}
                supporting={`${formatGrams(defaultGoal.proteinGrams)} de proteína por dia`}
              />
              <IntroStat
                label="Calorias na semana"
                value={formatCalories(weeklyTotals.calories)}
                supporting="planejamento de segunda a domingo"
              />
            </div>
          )}
        />

        <div className="grid gap-6 xl:grid-cols-[1.5fr,1fr]">
          <div className="space-y-6">
            <Card className="border-0 shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-xl">
                  <Goal className="h-5 w-5 text-primary" />
                  Meta geral da semana
                </CardTitle>
                <CardDescription>
                  Use esta meta como referência para os dias sem exceção. Preencha os macronutrientes em gramas ou por percentual das calorias e revise os avisos antes de salvar.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <ModeSelector mode={defaultGoal.inputMode} onChange={updateDefaultInputMode} />
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <FormattedField label="Calorias" value={defaultGoal.calories} onChange={value => updateDefaultGoal("calories", value)} suffix="kcal" />
                  <MacroField
                    label="Proteínas"
                    mode={defaultGoal.inputMode}
                    grams={defaultGoal.proteinGrams}
                    percent={defaultGoal.proteinPercent}
                    onGramChange={value => updateDefaultGoal("proteinGrams", value)}
                    onPercentChange={value => updateDefaultGoalPercent("proteinPercent", value)}
                  />
                  <MacroField
                    label="Carboidratos"
                    mode={defaultGoal.inputMode}
                    grams={defaultGoal.carbsGrams}
                    percent={defaultGoal.carbsPercent}
                    onGramChange={value => updateDefaultGoal("carbsGrams", value)}
                    onPercentChange={value => updateDefaultGoalPercent("carbsPercent", value)}
                  />
                  <MacroField
                    label="Gorduras"
                    mode={defaultGoal.inputMode}
                    grams={defaultGoal.fatGrams}
                    percent={defaultGoal.fatPercent}
                    onGramChange={value => updateDefaultGoal("fatGrams", value)}
                    onPercentChange={value => updateDefaultGoalPercent("fatPercent", value)}
                  />
                </div>
                <PercentValidationNote mode={defaultGoal.inputMode} percentSum={defaultPercentSum} />
                <NutritionSafetyNotice issues={safetyAssessment.issues} />
                <p className="text-xs text-muted-foreground">Metas muito extremas são bloqueadas para proteger sua saúde. Ajuste esses valores antes de salvar.</p>
              </CardContent>
            </Card>

            <Card className="border-0 shadow-sm">
              <CardHeader>
                <CardTitle>Exceções por dia da semana</CardTitle>
                <CardDescription>
                  Use exceções para dias com uma rotina diferente, como treino, descanso ou compromisso especial. Escolha o dia e por quanto tempo essa meta própria deve valer a partir de hoje.
                </CardDescription>
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
                      <div className="mt-4 space-y-4">
                        <ModeSelector mode={exception.inputMode} onChange={mode => updateExceptionInputMode(index, mode)} />
                        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                          <FormattedField label="Calorias" value={exception.calories} onChange={value => updateExceptionField(index, "calories", value)} suffix="kcal" />
                          <MacroField
                            label="Proteínas"
                            mode={exception.inputMode}
                            grams={exception.proteinGrams}
                            percent={exception.proteinPercent}
                            onGramChange={value => updateExceptionField(index, "proteinGrams", value)}
                            onPercentChange={value => updateExceptionPercent(index, "proteinPercent", value)}
                          />
                          <MacroField
                            label="Carboidratos"
                            mode={exception.inputMode}
                            grams={exception.carbsGrams}
                            percent={exception.carbsPercent}
                            onGramChange={value => updateExceptionField(index, "carbsGrams", value)}
                            onPercentChange={value => updateExceptionPercent(index, "carbsPercent", value)}
                          />
                          <MacroField
                            label="Gorduras"
                            mode={exception.inputMode}
                            grams={exception.fatGrams}
                            percent={exception.fatPercent}
                            onGramChange={value => updateExceptionField(index, "fatGrams", value)}
                            onPercentChange={value => updateExceptionPercent(index, "fatPercent", value)}
                          />
                        </div>
                        <PercentValidationNote mode={exception.inputMode} percentSum={getPercentSum(exception)} />
                      </div>
                    </div>
                  );
                }) : (
                  <div className="rounded-3xl border border-dashed bg-muted/20 p-6 text-sm text-muted-foreground">
                    Nenhuma exceção adicionada. A meta geral será usada em todos os dias da semana.
                  </div>
                )}

                <Button
                  className="rounded-full"
                  disabled={updateGoal.isPending}
                  onClick={handleSave}
                >
                  <Save className="mr-2 h-4 w-4" />
                  {updateGoal.isPending ? "Salvando..." : "Salvar metas"}
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
                  Confira como a meta geral e as exceções ficam distribuídas de segunda-feira a domingo.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid auto-cols-[minmax(10rem,1fr)] grid-flow-col gap-3 overflow-x-auto pb-2 xl:grid-flow-row xl:grid-cols-8 xl:overflow-visible xl:pb-0">
                  {previewDays.map(day => (
                    <div key={day.weekday} className="min-w-0 rounded-2xl border border-l-4 border-l-emerald-500 bg-background p-3">
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate font-medium tracking-tight">{day.label}</p>
                          <span className="rounded-full bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">{day.shortLabel}</span>
                        </div>
                        <p className="min-h-10 text-sm leading-5 text-foreground">
                          {day.source === "exception" ? "Usa uma meta própria neste dia." : "Usa a meta geral."}
                        </p>
                      </div>
                      <div className="mt-3 space-y-1 text-sm text-foreground">
                        <p>{formatCalories(day.calories)}</p>
                        <p>{formatGrams(day.proteinGrams)} proteína</p>
                        <p>{formatGrams(day.carbsGrams)} carbo</p>
                        <p>{formatGrams(day.fatGrams)} gordura</p>
                      </div>
                    </div>
                  ))}
                  <div className="min-w-0 rounded-2xl border border-l-4 border-l-emerald-500 bg-background p-3">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate font-medium tracking-tight">Total</p>
                        <span className="rounded-full bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">sem.</span>
                      </div>
                      <p className="min-h-10 text-sm leading-5 text-foreground">
                        Soma das metas planejadas para a semana.
                      </p>
                    </div>
                    <div className="mt-3 space-y-1 text-sm text-foreground">
                      <p>{formatCalories(weeklyTotals.calories)}</p>
                      <p>{formatGrams(weeklyTotals.proteinGrams)} proteína</p>
                      <p>{formatGrams(weeklyTotals.carbsGrams)} carbo</p>
                      <p>{formatGrams(weeklyTotals.fatGrams)} gordura</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-0 shadow-sm">
              <CardHeader>
                <CardTitle>Foco do dia atual</CardTitle>
                <CardDescription>
                  Veja qual meta vale para hoje, considerando a meta geral e qualquer exceção ativa para este dia.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="rounded-3xl bg-muted/30 p-5">
                  <p className="text-sm text-muted-foreground">Meta ativa hoje</p>
                  <p className="mt-2 text-3xl font-semibold tracking-tight">{todayGoal.label}</p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {formatCalories(todayGoal.calories)} planejadas para hoje {todayGoal.source === "exception" ? "por uma exceção deste dia" : "pela meta geral"}.
                  </p>
                </div>
                <div className="grid gap-3">
                  <MacroSplit label="Proteínas" value={todayGoal.proteinGrams} calorieFactor={4} accent="bg-emerald-500" />
                  <MacroSplit label="Carboidratos" value={todayGoal.carbsGrams} calorieFactor={4} accent="bg-sky-500" />
                  <MacroSplit label="Gorduras" value={todayGoal.fatGrams} calorieFactor={9} accent="bg-amber-500" />
                </div>
                <div className="rounded-3xl border bg-background p-4 shadow-sm">
                  <p className="text-sm text-muted-foreground">Conferência entre calorias e macros</p>
                  <p className="mt-2 text-3xl font-semibold tracking-tight">{formatCalories(weeklyMacroCalories)}</p>
                  <p className="mt-2 text-sm text-muted-foreground">Calorias estimadas a partir das proteínas, carboidratos e gorduras planejados para a semana.</p>
                  <Progress className="mt-4 h-2" value={alignment} />
                  <p className="mt-3 text-sm text-muted-foreground">{formatPercentPtBr(alignment)}% de proximidade entre as calorias informadas e os macronutrientes planejados.</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}

function NutritionSafetyNotice({ issues }: { issues: NutritionGoalSafetyIssue[] }) {
  if (!issues.length) return null;

  const blockers = issues.filter(issue => issue.severity === "block");
  const warnings = issues.filter(issue => issue.severity === "warning");

  return (
    <div className={`rounded-2xl border p-4 text-sm ${blockers.length ? "border-destructive/30 bg-destructive/5 text-destructive" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
      <div className="flex items-start gap-3">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="space-y-2">
          <p className="font-medium tracking-tight">Revisão de segurança nutricional</p>
          <p className={blockers.length ? "text-destructive" : "text-amber-800"}>
            {blockers.length
              ? "Alguns valores precisam ser ajustados antes de salvar."
              : "A meta pode ser salva, mas há pontos que valem uma revisão tranquila."}
          </p>
          <ul className="space-y-1">
            {[...blockers, ...warnings].slice(0, 4).map(issue => (
              <li key={`${issue.code}-${issue.targetLabel}-${issue.message}`}>{issue.message}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function ModeSelector({ mode, onChange }: { mode: MacroInputMode; onChange: (mode: MacroInputMode) => void }) {
  return (
    <div className="rounded-2xl border bg-background p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-medium tracking-tight">Como preencher os macronutrientes</p>
          <p className="text-sm text-muted-foreground">Use gramas quando já souber os valores. Use percentual das calorias do dia quando quiser dividir a meta entre proteínas, carboidratos e gorduras.</p>
        </div>
        <div className="flex rounded-full bg-muted p-1">
          <button
            type="button"
            className={`rounded-full px-4 py-2 text-sm transition ${mode === "grams" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground"}`}
            onClick={() => onChange("grams")}
          >
            Por gramas
          </button>
          <button
            type="button"
            className={`rounded-full px-4 py-2 text-sm transition ${mode === "percent" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground"}`}
            onClick={() => onChange("percent")}
          >
            Por percentual
          </button>
        </div>
      </div>
    </div>
  );
}

function MacroField({
  label,
  mode,
  grams,
  percent,
  onGramChange,
  onPercentChange,
}: {
  label: string;
  mode: MacroInputMode;
  grams: number;
  percent: number;
  onGramChange: (value: number) => void;
  onPercentChange: (value: number) => void;
}) {
  const formattedPercent = formatDecimalInputPtBr(percent, 1);
  const [percentInputValue, setPercentInputValue] = useState(formattedPercent);
  const [isPercentFocused, setIsPercentFocused] = useState(false);

  useEffect(() => {
    if (!isPercentFocused) {
      setPercentInputValue(formattedPercent);
    }
  }, [formattedPercent, isPercentFocused]);

  function handlePercentChange(value: string) {
    setPercentInputValue(value);
    onPercentChange(parseDecimalInputPtBr(value));
  }

  function handlePercentBlur() {
    setIsPercentFocused(false);
    setPercentInputValue(formatDecimalInputPtBr(percent, 1));
  }

  return (
    <div className="space-y-2 rounded-2xl border bg-background p-4">
      <Label>{label}</Label>
      <div className="flex items-center gap-3">
        {mode === "grams" ? (
          <Input
            type="text"
            inputMode="numeric"
            value={formatIntegerPtBr(grams)}
            onChange={event => onGramChange(parseIntegerInputPtBr(event.target.value))}
          />
        ) : (
          <Input
            type="text"
            inputMode="decimal"
            value={percentInputValue}
            onFocus={() => setIsPercentFocused(true)}
            onChange={event => handlePercentChange(event.target.value)}
            onBlur={handlePercentBlur}
          />
        )}
        <span className="text-sm text-muted-foreground">{mode === "grams" ? "g" : "%"}</span>
      </div>
      {mode === "percent" ? (
        <p className="text-xs text-muted-foreground">Calculado automaticamente: {formatGrams(grams)}</p>
      ) : (
        <p className="text-xs text-muted-foreground">Informe a quantidade planejada em gramas.</p>
      )}
    </div>
  );
}

function FormattedField({
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
        <Input
          type="text"
          inputMode="numeric"
          value={formatIntegerPtBr(value)}
          onChange={event => onChange(parseIntegerInputPtBr(event.target.value))}
        />
        <span className="text-sm text-muted-foreground">{suffix}</span>
      </div>
    </div>
  );
}

function PercentValidationNote({ mode, percentSum }: { mode: MacroInputMode; percentSum: number }) {
  if (mode !== "percent") return null;

  const isValid = percentSum === 100;

  return (
    <div className={`rounded-2xl border p-4 text-sm ${isValid ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-destructive/30 bg-destructive/5 text-destructive"}`}>
      <div className="flex items-start gap-3">
        <AlertCircle className="mt-0.5 h-4 w-4" />
        <div>
          <p className="font-medium tracking-tight">Distribuição dos macronutrientes</p>
          <p>
            A soma atual é de <strong>{formatPercentPtBr(percentSum, 1)}%</strong>. Para salvar por percentual, proteínas, carboidratos e gorduras precisam somar exatamente <strong>100%</strong>.
          </p>
        </div>
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
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-medium tracking-tight">{label}</p>
          <p className="text-sm text-muted-foreground">Total planejado para a semana.</p>
        </div>
        <span className="rounded-full bg-background px-3 py-1 text-xs font-medium text-muted-foreground">sem.</span>
      </div>
      <p className="mt-3 text-sm text-muted-foreground">{value}</p>
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
        <p className="text-sm text-muted-foreground">{formatGrams(value)}</p>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{formatCalories(value * calorieFactor)} planejadas a partir deste macronutriente.</p>
    </div>
  );
}

function IntroStat({ label, value, supporting }: { label: string; value: string; supporting: string }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-background px-4 py-3">
      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-xl font-semibold tracking-tight text-foreground">{value}</p>
      <p className="mt-1 text-sm text-muted-foreground">{supporting}</p>
    </div>
  );
}
