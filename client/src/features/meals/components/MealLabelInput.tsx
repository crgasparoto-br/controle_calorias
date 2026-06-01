import React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Clock3 } from "lucide-react";

type MealLabelInputProps = {
  value: string;
  onChange: (value: string) => void;
  suggestedLabel?: string | null;
};

export function MealLabelInput({ value, onChange, suggestedLabel }: MealLabelInputProps) {
  const handleChange = (nextValue: string) => {
    // Evita que o campo fique momentaneamente vazio durante a edição e seja
    // preenchido de novo pela sugestão baseada no horário no componente pai.
    if (!nextValue && value) return;
    onChange(nextValue);
  };

  return (
    <div className="space-y-2">
      <Label>Nome da refeição</Label>
      <Input value={value} onChange={event => handleChange(event.target.value)} placeholder="Ex.: pré-treino" list="meal-label-suggestions" />
      {suggestedLabel ? (
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <Clock3 className="h-3 w-3" />
          Sugestão pelo horário: {suggestedLabel}
        </p>
      ) : null}
    </div>
  );
}
