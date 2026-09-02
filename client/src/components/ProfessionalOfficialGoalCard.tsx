import React, { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Plus,
  RotateCcw,
  Stethoscope,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import {
  formatDecimalInputPtBr,
  formatGrams,
  formatPercentPtBr,
  parseDecimalInputPtBr,
} from "@/lib/numberFormat";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export type ProfessionalMacroInputMode = "grams" | "percent";

type ProfessionalMacroPercentField =
  | "proteinPercent"
  | "carbsPercent"
  | "fatPercent";
type ProfessionalMacroGramField =
  | "proteinGrams"
  | "carbsGrams"
  | "fatGrams";
type ProfessionalGoalValueField = "calories" | ProfessionalMacroGramField;

export type ProfessionalOfficialGoalTarget = {
  calories: string;
  proteinGrams: string;
  carbsGrams: string;
  fatGrams: string;
  inputMode: ProfessionalMacroInputMode;
  proteinPercent: number;
  carbsPercent: number;
  fatPercent: number;
};

export type ProfessionalOfficialGoalDraftException =
  ProfessionalOfficialGoalTarget & {
    weekday: number;
    durationType: "1_week" | "2_weeks" | "3_weeks" | "always";
  };

const emptyTarget: ProfessionalOfficialGoalTarget = {
  calories: "",
  proteinGrams: "",
  carbsGrams: "",
  fatGrams: "",
  inputMode: "grams",
  proteinPercent: 0,
  carbsPercent: 0,
  fatPercent: 0,
};

export type ProfessionalOfficialGoalDraft = {
  target: ProfessionalOfficialGoalTarget;
  effectiveFrom: string;
  justification: string;
  includeExerciseCalories: boolean;
  exceptions: ProfessionalOfficialGoalDraftException[];
  sourceGoalId: string | null;
  touched: boolean;
};

export function createEmptyProfessionalOfficialGoalDraft(): ProfessionalOfficialGoalDraft {
  return {
    target: { ...emptyTarget },
    effectiveFrom: new Date().toISOString().slice(0, 10),
    justification: "",
    includeExerciseCalories: true,
    exceptions: [],
    sourceGoalId: null,
    touched: false,
  };
}

function roundToOneDecimal(value: number) {
  return Math.round(value * 10) / 10;
}

function macroPercentagesFromGoal(
  goal: Pick<
    ProfessionalOfficialGoalTarget,
    "proteinGrams" | "carbsGrams" | "fatGrams"
  >
) {
  const proteinCalories = Number(goal.proteinGrams) * 4;
  const carbsCalories = Number(goal.carbsGrams) * 4;
  const fatCalories = Number(goal.fatGrams) * 9;
  const totalMacroCalories = proteinCalories + carbsCalories + fatCalories;

  if (!totalMacroCalories) {
    return {
      proteinPercent: 0,
      carbsPercent: 0,
      fatPercent: 0,
    };
  }

  const proteinPercent = roundToOneDecimal(
    (proteinCalories / totalMacroCalories) * 100
  );
  const carbsPercent = roundToOneDecimal(
    (carbsCalories / totalMacroCalories) * 100
  );
  const fatPercent = roundToOneDecimal(
    Math.max(0, 100 - proteinPercent - carbsPercent)
  );

  return {
    proteinPercent,
    carbsPercent,
    fatPercent,
  };
}

function normalizeGoalTarget(
  target: ProfessionalOfficialGoalTarget
): ProfessionalOfficialGoalTarget {
  const stored = target as Partial<ProfessionalOfficialGoalTarget>;
  const base = {
    calories: stored.calories ?? "",
    proteinGrams: stored.proteinGrams ?? "",
    carbsGrams: stored.carbsGrams ?? "",
    fatGrams: stored.fatGrams ?? "",
  };
  const derived = macroPercentagesFromGoal({
    ...emptyTarget,
    ...base,
  });

  return {
    ...base,
    inputMode: stored.inputMode === "percent" ? "percent" : "grams",
    proteinPercent: Number.isFinite(stored.proteinPercent)
      ? Number(stored.proteinPercent)
      : derived.proteinPercent,
    carbsPercent: Number.isFinite(stored.carbsPercent)
      ? Number(stored.carbsPercent)
      : derived.carbsPercent,
    fatPercent: Number.isFinite(stored.fatPercent)
      ? Number(stored.fatPercent)
      : derived.fatPercent,
  };
}

function createGoalTarget(
  goal: Pick<
    ProfessionalOfficialGoalTarget,
    "calories" | "proteinGrams" | "carbsGrams" | "fatGrams"
  >,
  inputMode: ProfessionalMacroInputMode = "grams"
): ProfessionalOfficialGoalTarget {
  const target = normalizeGoalTarget({
    ...goal,
    inputMode,
    proteinPercent: 0,
    carbsPercent: 0,
    fatPercent: 0,
  });
  const percentages = macroPercentagesFromGoal(target);
  const withPercentages = { ...target, ...percentages, inputMode };
  return inputMode === "percent"
    ? applyPercentagesToGoal(withPercentages, percentages)
    : withPercentages;
}

function applyPercentagesToGoal(
  goal: ProfessionalOfficialGoalTarget,
  percentages: Pick<
    ProfessionalOfficialGoalTarget,
    "proteinPercent" | "carbsPercent" | "fatPercent"
  >
): ProfessionalOfficialGoalTarget {
  const calories = Math.max(0, Number(goal.calories));
  const proteinPercent = roundToOneDecimal(percentages.proteinPercent);
  const carbsPercent = roundToOneDecimal(percentages.carbsPercent);
  const fatPercent = roundToOneDecimal(percentages.fatPercent);

  return {
    ...goal,
    proteinPercent,
    carbsPercent,
    fatPercent,
    proteinGrams: String(
      Math.round((calories * (proteinPercent / 100)) / 4)
    ),
    carbsGrams: String(Math.round((calories * (carbsPercent / 100)) / 4)),
    fatGrams: String(Math.round((calories * (fatPercent / 100)) / 9)),
  };
}

function updateGoalValueField(
  current: ProfessionalOfficialGoalTarget,
  field: ProfessionalGoalValueField,
  value: string
) {
  const normalized = normalizeGoalTarget(current);
  const nextGoal = { ...normalized, [field]: value };

  if (field === "calories" && normalized.inputMode === "percent") {
    return applyPercentagesToGoal(nextGoal, {
      proteinPercent: normalized.proteinPercent,
      carbsPercent: normalized.carbsPercent,
      fatPercent: normalized.fatPercent,
    });
  }

  return {
    ...nextGoal,
    ...macroPercentagesFromGoal(nextGoal),
  };
}

function updateGoalPercent(
  current: ProfessionalOfficialGoalTarget,
  field: ProfessionalMacroPercentField,
  value: number
) {
  const normalized = normalizeGoalTarget(current);
  return applyPercentagesToGoal(
    { ...normalized, inputMode: "percent" },
    {
      proteinPercent:
        field === "proteinPercent" ? value : normalized.proteinPercent,
      carbsPercent:
        field === "carbsPercent" ? value : normalized.carbsPercent,
      fatPercent: field === "fatPercent" ? value : normalized.fatPercent,
    }
  );
}

function updateGoalInputMode(
  current: ProfessionalOfficialGoalTarget,
  mode: ProfessionalMacroInputMode
) {
  const normalized = normalizeGoalTarget(current);
  if (mode === normalized.inputMode) return normalized;

  if (mode === "percent") {
    return applyPercentagesToGoal(
      { ...normalized, inputMode: mode },
      {
        proteinPercent: normalized.proteinPercent,
        carbsPercent: normalized.carbsPercent,
        fatPercent: normalized.fatPercent,
      }
    );
  }

  return {
    ...normalized,
    inputMode: mode,
    ...macroPercentagesFromGoal(normalized),
  };
}

function percentSum(goal: ProfessionalOfficialGoalTarget) {
  const normalized = normalizeGoalTarget(goal);
  return roundToOneDecimal(
    normalized.proteinPercent +
      normalized.carbsPercent +
      normalized.fatPercent
  );
}

function percentModeValid(goal: ProfessionalOfficialGoalTarget) {
  const normalized = normalizeGoalTarget(goal);
  return normalized.inputMode !== "percent" || percentSum(normalized) === 100;
}

function normalizeException(
  item: ProfessionalOfficialGoalDraftException
): ProfessionalOfficialGoalDraftException {
  return {
    weekday: item.weekday,
    durationType: item.durationType,
    ...normalizeGoalTarget(item),
  };
}

function tomorrowAfter(value?: string | null) {
  const today = new Date().toISOString().slice(0, 10);
  if (!value || value < today) return today;
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

const GOAL_HISTORY_PAGE_SIZE = 5;

function formatDate(value?: string | number | Date | null) {
  if (!value) return "Não informado";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-");
    return `${day}/${month}/${year}`;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "Não informado";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeZone: "UTC",
  }).format(date);
}

function goalStatusLabel(status: string) {
  if (status === "active") return "Ativa";
  if (status === "superseded") return "Substituída";
  if (status === "ended") return "Encerrada";
  return "Não informado";
}

const WEEKDAY_LABELS = [
  "Segunda-feira",
  "Terça-feira",
  "Quarta-feira",
  "Quinta-feira",
  "Sexta-feira",
  "Sábado",
  "Domingo",
] as const;

function weekdayLabel(weekday: number) {
  return WEEKDAY_LABELS[weekday] ?? "Dia não informado";
}

function durationLabel(durationType: string) {
  if (durationType === "1_week") return "1 semana";
  if (durationType === "2_weeks") return "2 semanas";
  if (durationType === "3_weeks") return "3 semanas";
  if (durationType === "always") return "Sempre";
  return "Duração não informada";
}

function goalOriginLabel(origin: string) {
  return origin === "professional" ? "Profissional" : "Não informada";
}

function MacroModeSelector({
  mode,
  onChange,
  disabled,
  ariaLabel,
}: {
  mode: ProfessionalMacroInputMode;
  onChange: (mode: ProfessionalMacroInputMode) => void;
  disabled: boolean;
  ariaLabel: string;
}) {
  return (
    <div className="rounded-2xl border bg-background p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-medium tracking-tight">
            Como preencher os macronutrientes
          </p>
          <p className="text-sm text-muted-foreground">
            Use gramas quando já souber os valores. Use percentual das calorias
            do dia quando quiser dividir a meta entre proteínas, carboidratos e
            gorduras.
          </p>
        </div>
        <div
          role="group"
          aria-label={ariaLabel}
          className="flex rounded-full bg-muted p-1"
        >
          <button
            type="button"
            disabled={disabled}
            aria-pressed={mode === "grams"}
            className={`rounded-full px-4 py-2 text-sm transition disabled:cursor-not-allowed disabled:opacity-60 ${mode === "grams" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"}`}
            onClick={() => onChange("grams")}
          >
            Por gramas
          </button>
          <button
            type="button"
            disabled={disabled}
            aria-pressed={mode === "percent"}
            className={`rounded-full px-4 py-2 text-sm transition disabled:cursor-not-allowed disabled:opacity-60 ${mode === "percent" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"}`}
            onClick={() => onChange("percent")}
          >
            Por percentual
          </button>
        </div>
      </div>
    </div>
  );
}

function CaloriesField({
  value,
  onChange,
  disabled,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  ariaLabel: string;
}) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="font-medium">Calorias (kcal)</span>
      <Input
        aria-label={ariaLabel}
        type="number"
        min={1}
        value={value}
        onChange={event => onChange(event.target.value)}
        disabled={disabled}
      />
    </label>
  );
}

function MacroField({
  label,
  ariaLabel,
  mode,
  grams,
  percent,
  onGramChange,
  onPercentChange,
  disabled,
}: {
  label: string;
  ariaLabel: string;
  mode: ProfessionalMacroInputMode;
  grams: string;
  percent: number;
  onGramChange: (value: string) => void;
  onPercentChange: (value: number) => void;
  disabled: boolean;
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
    <label className="grid gap-1 text-sm">
      <span className="font-medium">{label}</span>
      <div className="flex items-center gap-3">
        {mode === "grams" ? (
          <Input
            aria-label={ariaLabel}
            type="number"
            min={1}
            value={grams}
            onChange={event => onGramChange(event.target.value)}
            disabled={disabled}
          />
        ) : (
          <Input
            aria-label={ariaLabel}
            type="text"
            inputMode="decimal"
            value={percentInputValue}
            onFocus={() => setIsPercentFocused(true)}
            onChange={event => handlePercentChange(event.target.value)}
            onBlur={handlePercentBlur}
            disabled={disabled}
          />
        )}
        <span className="text-sm text-muted-foreground">
          {mode === "grams" ? "g" : "%"}
        </span>
      </div>
      {mode === "percent" ? (
        <span className="text-xs text-muted-foreground">
          Calculado automaticamente pela meta calórica: {formatGrams(Number(grams))}
        </span>
      ) : null}
    </label>
  );
}

function PercentValidationNote({
  goal,
}: {
  goal: ProfessionalOfficialGoalTarget;
}) {
  const normalized = normalizeGoalTarget(goal);
  if (normalized.inputMode !== "percent") return null;

  const sum = percentSum(normalized);
  const isValid = sum === 100;

  return (
    <div
      role={isValid ? "status" : "alert"}
      className={`rounded-2xl border p-4 text-sm ${isValid ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-destructive/30 bg-destructive/5 text-destructive"}`}
    >
      <div className="flex items-start gap-3">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
        <div>
          <p className="font-medium tracking-tight">
            Distribuição dos macronutrientes
          </p>
          <p>
            A soma atual é de <strong>{formatPercentPtBr(sum, 1)}%</strong>.
            Para ativar por percentual, proteínas, carboidratos e gorduras
            precisam somar exatamente <strong>100%</strong>.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function ProfessionalOfficialGoalCard({
  patientId,
  disabled,
  draft,
  onDraftChange,
  onSaved,
}: {
  patientId: number;
  disabled: boolean;
  draft: ProfessionalOfficialGoalDraft;
  onDraftChange: React.Dispatch<
    React.SetStateAction<ProfessionalOfficialGoalDraft>
  >;
  onSaved?: () => void;
}) {
  const utils = trpc.useUtils();
  const state = trpc.professionalRecord.officialGoal.professionalState.useQuery(
    { patientId },
    { enabled: patientId > 0, retry: false }
  );
  const current = state.data?.current;
  const history = state.data?.history ?? [];
  const [historyPage, setHistoryPage] = useState(1);
  const historyTotalPages = Math.max(
    1,
    Math.ceil(history.length / GOAL_HISTORY_PAGE_SIZE)
  );
  const visibleHistory = history.slice(
    (historyPage - 1) * GOAL_HISTORY_PAGE_SIZE,
    historyPage * GOAL_HISTORY_PAGE_SIZE
  );
  const versionByGoalId = useMemo(
    () => new Map(history.map(item => [item.id, item.version])),
    [history]
  );
  useEffect(() => {
    setHistoryPage(1);
  }, [patientId]);
  useEffect(() => {
    setHistoryPage(currentPage => Math.min(currentPage, historyTotalPages));
  }, [historyTotalPages]);
  useEffect(() => {
    if (!current || draft.touched || draft.sourceGoalId === current.id) return;
    onDraftChange(existing => ({
      ...existing,
      target: createGoalTarget(
        {
          calories: String(current.calories),
          proteinGrams: String(current.proteinGrams),
          carbsGrams: String(current.carbsGrams),
          fatGrams: String(current.fatGrams),
        },
        "grams"
      ),
      effectiveFrom: tomorrowAfter(current.effectiveFrom),
      includeExerciseCalories: current.includeExerciseCalories,
      sourceGoalId: current.id,
      touched: false,
    }));
  }, [current, draft.sourceGoalId, draft.touched, onDraftChange]);
  const target = useMemo(() => normalizeGoalTarget(draft.target), [draft.target]);
  const { effectiveFrom, justification, includeExerciseCalories } = draft;
  const exceptions = useMemo(
    () => draft.exceptions.map(normalizeException),
    [draft.exceptions]
  );
  const valid = useMemo(
    () =>
      [
        target.calories,
        target.proteinGrams,
        target.carbsGrams,
        target.fatGrams,
      ].every(value => Number(value) > 0) &&
      percentModeValid(target) &&
      exceptions.every(percentModeValid) &&
      justification.trim().length >= 3 &&
      Boolean(effectiveFrom),
    [effectiveFrom, exceptions, justification, target]
  );
  const refresh = async () => {
    await Promise.all([
      state.refetch(),
      utils.professionalRecord.get.invalidate(),
      utils.nutrition.goals.get.invalidate(),
      utils.nutrition.reports.invalidate(),
    ]);
  };
  const activate = trpc.professionalRecord.officialGoal.activate.useMutation({
    onSuccess: async result => {
      onDraftChange(createEmptyProfessionalOfficialGoalDraft());
      onSaved?.();
      await refresh();
      toast.success(
        result.notification.status === "sent"
          ? "Meta oficial ativada e paciente notificado."
          : "Meta oficial ativada. A notificação ficou registrada para nova tentativa."
      );
    },
    onError: error => toast.error(error.message),
  });
  const retry =
    trpc.professionalRecord.officialGoal.retryNotification.useMutation({
      onSuccess: async result => {
        await refresh();
        toast[result.status === "sent" ? "success" : "warning"](
          result.status === "sent"
            ? "Notificação enviada."
            : "A notificação ainda não pôde ser enviada."
        );
      },
      onError: error => toast.error(error.message),
    });
  const updateDraft = (
    updater: (
      currentDraft: ProfessionalOfficialGoalDraft
    ) => ProfessionalOfficialGoalDraft
  ) =>
    onDraftChange(currentDraft => ({
      ...updater(currentDraft),
      touched: true,
    }));
  const updateTargetField = (
    field: ProfessionalGoalValueField,
    value: string
  ) =>
    updateDraft(currentDraft => ({
      ...currentDraft,
      target: updateGoalValueField(
        normalizeGoalTarget(currentDraft.target),
        field,
        value
      ),
    }));
  const updateTargetPercent = (
    field: ProfessionalMacroPercentField,
    value: number
  ) =>
    updateDraft(currentDraft => ({
      ...currentDraft,
      target: updateGoalPercent(
        normalizeGoalTarget(currentDraft.target),
        field,
        value
      ),
    }));
  const updateTargetInputMode = (mode: ProfessionalMacroInputMode) =>
    updateDraft(currentDraft => ({
      ...currentDraft,
      target: updateGoalInputMode(
        normalizeGoalTarget(currentDraft.target),
        mode
      ),
    }));
  const updateException = (
    index: number,
    updater: (
      item: ProfessionalOfficialGoalDraftException
    ) => ProfessionalOfficialGoalDraftException
  ) =>
    updateDraft(currentDraft => ({
      ...currentDraft,
      exceptions: currentDraft.exceptions.map((value, itemIndex) =>
        itemIndex === index ? updater(normalizeException(value)) : value
      ),
    }));
  const addException = () =>
    updateDraft(currentDraft => ({
      ...currentDraft,
      exceptions: [
        ...currentDraft.exceptions,
        {
          weekday: 0,
          durationType: "always",
          ...normalizeGoalTarget(currentDraft.target),
        },
      ],
    }));

  return (
    <Card className="border-primary/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Stethoscope className="h-5 w-5 text-primary" />
          Meta profissional oficial
        </CardTitle>
        <CardDescription>
          Ative uma versão auditável. A versão anterior continua no histórico e
          as sugestões legadas permanecem separadas.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {state.isLoading ? (
          <p role="status" className="text-sm text-muted-foreground">
            Carregando metas profissionais...
          </p>
        ) : null}
        {state.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {state.error.message}
          </p>
        ) : null}
        {current ? (
          <div className="rounded-md border bg-muted/20 p-4 text-sm">
            <p className="font-medium">
              Versão {current.version} ativa · {current.calories} kcal
            </p>
            <p className="text-muted-foreground">
              Vigência desde {current.effectiveFrom}. Justificativa registrada
              no histórico profissional.
            </p>
          </div>
        ) : (
          <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            Nenhuma meta profissional oficial ativa para este paciente.
          </p>
        )}
        {state.data?.reviewRequests?.some(
          item => item.status === "open"
        ) ? (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
            O paciente solicitou revisão desta meta. A solicitação será
            resolvida quando uma nova versão for ativada.
          </div>
        ) : null}
        <section
          aria-labelledby="professional-official-goal-history-title"
          className="space-y-3 rounded-xl border p-4"
        >
          <div>
            <h3
              id="professional-official-goal-history-title"
              className="font-semibold"
            >
              Histórico de metas oficiais
            </h3>
            <p className="text-sm text-muted-foreground">
              Consulte valores, vigência, autoria, origem e a relação entre as
              versões sem alterar registros anteriores.
            </p>
          </div>
          {visibleHistory.length ? (
            <div className="grid gap-3">
              {visibleHistory.map(item => {
                const supersededVersion = item.supersedesGoalId
                  ? versionByGoalId.get(item.supersedesGoalId)
                  : null;
                return (
                  <article
                    key={item.id}
                    className="grid min-w-0 gap-3 rounded-lg border bg-muted/10 p-3 text-sm"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-medium">
                          Versão {item.version} · {goalStatusLabel(item.status)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Criada em {formatDate(item.createdAt)} por{" "}
                          {item.professionalName}
                        </p>
                      </div>
                      <span className="rounded-full border px-2 py-1 text-xs font-medium">
                        Origem: {goalOriginLabel(item.origin)}
                      </span>
                    </div>
                    <dl className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                      <div>
                        <dt className="text-xs text-muted-foreground">
                          Calorias
                        </dt>
                        <dd className="font-medium">{item.calories} kcal</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">
                          Proteínas
                        </dt>
                        <dd className="font-medium">{item.proteinGrams} g</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">
                          Carboidratos
                        </dt>
                        <dd className="font-medium">{item.carbsGrams} g</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">
                          Gorduras
                        </dt>
                        <dd className="font-medium">{item.fatGrams} g</dd>
                      </div>
                    </dl>
                    <dl className="grid gap-2 sm:grid-cols-2">
                      <div>
                        <dt className="text-xs text-muted-foreground">
                          Vigência
                        </dt>
                        <dd className="font-medium">
                          {formatDate(item.effectiveFrom)} até{" "}
                          {item.effectiveUntil
                            ? formatDate(item.effectiveUntil)
                            : "vigente"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">
                          Relação entre versões
                        </dt>
                        <dd className="font-medium">
                          {supersededVersion
                            ? `Substitui a versão ${supersededVersion}`
                            : "Primeira versão oficial"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">
                          Ajuste por exercícios
                        </dt>
                        <dd className="font-medium">
                          {item.includeExerciseCalories
                            ? "Incluído na meta ajustada"
                            : "Não incluído na meta ajustada"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">
                          Exceções
                        </dt>
                        <dd className="font-medium">
                          {item.exceptions.length
                            ? `${item.exceptions.length} configurada(s)`
                            : "Nenhuma"}
                        </dd>
                      </div>
                    </dl>
                    {item.exceptions.length ? (
                      <div className="space-y-2">
                        <p className="text-xs text-muted-foreground">
                          Valores das exceções históricas
                        </p>
                        <ul className="grid gap-2 sm:grid-cols-2">
                          {item.exceptions.map((exception, index) => (
                            <li
                              key={`${item.id}-${exception.weekday}-${
                                exception.startDate ?? index
                              }`}
                              className="rounded-md border bg-background p-2"
                            >
                              <p className="font-medium">
                                {weekdayLabel(exception.weekday)} ·{" "}
                                {durationLabel(exception.durationType)}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {exception.calories} kcal ·{" "}
                                {exception.proteinGrams} g proteínas ·{" "}
                                {exception.carbsGrams} g carboidratos ·{" "}
                                {exception.fatGrams} g gorduras
                              </p>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    <div>
                      <p className="text-xs text-muted-foreground">
                        Justificativa profissional
                      </p>
                      <p className="break-words font-medium">
                        {item.justification || "Não informada"}
                      </p>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
              Nenhuma versão oficial foi registrada.
            </p>
          )}
          {history.length > GOAL_HISTORY_PAGE_SIZE ? (
            <nav
              aria-label="Paginação do histórico de metas oficiais"
              className="flex flex-wrap items-center justify-between gap-2"
            >
              <Button
                type="button"
                variant="outline"
                disabled={historyPage <= 1}
                onClick={() => setHistoryPage(page => Math.max(1, page - 1))}
              >
                Anterior
              </Button>
              <span className="text-sm text-muted-foreground">
                Página {historyPage} de {historyTotalPages}
              </span>
              <Button
                type="button"
                variant="outline"
                disabled={historyPage >= historyTotalPages}
                onClick={() =>
                  setHistoryPage(page => Math.min(historyTotalPages, page + 1))
                }
              >
                Próxima
              </Button>
            </nav>
          ) : null}
        </section>

        <MacroModeSelector
          mode={target.inputMode}
          onChange={updateTargetInputMode}
          disabled={disabled}
          ariaLabel="Modo de preenchimento da meta padrão"
        />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <CaloriesField
            value={target.calories}
            onChange={value => updateTargetField("calories", value)}
            disabled={disabled}
            ariaLabel="Calorias (kcal)"
          />
          <MacroField
            label="Proteínas"
            ariaLabel="Proteínas"
            mode={target.inputMode}
            grams={target.proteinGrams}
            percent={target.proteinPercent}
            onGramChange={value => updateTargetField("proteinGrams", value)}
            onPercentChange={value =>
              updateTargetPercent("proteinPercent", value)
            }
            disabled={disabled}
          />
          <MacroField
            label="Carboidratos"
            ariaLabel="Carboidratos"
            mode={target.inputMode}
            grams={target.carbsGrams}
            percent={target.carbsPercent}
            onGramChange={value => updateTargetField("carbsGrams", value)}
            onPercentChange={value => updateTargetPercent("carbsPercent", value)}
            disabled={disabled}
          />
          <MacroField
            label="Gorduras"
            ariaLabel="Gorduras"
            mode={target.inputMode}
            grams={target.fatGrams}
            percent={target.fatPercent}
            onGramChange={value => updateTargetField("fatGrams", value)}
            onPercentChange={value => updateTargetPercent("fatPercent", value)}
            disabled={disabled}
          />
        </div>
        <PercentValidationNote goal={target} />

        <div className="grid gap-3 md:grid-cols-2">
          <label className="grid gap-1 text-sm">
            <span className="font-medium">Início da vigência</span>
            <Input
              type="date"
              value={effectiveFrom}
              onChange={event =>
                updateDraft(currentDraft => ({
                  ...currentDraft,
                  effectiveFrom: event.target.value,
                }))
              }
              disabled={disabled}
            />
          </label>
          <label className="flex items-center gap-2 pt-6 text-sm">
            <input
              type="checkbox"
              checked={includeExerciseCalories}
              onChange={event =>
                updateDraft(currentDraft => ({
                  ...currentDraft,
                  includeExerciseCalories: event.target.checked,
                }))
              }
              disabled={disabled}
            />
            Exercícios aumentam a meta ajustada
          </label>
        </div>
        <label className="grid gap-1 text-sm">
          <span className="font-medium">Justificativa profissional</span>
          <textarea
            aria-label="Justificativa profissional"
            className="min-h-24 rounded-md border bg-background p-3"
            value={justification}
            onChange={event =>
              updateDraft(currentDraft => ({
                ...currentDraft,
                justification: event.target.value,
              }))
            }
            maxLength={2000}
            disabled={disabled}
          />
          <span className="text-xs text-muted-foreground">
            A justificativa é privada e não será incluída na notificação ao
            paciente.
          </span>
        </label>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">Exceções por dia</p>
              <p className="text-xs text-muted-foreground">
                Mantêm o contrato canônico de dias especiais.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={addException}
              disabled={disabled}
            >
              <Plus className="h-4 w-4" />
              Adicionar exceção
            </Button>
          </div>
          {exceptions.map((item, index) => (
            <div key={index} className="space-y-3 rounded-md border p-3">
              <div className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
                <select
                  aria-label={`Dia da exceção ${index + 1}`}
                  className="h-10 rounded-md border bg-background px-2 text-sm"
                  value={item.weekday}
                  disabled={disabled}
                  onChange={event =>
                    updateException(index, value => ({
                      ...value,
                      weekday: Number(event.target.value),
                    }))
                  }
                >
                  {[
                    "Segunda",
                    "Terça",
                    "Quarta",
                    "Quinta",
                    "Sexta",
                    "Sábado",
                    "Domingo",
                  ].map((label, weekday) => (
                    <option key={label} value={weekday}>
                      {label}
                    </option>
                  ))}
                </select>
                <select
                  aria-label={`Duração da exceção ${index + 1}`}
                  className="h-10 rounded-md border bg-background px-2 text-sm"
                  value={item.durationType}
                  disabled={disabled}
                  onChange={event =>
                    updateException(index, value => ({
                      ...value,
                      durationType: event.target
                        .value as ProfessionalOfficialGoalDraftException["durationType"],
                    }))
                  }
                >
                  <option value="1_week">1 semana</option>
                  <option value="2_weeks">2 semanas</option>
                  <option value="3_weeks">3 semanas</option>
                  <option value="always">Sempre</option>
                </select>
                <Button
                  aria-label={`Remover exceção ${index + 1}`}
                  variant="ghost"
                  size="icon"
                  disabled={disabled}
                  onClick={() =>
                    updateDraft(currentDraft => ({
                      ...currentDraft,
                      exceptions: currentDraft.exceptions.filter(
                        (_, itemIndex) => itemIndex !== index
                      ),
                    }))
                  }
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>

              <MacroModeSelector
                mode={item.inputMode}
                onChange={mode =>
                  updateException(index, value =>
                    Object.assign(value, updateGoalInputMode(value, mode))
                  )
                }
                disabled={disabled}
                ariaLabel={`Modo de preenchimento da exceção ${index + 1}`}
              />
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <CaloriesField
                  value={item.calories}
                  onChange={value =>
                    updateException(index, currentItem => ({
                      ...currentItem,
                      ...updateGoalValueField(currentItem, "calories", value),
                    }))
                  }
                  disabled={disabled}
                  ariaLabel={`Calorias (kcal) da exceção ${index + 1}`}
                />
                <MacroField
                  label="Proteínas"
                  ariaLabel={`Proteínas da exceção ${index + 1}`}
                  mode={item.inputMode}
                  grams={item.proteinGrams}
                  percent={item.proteinPercent}
                  onGramChange={value =>
                    updateException(index, currentItem => ({
                      ...currentItem,
                      ...updateGoalValueField(
                        currentItem,
                        "proteinGrams",
                        value
                      ),
                    }))
                  }
                  onPercentChange={value =>
                    updateException(index, currentItem => ({
                      ...currentItem,
                      ...updateGoalPercent(
                        currentItem,
                        "proteinPercent",
                        value
                      ),
                    }))
                  }
                  disabled={disabled}
                />
                <MacroField
                  label="Carboidratos"
                  ariaLabel={`Carboidratos da exceção ${index + 1}`}
                  mode={item.inputMode}
                  grams={item.carbsGrams}
                  percent={item.carbsPercent}
                  onGramChange={value =>
                    updateException(index, currentItem => ({
                      ...currentItem,
                      ...updateGoalValueField(
                        currentItem,
                        "carbsGrams",
                        value
                      ),
                    }))
                  }
                  onPercentChange={value =>
                    updateException(index, currentItem => ({
                      ...currentItem,
                      ...updateGoalPercent(
                        currentItem,
                        "carbsPercent",
                        value
                      ),
                    }))
                  }
                  disabled={disabled}
                />
                <MacroField
                  label="Gorduras"
                  ariaLabel={`Gorduras da exceção ${index + 1}`}
                  mode={item.inputMode}
                  grams={item.fatGrams}
                  percent={item.fatPercent}
                  onGramChange={value =>
                    updateException(index, currentItem => ({
                      ...currentItem,
                      ...updateGoalValueField(
                        currentItem,
                        "fatGrams",
                        value
                      ),
                    }))
                  }
                  onPercentChange={value =>
                    updateException(index, currentItem => ({
                      ...currentItem,
                      ...updateGoalPercent(currentItem, "fatPercent", value),
                    }))
                  }
                  disabled={disabled}
                />
              </div>
              <PercentValidationNote goal={item} />
            </div>
          ))}
        </div>
        <Button
          disabled={disabled || !valid || activate.isPending}
          onClick={() =>
            activate.mutate({
              patientId,
              expectedVersion: current?.version,
              effectiveFrom,
              justification: justification.trim(),
              goal: {
                includeExerciseCalories,
                defaultGoal: {
                  calories: Number(target.calories),
                  proteinGrams: Number(target.proteinGrams),
                  carbsGrams: Number(target.carbsGrams),
                  fatGrams: Number(target.fatGrams),
                },
                exceptions: exceptions.map(item => ({
                  weekday: item.weekday,
                  durationType: item.durationType,
                  calories: Number(item.calories),
                  proteinGrams: Number(item.proteinGrams),
                  carbsGrams: Number(item.carbsGrams),
                  fatGrams: Number(item.fatGrams),
                })),
              },
            })
          }
        >
          {activate.isPending
            ? "Ativando..."
            : current
              ? "Ativar nova versão"
              : "Ativar meta oficial"}
        </Button>
        {state.data?.notifications
          ?.filter(
            item => item.status === "failed" || item.status === "skipped"
          )
          .slice(0, 1)
          .map(item => (
            <div
              key={item.goalId}
              className="flex items-center justify-between gap-3 rounded-md border border-amber-300 p-3 text-sm"
            >
              <span>Notificação pendente ({item.attempts} tentativa(s)).</span>
              <Button
                variant="outline"
                disabled={disabled || retry.isPending}
                onClick={() => retry.mutate({ goalId: item.goalId })}
              >
                <RotateCcw className="h-4 w-4" />
                Tentar novamente
              </Button>
            </div>
          ))}
      </CardContent>
    </Card>
  );
}
