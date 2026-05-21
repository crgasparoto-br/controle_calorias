import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTimeInTimeZone } from "@/lib/dateTime";
import { formatCalories } from "@/lib/numberFormat";
import { Copy, ListChecks, PencilLine, Star, Trash2 } from "lucide-react";
import { MealEmptyState } from "./MealEmptyState";
import type { StoredMeal } from "../types";

type MealDayRecordsCardProps = {
  meals: StoredMeal[];
  userTimeZone: string;
  selectedMealId?: number;
  isLoading?: boolean;
  isCopyPending?: boolean;
  isFavoritePending?: boolean;
  isRemovePending?: boolean;
  onEditMeal: (meal: StoredMeal) => void;
  onCopyMeal: (meal: StoredMeal) => void;
  onFavoriteMeal: (meal: StoredMeal) => void;
  onRemoveMeal: (meal: StoredMeal) => void;
};

export function MealDayRecordsCard({
  meals,
  userTimeZone,
  selectedMealId,
  isLoading,
  isCopyPending,
  isFavoritePending,
  isRemovePending,
  onEditMeal,
  onCopyMeal,
  onFavoriteMeal,
  onRemoveMeal,
}: MealDayRecordsCardProps) {
  return (
    <Card defaultOpen className="border-0 shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl">
          <ListChecks className="h-5 w-5 text-primary" />
          Registros do dia
        </CardTitle>
        <CardDescription>
          A edição detalhada continua disponível na tela de Registros; aqui ficam os atalhos para revisar o que acabou de entrar.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {meals.length ? (
          meals.map(meal => (
            <div key={meal.id} className="rounded-2xl border bg-background p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium tracking-tight">{meal.mealLabel}</p>
                    <Badge variant="secondary">{meal.source === "web" ? "Web" : "WhatsApp"}</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">{formatDateTimeInTimeZone(meal.occurredAt, userTimeZone)}</p>
                  {meal.notes ? <p className="mt-2 text-sm text-muted-foreground">{meal.notes}</p> : null}
                </div>
                <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">{formatCalories(meal.totals.calories)}</Badge>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {meal.items.map((item, index) => (
                  <Badge key={`${meal.id}-${item.foodName}-${index}`} variant="outline" className="rounded-full px-3 py-1 text-xs">
                    {item.foodName} · {item.portionText}
                  </Badge>
                ))}
              </div>
              <div className="mt-4 flex flex-wrap gap-3">
                <Button
                  type="button"
                  variant={selectedMealId === meal.id ? "default" : "outline"}
                  className="rounded-full"
                  onClick={() => onEditMeal(meal)}
                >
                  <PencilLine className="mr-2 h-4 w-4" />
                  {selectedMealId === meal.id ? "Editando agora" : "Editar"}
                </Button>
                <Button type="button" variant="outline" className="rounded-full" onClick={() => onCopyMeal(meal)} disabled={isCopyPending}>
                  <Copy className="mr-2 h-4 w-4" />
                  Copiar
                </Button>
                <Button type="button" variant="outline" className="rounded-full" onClick={() => onFavoriteMeal(meal)} disabled={isFavoritePending}>
                  <Star className="mr-2 h-4 w-4" />
                  Favoritar
                </Button>
                <Button type="button" variant="ghost" className="rounded-full text-destructive hover:text-destructive" onClick={() => onRemoveMeal(meal)} disabled={isRemovePending}>
                  <Trash2 className="mr-2 h-4 w-4" />
                  Excluir
                </Button>
              </div>
            </div>
          ))
        ) : (
          <MealEmptyState text={isLoading ? "Carregando registros..." : "Nenhuma refeição foi registrada para esta data. Use qualquer uma das abas acima para começar."} />
        )}
      </CardContent>
    </Card>
  );
}
