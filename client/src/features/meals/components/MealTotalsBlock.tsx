import { formatCalories, formatGrams } from "@/lib/numberFormat";
import { SummaryPill } from "./SummaryPill";

type MealTotalsBlockProps = {
  title: string;
  totals: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
  };
};

export function MealTotalsBlock({ title, totals }: MealTotalsBlockProps) {
  return (
    <div className="rounded-2xl border bg-muted/30 p-4">
      <p className="text-sm text-muted-foreground">{title}</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-4">
        <SummaryPill label="Calorias" value={formatCalories(totals.calories)} />
        <SummaryPill label="Proteínas" value={formatGrams(totals.protein)} />
        <SummaryPill label="Carboidratos" value={formatGrams(totals.carbs)} />
        <SummaryPill label="Gorduras" value={formatGrams(totals.fat)} />
      </div>
    </div>
  );
}
