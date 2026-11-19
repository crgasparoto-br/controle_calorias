import React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type MealDateTimeInputProps = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
};

export function MealDateTimeInput({ id, label, value, onChange, disabled = false }: MealDateTimeInputProps) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type="datetime-local" value={value} onChange={event => onChange(event.target.value)} disabled={disabled} />
    </div>
  );
}
