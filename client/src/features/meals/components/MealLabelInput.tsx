import React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { Clock3 } from "lucide-react";

type MealScheduleOption = {
  mealLabel: string;
  enabled: boolean;
};

type MealLabelInputProps = {
  value: string;
  onChange: (value: string) => void;
  suggestedLabel?: string | null;
};

const FALLBACK_MEAL_LABELS = ["café da manhã", "almoço", "lanche da tarde", "pré-treino", "pós-treino", "jantar", "ceia", "outro"];

function normalizeLabel(value: string) {
  return value.trim().toLocaleLowerCase("pt-BR");
}

export function MealLabelInput({ value, onChange, suggestedLabel }: MealLabelInputProps) {
  const schedulesQuery = trpc.nutrition.mealSchedules.list.useQuery();
  const reactId = React.useId();
  const datalistId = `meal-label-suggestions-${reactId.replace(/:/g, "")}`;
  const previousSuggestedLabelRef = React.useRef<string | null | undefined>(suggestedLabel);

  const configuredMealLabels = React.useMemo(() => {
    const schedules = (schedulesQuery.data as MealScheduleOption[] | undefined) ?? [];
    const enabledLabels = schedules
      .filter(schedule => schedule.enabled && schedule.mealLabel.trim())
      .map(schedule => schedule.mealLabel.trim());
    return Array.from(new Set([...(enabledLabels.length ? enabledLabels : FALLBACK_MEAL_LABELS), ...FALLBACK_MEAL_LABELS]));
  }, [schedulesQuery.data]);

  React.useEffect(() => {
    const previousSuggestedLabel = previousSuggestedLabelRef.current;
    previousSuggestedLabelRef.current = suggestedLabel;

    if (!suggestedLabel || suggestedLabel === value) {
      return;
    }

    const normalizedValue = normalizeLabel(value);
    const knownLabels = new Set([
      ...configuredMealLabels.map(normalizeLabel),
      ...(previousSuggestedLabel ? [normalizeLabel(previousSuggestedLabel)] : []),
    ]);
    const isFollowingAutomaticLabel = !value.trim() || knownLabels.has(normalizedValue);

    if (isFollowingAutomaticLabel) {
      onChange(suggestedLabel);
    }
  }, [configuredMealLabels, onChange, suggestedLabel, value]);

  return (
    <div className="space-y-2">
      <Label>Nome da refeição</Label>
      <Input value={value} onChange={event => onChange(event.target.value)} placeholder="Ex.: pré-treino" list={datalistId} />
      <datalist id={datalistId}>
        {configuredMealLabels.map(label => <option key={label} value={label} />)}
      </datalist>
      {suggestedLabel ? (
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <Clock3 className="h-3 w-3" />
          Sugestão pelo horário: {suggestedLabel}
        </p>
      ) : null}
    </div>
  );
}
