import React from "react";
type MealEmptyStateProps = {
  text: string;
};

export function MealEmptyState({ text }: MealEmptyStateProps) {
  return <div className="rounded-2xl border border-dashed bg-muted/20 p-6 text-sm leading-6 text-muted-foreground">{text}</div>;
}
