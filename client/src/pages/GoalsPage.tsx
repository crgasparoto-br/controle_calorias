import React, { useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import PageIntro from "@/components/PageIntro";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  startDate: string;
};

type GoalExceptionQuery = {
  id?: number;
  weekday: number;
  durationType: DurationType;
  startDate?: string;
  calories: number;
  proteinGrams: number;
  carbsGrams: number;
  fatGrams: number;
  isActive?: boolean;
  updatedAt?: Date | string | number | null;
  effectiveFrom?: Date | string | number | null;
};

type GoalVersionQuery = GoalTargetBase & {
  id: number;
  startDate: string;
  effectiveUntil?: Date | string | number | null;
  isCurrent: boolean;
};

type GoalExceptionVersionQuery = GoalVersionQuery & {
  weekday: number;
  durationType: DurationType;
  label?: string;
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

function toDateInputValue(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateKeyFromDateLike(value?: Date | string | number | null) {
  if (!value) return undefined;
  return new Date(value).toISOString().slice(0, 10);
}

function getWeekdayLabel(weekday: number) {
  return WEEKDAY_META.find(day => day.weekday === weekday)?.label ?? "Dia";
}

function dateKeyToLogicalUtcDate(dateKey: string) {
  return new Date(`${dateKey || toDateInputValue()}T12:00:00Z`);
}

function getUtcWeekdayIndex(date: Date) {
  return (date.getUTCDay() + 6) % 7;
}

function startOfPreviewWeekDateKey(dateKey: string) {
  const value = dateKeyToLogicalUtcDate(dateKey);
  value.setUTCDate(value.getUTCDate() - getUtcWeekdayIndex(value));
  return value.toISOString().slice(0, 10);
}

function addDaysToDateKey(dateKey: string, days: number) {
  const value = dateKeyToLogicalUtcDate(dateKey);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function resolvePreviewException(exceptions: GoalExceptionForm[], weekday: number, dateKey: string) {
  return exceptions
    .filter(exception => exception.weekday === weekday && exception.startDate && exception.startDate <= dateKey)
    .sort((first, second) => second.startDate.localeCompare(first.startDate))[0];
}

function formatMacroSummary(goal: GoalTargetBase) {
  return `${formatGrams(goal.proteinGrams)} prot. | ${formatGrams(goal.carbsGrams)} carbo | ${formatGrams(goal.fatGrams)} gord.`;
}

function formatMacroPercentSummary(goal: Pick<GoalTargetForm, MacroPercentField>) {
  return `${formatPercentPtBr(goal.proteinPercent, 1)} prot. | ${formatPercentPtBr(goal.carbsPercent, 1)} carbo | ${formatPercentPtBr(goal.fatPercent, 1)} gord.`;
}

function getDurationLabel(durationType: DurationType) {
  return DURATION_OPTIONS.find(option => option.value === durationType)?.label ?? "Duração definida";
}

function formatDateKey(dateKey?: string | null) {
  if (!dateKey) return "Sem data";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "UTC",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(`${dateKey}T12:00:00Z`));
}

function formatVersionEndDate(value?: Date | string | number | null) {
  if (!value) return "sem término definido";
  return `até ${formatDateKey(new Date(value).toISOString().slice(0, 10))}`;
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

function buildException(weekday: number, startDate = toDateInputValue()): GoalExceptionForm {
  return {
    weekday,
    startDate,
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

function exceptionVersionKey(exception: Pick<GoalExceptionForm, "weekday" | "startDate">, fallbackStartDate: string) {
  return `${exception.weekday}:${exception.startDate || fallbackStartDate}`;
}

function normalizeExceptionsForEditing(exceptions: GoalExceptionQuery[], fallbackStartDate: string) {
  const editableExceptions = exceptions.some(exception => typeof exception.isActive === "boolean")
    ? exceptions.filter(exception => exception.isActive !== false)
    : exceptions;

  const sorted = editableExceptions.slice().sort((a, b) => {
    const updatedDiff = new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime();
    if (updatedDiff !== 0) return updatedDiff;
    return new Date(b.effectiveFrom ?? 0).getTime() - new Date(a.effectiveFrom ?? 0).getTime();
  });

  const seenVersions = new Set<string>();
  return sorted.filter(exception => {
    const startDate = exception.startDate ?? dateKeyFromDateLike(exception.effectiveFrom) ?? fallbackStartDate;
    const key = `${exception.weekday}:${startDate}`;
    if (seenVersions.has(key)) {
      return false;
    }
    seenVersions.add(key);
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

  const [startDate, setStartDate] = useState(() => goalQuery.data?.startDate ?? toDateInputValue());
  const [defaultGoal, setDefaultGoal] = useState<GoalTargetForm>(() => goalQuery.data ? createGoalTargetForm({
    calories: goalQuery.data.defaultGoal.calories,
    proteinGrams: goalQuery.data.defaultGoal.proteinGrams,
    carbsGrams: goalQuery.data.defaultGoal.carbsGrams,
    fatGrams: goalQuery.data.defaultGoal.fatGrams,
  }, "percent") : createGoalTargetForm(DEFAULT_GOAL_BASE, "percent"));
  const [exceptions, setExceptions] = useState<GoalExceptionForm[]>(() => {
    const fallbackStartDate = goalQuery.data?.startDate ?? toDateInputValue();
    return goalQuery.data ? normalizeExceptionsForEditing(goalQuery.data.exceptions, fallbackStartDate).map(exception => ({
      id: exception.id,
      weekday: exception.weekday,
      startDate: exception.startDate ?? dateKeyFromDateLike(exception.effectiveFrom) ?? fallbackStartDate,
      durationType: exception.durationType,
      ...createGoalTargetForm({
        calories: exception.calories,
        proteinGrams: exception.proteinGrams,
        carbsGrams: exception.carbsGrams,
        fatGrams: exception.fatGrams,
      }),
    })) : [];
  });

  useEffect(() => {
    if (!goalQuery.data) return;

    const fallbackStartDate = goalQuery.data.startDate ?? toDateInputValue();
    setStartDate(fallbackStartDate);
    setDefaultGoal(createGoalTargetForm({
      calories: goalQuery.data.defaultGoal.calories,
      proteinGrams: goalQuery.data.defaultGoal.proteinGrams,
      carbsGrams: goalQuery.data.defaultGoal.carbsGrams,
      fatGrams: goalQuery.data.defaultGoal.fatGrams,
    }, "percent"));

    setExceptions(normalizeExceptionsForEditing(goalQuery.data.exceptions, fallbackStartDate).map(exception => ({
      id: exception.id,
      weekday: exception.weekday,
      startDate: exception.startDate ?? dateKeyFromDateLike(exception.effectiveFrom) ?? fallbackStartDate,
      durationType: exception.durationType,
      ...createGoalTargetForm({
        calories: exception.calories,
        proteinGrams: exception.proteinGrams,
        carbsGrams: exception.carbsGrams,
        fatGrams: exception.fatGrams,
      }),
    })));
  }, [goalQuery.data]);

  const goalVersions = (goalQuery.data?.versions ?? []) as GoalVersionQuery[];
  const exceptionVersions = (goalQuery.data?.exceptionVersions ?? []) as GoalExceptionVersionQuery[];
  const previewWeekStartDate = useMemo(() => startOfPreviewWeekDateKey(startDate), [startDate]);
  const previewWeekEndDate = useMemo(() => addDaysToDateKey(previewWeekStartDate, 6), [previewWeekStartDate]);
  const previewDays = useMemo(() => WEEKDAY_META.map((day, index) => {
    const date = addDaysToDateKey(previewWeekStartDate, index);
    const exception = resolvePreviewException(exceptions, day.weekday, date);
    const applied = exception ?? defaultGoal;
    return {
      ...day,
      date,
      calories: applied.calories,
      proteinGrams: applied.proteinGrams,
      carbsGrams: applied.carbsGrams,
      fatGrams: applied.fatGrams,
      source: exception ? "exception" : "default",
      durationType: exception?.durationType,
      startDate: exception?.startDate,
    };
  }), [defaultGoal, exceptions, previewWeekStartDate]);

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

  const availableWeekdays = WEEKDAY_META;
  const defaultPercentSum = getPercentSum(defaultGoal);
  const hasInvalidPercentages = !isPercentModeValid(defaultGoal) || exceptions.some(exception => !isPercentModeValid(exception));
  const hasExceptionVersionConflict = useMemo(() => {
    const seenVersions = new Set<string>();
    return exceptions.some(exception => {
      const key = exceptionVersionKey(exception, startDate);
      if (seenVersions.has(key)) return true;
      seenVersions.add(key);
      return false;
    });
  }, [exceptions, startDate]);
  const safetyAssessment = useMemo(() => assessNutritionGoalTargets([
    { label: "Meta padrão", ...toGoalPayload(defaultGoal) },
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
      toast.error("Nenhum dia disponível para nova exceção.");
      return;
    }
    setExceptions(current => [...current, buildException(nextDay.weekday, startDate)]);
  }

  function handleSave() {
    if (hasInvalidPercentages) {
      toast.error("Quando o modo percentual estiver ativo, a soma de proteínas, carboidratos e gorduras precisa fechar em 100%.");
      return;
    }

    if (!startDate) {
      toast.error("Informe a data de início da meta geral.");
      return;
    }

    if (exceptions.some(exception => !exception.startDate)) {
      toast.error("Informe a data de início de cada exceção.");
      return;
    }

    if (hasExceptionVersionConflict) {
      toast.error("Há duas exceções para o mesmo dia com a mesma data de início.");
      return;
    }

    if (safetyAssessment.blockers.length) {
      toast.error(safetyAssessment.blockers[0].message);
      return;
    }

    updateGoal.mutate({
      startDate,
      defaultGoal: toGoalPayload(defaultGoal),
      exceptions: exceptions.map(exception => ({
        weekday: exception.weekday,
        startDate: exception.startDate,
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
          title="Metas nutricionais"
          description="Defina a meta padrão de calorias e macronutrientes, acompanhe a distribuição semanal e configure exceções para dias com rotina diferente."
          stats={(
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              <IntroStat
                label="Meta padrão"
                value={formatCalories(defaultGoal.calories)}
                supporting={formatMacroSummary(defaultGoal)}
              />
              <IntroStat
                label="Distribuição dos macros"
                value={formatPercentPtBr(defaultPercentSum, 1)}
                supporting={formatMacroPercentSummary(defaultGoal)}
              />
              <IntroStat
                label="Exceções programadas"
                value={String(exceptions.length)}
                supporting={exceptions.length ? "regras com dia e início próprios" : "meta padrão em todos os dias"}
              />
              <IntroStat
                label="Planejamento semanal"
                value={formatCalories(weeklyTotals.calories)}
                supporting={`${formatDateKey(previewWeekStartDate)} a ${formatDateKey(previewWeekEndDate)}`}
              />
              <IntroStat
                label="Início da meta geral"
                value={formatDateKey(startDate)}
                supporting="data em que a meta padrão passa a valer"
              />
            </div>
          )}
        />

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr),minmax(22rem,0.85fr)]">
          <div className="space-y-6">
            <Card className="border-0 shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-xl">
                  <Goal className="h-5 w-5 text-primary" />
                  Meta padrão
                </CardTitle>
                <CardDescription>
                  Use esta meta como referência para os dias sem exceção. Preencha calorias e macronutrientes, informe a data de início e revise os avisos antes de salvar.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <VersionStartField value={startDate} onChange={setStartDate} />
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
              <CardHeader className="gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-1.5">
                  <CardTitle>Exceções programadas</CardTitle>
                  <CardDescription>
                    Configure regras com dia da semana, data de início e duração para treinos, descanso, fins de semana ou compromissos especiais.
                  </CardDescription>
                </div>
                <Button
                  className="shrink-0 rounded-full"
                  type="button"
                  variant="outline"
                  onClick={addException}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Adicionar exceção
                </Button>
              </CardHeader>
              <CardContent className="space-y-4">
                {hasExceptionVersionConflict ? (
                  <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
                    Há duas exceções para o mesmo dia com a mesma data de início. Altere uma das datas antes de salvar.
                  </div>
                ) : null}

                {exceptions.length ? exceptions.map((exception, index) => (
                  <div key={`${exception.weekday}-${exception.startDate}-${index}`} className="rounded-3xl border bg-muted/20 p-4">
                    <div className="grid gap-3 lg:grid-cols-[1fr,1fr,1fr,auto] lg:items-end">
                      <SelectField
                        label="Dia da exceção"
                        value={String(exception.weekday)}
                        options={WEEKDAY_META.map(day => ({ value: String(day.weekday), label: day.label }))}
                        onChange={value => updateException(index, { weekday: Number(value) })}
                      />
                      <DateField
                        id={`exception-start-date-${index}`}
                        label="Início da exceção"
                        value={exception.startDate}
                        onChange={value => updateException(index, { startDate: value })}
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
                    <div className="mt-3 rounded-2xl bg-background/70 p-3 text-sm text-muted-foreground">
                      <p>
                        {getWeekdayLabel(exception.weekday)} desde {formatDateKey(exception.startDate)} · {getDurationLabel(exception.durationType)}
                      </p>
                      <p className="mt-1 text-foreground">
                        {formatCalories(exception.calories)} · {formatMacroSummary(exception)}
                      </p>
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
                )) : (
                  <div className="rounded-3xl border border-dashed bg-muted/20 p-6 text-sm text-muted-foreground">
                    <p className="font-medium text-foreground">Nenhuma exceção configurada.</p>
                    <p className="mt-1">A meta padrão será usada todos os dias. Use exceções para dias de treino, descanso, fim de semana ou compromissos especiais.</p>
                    <Button className="mt-4 rounded-full" type="button" variant="outline" onClick={addException}>
                      <Plus className="mr-2 h-4 w-4" />
                      Adicionar exceção
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            <Card className="border-0 shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CalendarRange className="h-5 w-5 text-primary" />
                  Prévia da semana
                </CardTitle>
                <CardDescription>
                  Simulação de {formatDateKey(previewWeekStartDate)} a {formatDateKey(previewWeekEndDate)}. Para cada dia, vale a exceção programada mais recente que já iniciou naquela data.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid auto-cols-[minmax(10rem,1fr)] grid-flow-col gap-3 overflow-x-auto pb-2 xl:grid-flow-row xl:grid-cols-3 xl:overflow-visible xl:pb-0">
                  {previewDays.map(day => (
                    <div key={`${day.weekday}-${day.date}`} className="min-w-0 rounded-2xl border border-l-4 border-l-emerald-500 bg-background p-3">
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate font-medium tracking-tight">{day.label}</p>
                          <span className="rounded-full bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">{formatDateKey(day.date)}</span>
                        </div>
                        <p className="min-h-10 text-sm leading-5 text-foreground">
                          {day.source === "exception" ? `Exceção desde ${formatDateKey(day.startDate)}.` : "Usa a meta padrão."}
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
                        <p className="truncate font-medium tracking-tight">Total da Semana</p>
                        <span className="rounded-full bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">sem.</span>
                      </div>
                      <p className="min-h-10 text-sm leading-5 text-foreground">
                        Soma das metas simuladas para a semana de referência.
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
          </div>
        </div>

        <section className="space-y-3">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">Histórico</h2>
            <p className="mt-1 text-sm text-muted-foreground">Consulte versões anteriores e programadas sem misturar histórico com a edição principal.</p>
          </div>
          <div className="grid gap-6 xl:grid-cols-2">
            <GoalVersionHistory versions={goalVersions} selectedStartDate={startDate} />
            <ExceptionVersionHistory versions={exceptionVersions} selectedExceptions={exceptions} />
          </div>
        </section>

        <div className="flex justify-end">
          <Button
            className="rounded-full"
            disabled={updateGoal.isPending}
            onClick={handleSave}
          >
            <Save className="mr-2 h-4 w-4" />
            {updateGoal.isPending ? "Salvando..." : "Salvar metas"}
          </Button>
        </div>
      </div>
    </DashboardLayout>
  );
}

function VersionStartField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="rounded-2xl border bg-background p-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,0.8fr),minmax(0,1.2fr)] lg:items-center">
        <div>
          <p className="font-medium tracking-tight">Data de início da versão</p>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            A meta salva passa a valer a partir desta data. Dias anteriores continuam usando a versão que já estava vigente.
          </p>
        </div>
        <DateField id="goal-start-date" label="Início da meta geral" value={value} onChange={onChange} />
      </div>
    </div>
  );
}

function DateField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="space-y-2 rounded-2xl border bg-background p-4">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="date"
        value={value}
        onChange={event => onChange(event.target.value)}
      />
    </div>
  );
}

function GoalVersionHistory({ versions, selectedStartDate }: { versions: GoalVersionQuery[]; selectedStartDate: string }) {
  return (
    <Card className="border-0 shadow-sm">
      <CardHeader>
        <CardTitle>Versões da meta geral</CardTitle>
        <CardDescription>
          Confira as datas de início já cadastradas para evitar versões duplicadas e entender o histórico aplicado aos dias anteriores.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {versions.length ? versions.map(version => {
          const isSelected = version.startDate === selectedStartDate;
          return (
            <VersionHistoryItem
              key={version.id}
              title={`Início em ${formatDateKey(version.startDate)}`}
              status={isSelected ? "em edição" : version.isCurrent ? "vigente" : "histórica"}
              isSelected={isSelected}
              endDate={version.effectiveUntil}
              version={version}
            />
          );
        }) : (
          <div className="rounded-2xl border border-dashed bg-muted/20 p-4 text-sm leading-6 text-muted-foreground">
            Nenhuma versão salva foi encontrada ainda. Ao salvar a meta, a primeira versão aparecerá aqui com a data de início escolhida.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ExceptionVersionHistory({ versions, selectedExceptions }: { versions: GoalExceptionVersionQuery[]; selectedExceptions: GoalExceptionForm[] }) {
  return (
    <Card className="border-0 shadow-sm">
      <CardHeader>
        <CardTitle>Versões das exceções</CardTitle>
        <CardDescription>
          Acompanhe quando cada exceção começa e termina. Exceções vigentes têm prioridade sobre a meta geral no dia correspondente.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {versions.length ? versions.map(version => {
          const isSelected = selectedExceptions.some(exception => exception.weekday === version.weekday && exception.startDate === version.startDate);
          return (
            <VersionHistoryItem
              key={version.id}
              title={`${getWeekdayLabel(version.weekday)} desde ${formatDateKey(version.startDate)}`}
              status={isSelected ? "em edição" : version.isCurrent ? "vigente" : "histórica"}
              isSelected={isSelected}
              endDate={version.effectiveUntil}
              version={version}
              detail={DURATION_OPTIONS.find(option => option.value === version.durationType)?.label}
            />
          );
        }) : (
          <div className="rounded-2xl border border-dashed bg-muted/20 p-4 text-sm leading-6 text-muted-foreground">
            Nenhuma exceção versionada foi encontrada ainda. Ao salvar uma exceção com data de início, ela aparecerá aqui.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function VersionHistoryItem({
  title,
  status,
  isSelected,
  endDate,
  version,
  detail,
}: {
  title: string;
  status: string;
  isSelected: boolean;
  endDate?: Date | string | number | null;
  version: GoalTargetBase;
  detail?: string;
}) {
  return (
    <div className={`rounded-2xl border bg-background p-4 shadow-sm ${isSelected ? "border-primary/50" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-medium tracking-tight">{title}</p>
          <p className="mt-1 text-xs text-muted-foreground">{formatVersionEndDate(endDate)}</p>
          {detail ? <p className="mt-1 text-xs text-muted-foreground">{detail}</p> : null}
        </div>
        <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
          {status}
        </span>
      </div>
      <div className="mt-3 grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
        <span>{formatCalories(version.calories)}</span>
        <span>{formatGrams(version.proteinGrams)} proteína</span>
        <span>{formatGrams(version.carbsGrams)} carbo</span>
        <span>{formatGrams(version.fatGrams)} gordura</span>
      </div>
    </div>
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
        <p className="text-xs text-muted-foreground">Calculado automaticamente pela meta calórica: {formatGrams(grams)}</p>
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

function IntroStat({ label, value, supporting }: { label: string; value: string; supporting: string }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-background px-4 py-3">
      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-xl font-semibold tracking-tight text-foreground">{value}</p>
      <p className="mt-1 text-sm text-muted-foreground">{supporting}</p>
    </div>
  );
}
