import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatCalories, formatGrams } from "@/lib/numberFormat";
import { trpc } from "@/lib/trpc";
import { Plus, Target, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { useLocation } from "wouter";

type DurationType = "1_week" | "2_weeks" | "3_weeks" | "always";

type GoalTarget = {
  calories: number;
  proteinGrams: number;
  carbsGrams: number;
  fatGrams: number;
};

type GoalExceptionDraft = GoalTarget & {
  weekday: number;
  durationType: DurationType;
};

type NutritionGoalView = {
  defaultGoal: GoalTarget;
  exceptions: Array<GoalExceptionDraft & { id?: number; isActive?: boolean }>;
};

const SLOT_ATTRIBUTE = "data-professional-goal-exception-suggestions-root";

const WEEKDAY_OPTIONS = [
  { weekday: 0, label: "Segunda-feira" },
  { weekday: 1, label: "Terça-feira" },
  { weekday: 2, label: "Quarta-feira" },
  { weekday: 3, label: "Quinta-feira" },
  { weekday: 4, label: "Sexta-feira" },
  { weekday: 5, label: "Sábado" },
  { weekday: 6, label: "Domingo" },
] as const;

const DURATION_OPTIONS: Array<{ value: DurationType; label: string }> = [
  { value: "1_week", label: "Por 1 semana" },
  { value: "2_weeks", label: "Por 2 semanas" },
  { value: "3_weeks", label: "Por 3 semanas" },
  { value: "always", label: "Sempre" },
];

function elementText(element: Element) {
  return element.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

function parseNumber(value: string) {
  return Number(value.replace(/\./g, "").replace(",", ".")) || 0;
}

function numberInputValue(value: number) {
  return String(Math.round(value || 0));
}

function findSelectedPatientId() {
  const selects = Array.from(document.querySelectorAll<HTMLSelectElement>("select"));
  const patientSelect = selects.find(select => Array.from(select.options).some(option => /^\d+$/.test(option.value)));
  const value = patientSelect?.value ? Number(patientSelect.value) : 0;
  return value > 0 ? value : null;
}

function findSuggestionBox() {
  const title = Array.from(document.querySelectorAll("p, h2, h3, div")).find(element =>
    elementText(element) === "Sugerir ajuste de meta",
  );
  if (!title) return null;

  let current = title.parentElement;
  while (current) {
    const text = elementText(current);
    if (text.includes("Sugerir ajuste de meta") && text.includes("Enviar sugestão")) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

function findPortalSlot() {
  if (typeof document === "undefined") return null;
  const existingSlot = document.querySelector<HTMLDivElement>(`[${SLOT_ATTRIBUTE}='true']`);
  if (existingSlot) return existingSlot;

  const suggestionBox = findSuggestionBox();
  if (!suggestionBox?.parentElement) return null;

  const slot = document.createElement("div");
  slot.setAttribute(SLOT_ATTRIBUTE, "true");
  suggestionBox.parentElement.insertBefore(slot, suggestionBox.nextSibling);
  return slot;
}

function cloneGoal(goal: GoalTarget): GoalTarget {
  return {
    calories: goal.calories,
    proteinGrams: goal.proteinGrams,
    carbsGrams: goal.carbsGrams,
    fatGrams: goal.fatGrams,
  };
}

function buildException(weekday: number, baseGoal: GoalTarget): GoalExceptionDraft {
  return {
    weekday,
    durationType: "always",
    ...cloneGoal(baseGoal),
  };
}

function activeExceptions(goal: NutritionGoalView | undefined) {
  return goal?.exceptions?.filter(exception => exception.isActive !== false).map(exception => ({
    weekday: exception.weekday,
    durationType: exception.durationType,
    calories: exception.calories,
    proteinGrams: exception.proteinGrams,
    carbsGrams: exception.carbsGrams,
    fatGrams: exception.fatGrams,
  })) ?? [];
}

export default function ProfessionalGoalExceptionSuggestionsEmbed() {
  const [location] = useLocation();
  const shouldRender = location.startsWith("/professional");
  const utils = trpc.useUtils();
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [patientId, setPatientId] = useState<number | null>(null);
  const [rationale, setRationale] = useState("");
  const [exceptions, setExceptions] = useState<GoalExceptionDraft[]>([]);

  useEffect(() => {
    if (!shouldRender) {
      setSlot(null);
      setPatientId(null);
      return;
    }

    const updateStateFromPage = () => {
      setPatientId(findSelectedPatientId());
      setSlot(findPortalSlot());
    };

    updateStateFromPage();
    document.addEventListener("change", updateStateFromPage, true);
    document.addEventListener("click", updateStateFromPage, true);
    const observer = new MutationObserver(updateStateFromPage);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      document.removeEventListener("change", updateStateFromPage, true);
      document.removeEventListener("click", updateStateFromPage, true);
      observer.disconnect();
    };
  }, [shouldRender]);

  const dashboard = trpc.nutrition.professionals.patientDashboard.useQuery(
    { patientId: patientId ?? 0 },
    { enabled: shouldRender && Boolean(slot) && Boolean(patientId), retry: false },
  );
  const nutritionGoal = dashboard.data?.nutritionGoal as NutritionGoalView | undefined;
  const defaultGoal = nutritionGoal?.defaultGoal;

  useEffect(() => {
    setExceptions(activeExceptions(nutritionGoal));
  }, [patientId, nutritionGoal]);

  const availableWeekdays = useMemo(() => WEEKDAY_OPTIONS.filter(day => !exceptions.some(exception => exception.weekday === day.weekday)), [exceptions]);
  const weeklyTotals = useMemo(() => {
    if (!defaultGoal) return { calories: 0, proteinGrams: 0, carbsGrams: 0, fatGrams: 0 };

    return WEEKDAY_OPTIONS.reduce((total, day) => {
      const exception = exceptions.find(item => item.weekday === day.weekday);
      const goal = exception ?? defaultGoal;
      return {
        calories: total.calories + goal.calories,
        proteinGrams: total.proteinGrams + goal.proteinGrams,
        carbsGrams: total.carbsGrams + goal.carbsGrams,
        fatGrams: total.fatGrams + goal.fatGrams,
      };
    }, { calories: 0, proteinGrams: 0, carbsGrams: 0, fatGrams: 0 });
  }, [defaultGoal, exceptions]);

  const suggestGoal = trpc.nutrition.professionals.suggestGoalAdjustment.useMutation({
    onSuccess: async () => {
      toast.success("Sugestão de meta com exceções registrada para acompanhamento.");
      setRationale("");
      if (patientId) {
        await utils.nutrition.professionals.patientDashboard.invalidate({ patientId });
      }
    },
    onError: error => toast.error(error.message || "Não foi possível registrar a sugestão de meta."),
  });

  function addException() {
    if (!defaultGoal) return;
    const nextDay = availableWeekdays[0];
    if (!nextDay) {
      toast.error("Todos os dias da semana já possuem exceção na sugestão.");
      return;
    }
    setExceptions(current => [...current, buildException(nextDay.weekday, defaultGoal)]);
  }

  function updateException(index: number, patch: Partial<GoalExceptionDraft>) {
    setExceptions(current => current.map((exception, currentIndex) => currentIndex === index ? { ...exception, ...patch } : exception));
  }

  function removeException(index: number) {
    setExceptions(current => current.filter((_, currentIndex) => currentIndex !== index));
  }

  function sendSuggestion() {
    if (!patientId || !defaultGoal) return;
    if (!rationale.trim()) {
      toast.error("Informe a justificativa antes de enviar a sugestão.");
      return;
    }

    suggestGoal.mutate({
      patientId,
      rationale: rationale.trim(),
      status: "sent",
      goal: {
        defaultGoal: cloneGoal(defaultGoal),
        exceptions: exceptions.map(exception => ({
          weekday: exception.weekday,
          durationType: exception.durationType,
          calories: exception.calories,
          proteinGrams: exception.proteinGrams,
          carbsGrams: exception.carbsGrams,
          fatGrams: exception.fatGrams,
        })),
      },
    });
  }

  if (!shouldRender || !slot) return null;

  return createPortal(
    <Card className="border bg-muted/10 shadow-none">
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Target className="h-5 w-5 text-primary" />
              Sugerir exceções de meta
            </CardTitle>
            <CardDescription>
              Monte uma sugestão com dias diferentes da meta geral para a pessoa revisar depois.
            </CardDescription>
          </div>
          <Button type="button" variant="outline" className="w-fit rounded-full" onClick={addException} disabled={!defaultGoal || !availableWeekdays.length}>
            <Plus className="mr-2 h-4 w-4" />
            Adicionar exceção
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!patientId ? <EmptyState text="Selecione uma pessoa autorizada para sugerir exceções de meta." /> : null}
        {dashboard.isLoading ? <EmptyState text="Carregando metas da pessoa selecionada..." /> : null}
        {dashboard.isError ? <EmptyState text="Não foi possível carregar as metas desta pessoa. Tente novamente em instantes." /> : null}

        {defaultGoal ? (
          <>
            <div className="grid gap-3 md:grid-cols-4">
              <SummaryTile label="Calorias semanais" value={formatCalories(weeklyTotals.calories)} />
              <SummaryTile label="Proteínas" value={formatGrams(weeklyTotals.proteinGrams)} />
              <SummaryTile label="Carboidratos" value={formatGrams(weeklyTotals.carbsGrams)} />
              <SummaryTile label="Gorduras" value={formatGrams(weeklyTotals.fatGrams)} />
            </div>

            {exceptions.length ? exceptions.map((exception, index) => {
              const selectedWeekdays = new Set(exceptions.map(item => item.weekday));
              const weekdayOptions = WEEKDAY_OPTIONS.filter(day => day.weekday === exception.weekday || !selectedWeekdays.has(day.weekday));

              return (
                <div key={`${exception.weekday}-${index}`} className="rounded-2xl border bg-background p-4">
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
                      options={DURATION_OPTIONS}
                      onChange={value => updateException(index, { durationType: value as DurationType })}
                    />
                    <Button type="button" variant="ghost" className="rounded-full text-destructive hover:text-destructive" onClick={() => removeException(index)}>
                      <Trash2 className="mr-2 h-4 w-4" />
                      Remover
                    </Button>
                  </div>
                  <div className="mt-4 grid gap-3 md:grid-cols-4">
                    <NumberField label="Calorias" value={exception.calories} min={800} onChange={value => updateException(index, { calories: value })} />
                    <NumberField label="Proteína (g)" value={exception.proteinGrams} min={20} onChange={value => updateException(index, { proteinGrams: value })} />
                    <NumberField label="Carboidratos (g)" value={exception.carbsGrams} min={20} onChange={value => updateException(index, { carbsGrams: value })} />
                    <NumberField label="Gorduras (g)" value={exception.fatGrams} min={10} onChange={value => updateException(index, { fatGrams: value })} />
                  </div>
                </div>
              );
            }) : <EmptyState text="Nenhuma exceção incluída nesta sugestão. Use Adicionar exceção para propor um dia com meta diferente." />}

            <label className="block space-y-2">
              <Label>Justificativa</Label>
              <Textarea
                value={rationale}
                onChange={event => setRationale(event.target.value)}
                placeholder="Ex.: ajustar o sábado para um almoço social sem mudar a meta dos outros dias."
              />
            </label>

            <Button type="button" className="rounded-full" disabled={!patientId || !rationale.trim() || suggestGoal.isPending} onClick={sendSuggestion}>
              {suggestGoal.isPending ? "Enviando..." : "Enviar sugestão com exceções"}
            </Button>
          </>
        ) : null}
      </CardContent>
    </Card>,
    slot,
  );
}

function NumberField({ label, value, min, onChange }: { label: string; value: number; min: number; onChange: (value: number) => void }) {
  return (
    <label className="space-y-2">
      <Label>{label}</Label>
      <Input
        type="text"
        inputMode="numeric"
        value={numberInputValue(value)}
        onChange={event => onChange(Math.max(min, parseNumber(event.target.value)))}
      />
    </label>
  );
}

function SelectField({ label, value, options, onChange }: { label: string; value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void }) {
  return (
    <label className="space-y-2">
      <Label>{label}</Label>
      <select
        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
        value={value}
        onChange={event => onChange(event.target.value)}
      >
        {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border bg-background p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 font-semibold tracking-tight">{value}</p>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="rounded-2xl border border-dashed bg-muted/20 p-5 text-sm leading-6 text-muted-foreground">{text}</div>;
}
