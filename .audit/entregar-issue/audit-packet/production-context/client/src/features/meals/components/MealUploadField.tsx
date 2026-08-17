import React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type MealUploadFieldProps = {
  id: string;
  label: string;
  icon: React.ReactNode;
  fileName?: string;
  accept: string;
  onChange: React.ChangeEventHandler<HTMLInputElement>;
};

export function MealUploadField({ id, label, icon, fileName, accept, onChange }: MealUploadFieldProps) {
  return (
    <div className="space-y-2 rounded-2xl border bg-muted/20 p-4">
      <Label htmlFor={id} className="flex items-center gap-2 text-sm font-medium">
        {icon}
        {label}
      </Label>
      <Input id={id} type="file" accept={accept} onChange={onChange} />
      <p className="text-xs text-muted-foreground">{fileName ?? "Nenhum arquivo selecionado."}</p>
    </div>
  );
}
