import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type MealDateTimeInputProps = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
};

export function MealDateTimeInput({ id, label, value, onChange }: MealDateTimeInputProps) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type="datetime-local" value={value} onChange={event => onChange(event.target.value)} />
    </div>
  );
}
