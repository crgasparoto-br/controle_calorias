import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { getBrowserTimeZone, toDateTimeLocalValue, zonedDateTimeLocalToIso } from "@/lib/dateTime";
import { formatCalories, formatGrams } from "@/lib/numberFormat";
import { trpc } from "@/lib/trpc";
import { MealItemEditor, SummaryPill } from "@/features/meals/components";
import { sumItems } from "@/features/meals/mealFormState";
import type { MealItemState } from "@/features/meals/types";
import { CheckCircle2, Loader2, MessageCircle, Plus, Save, Trash2 } from "lucide-react";
import React from "react";
import { toast } from "sonner";
import { useRoute } from "wouter";

function getWhatsAppReturnUrl() {
  return "https://wa.me/";
}

function createEmptyQuickEditItem(): MealItemState {
  return {
    foodName: "",
    canonicalName: "",
    portionText: "1 porção",
    quantity: 1,
    unit: "porção",
    servings: 1,
    estimatedGrams: 0,
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
    confidence: 1,
    source: "heuristic",
  };
}

function QuickEditErrorState({ message }: { message: string }) {
  return (
    <main className="min-h-screen bg-background px-4 py-6">
      <div className="mx-auto flex min-h-[70vh] max-w-xl items-center justify-center">
        <div className="space-y-3 rounded-2xl border border-dashed bg-muted/20 p-6 text-center">
          <p className="text-lg font-semibold tracking-tight">Não foi possível abrir a edição</p>
          <p className="text-sm leading-6 text-muted-foreground">{message}</p>
        </div>
      </div>
    </main>
  );
}

export default function QuickEditMealPage() {
  const [, params] = useRoute("/quick-edit/:token");
  const token = params?.token ?? "";
  const userTimeZone = React.useMemo(() => getBrowserTimeZone(), []);
  const mealQuery = trpc.quickEdit.getMeal.useQuery({ token }, { enabled: Boolean(token), retry: false });
  const updateMeal = trpc.quickEdit.updateMeal.useMutation({
    onSuccess: () => toast.success("Refeição atualizada com sucesso."),
    onError: error => toast.error(error.message || "Não foi possível salvar a edição."),
  });

  const [mealLabel, setMealLabel] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [occurredAt, setOccurredAt] = React.useState(() => toDateTimeLocalValue());
  const [items, setItems] = React.useState<MealItemState[]>([]);

  React.useEffect(() => {
    const meal = mealQuery.data?.meal;
    if (!meal) return;

    setMealLabel(meal.mealLabel);
    setNotes(meal.notes ?? "");
    setOccurredAt(toDateTimeLocalValue(new Date(meal.occurredAt), userTimeZone));
    setItems(meal.items ?? []);
  }, [mealQuery.data?.meal, userTimeZone]);

  const totals = React.useMemo(() => sumItems(items), [items]);
  const expiresAtLabel = mealQuery.data?.expiresAt
    ? new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: userTimeZone,
      }).format(new Date(mealQuery.data.expiresAt))
    : null;

  const updateItem = <K extends keyof MealItemState>(index: number, key: K, value: MealItemState[K]) => {
    setItems(current => current.map((item, currentIndex) => currentIndex === index ? { ...item, [key]: value } : item));
  };

  const removeItem = (index: number) => {
    setItems(current => current.filter((_item, currentIndex) => currentIndex !== index));
  };

  const handleSave = () => {
    const normalizedItems = items
      .map(item => ({
        ...item,
        foodName: item.foodName.trim(),
        canonicalName: item.canonicalName.trim() || item.foodName.trim(),
        portionText: item.portionText.trim() || "1 porção",
        confidence: Number(item.confidence || 1),
      }))
      .filter(item => item.foodName);

    if (!mealLabel.trim()) {
      toast.error("Informe o nome da refeição.");
      return;
    }
    if (!normalizedItems.length) {
      toast.error("Mantenha pelo menos um alimento na refeição.");
      return;
    }

    updateMeal.mutate({
      token,
      meal: {
        mealLabel: mealLabel.trim(),
        occurredAt: zonedDateTimeLocalToIso(occurredAt, userTimeZone),
        notes: notes.trim() || undefined,
        items: normalizedItems,
      },
    });
  };

  if (!token) {
    return <QuickEditErrorState message="O link recebido não contém um token de edição válido." />;
  }

  if (mealQuery.isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-4" role="status" aria-live="polite">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando refeição...
        </div>
      </main>
    );
  }

  if (mealQuery.error || !mealQuery.data?.meal) {
    return <QuickEditErrorState message="Esse link pode ter expirado, já não existir ou não estar mais disponível." />;
  }

  return (
    <main className="min-h-screen bg-background px-4 py-5">
      <div className="mx-auto max-w-2xl space-y-5">
        <header className="space-y-2">
          <p className="text-sm font-medium text-primary">Edição rápida</p>
          <h1 className="text-2xl font-semibold tracking-tight">Ajustar refeição</h1>
          <p className="text-sm leading-6 text-muted-foreground">
            Revise alimentos, quantidades e unidades antes de salvar. {expiresAtLabel ? `Link válido até ${expiresAtLabel}.` : null}
          </p>
        </header>

        <section className="grid gap-3 sm:grid-cols-4">
          <SummaryPill label="Calorias" value={formatCalories(totals.calories)} />
          <SummaryPill label="Proteínas" value={formatGrams(totals.protein)} />
          <SummaryPill label="Carboidratos" value={formatGrams(totals.carbs)} />
          <SummaryPill label="Gorduras" value={formatGrams(totals.fat)} />
        </section>

        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle>Dados da refeição</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="quick-edit-label">Refeição</Label>
                <Input id="quick-edit-label" value={mealLabel} onChange={event => setMealLabel(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="quick-edit-occurred-at">Data e hora</Label>
                <Input id="quick-edit-occurred-at" type="datetime-local" value={occurredAt} onChange={event => setOccurredAt(event.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="quick-edit-notes">Observações</Label>
              <Textarea id="quick-edit-notes" value={notes} onChange={event => setNotes(event.target.value)} rows={3} />
            </div>
          </CardContent>
        </Card>

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold tracking-tight">Alimentos</h2>
            <Button type="button" variant="outline" className="rounded-full" onClick={() => setItems(current => [...current, createEmptyQuickEditItem()])}>
              <Plus className="mr-2 h-4 w-4" />
              Adicionar
            </Button>
          </div>

          {items.map((item, index) => (
            <Card key={`${item.foodName}-${index}`} className="border shadow-sm">
              <CardContent className="space-y-4 pt-6">
                <MealItemEditor item={item} onChange={(key, value) => updateItem(index, key, value)} />
                <Button type="button" variant="outline" className="w-full rounded-full text-destructive" onClick={() => removeItem(index)} disabled={items.length <= 1}>
                  <Trash2 className="mr-2 h-4 w-4" />
                  Remover alimento
                </Button>
              </CardContent>
            </Card>
          ))}
        </section>

        <div className="sticky bottom-0 -mx-4 border-t bg-background/95 px-4 py-3 backdrop-blur">
          <div className="mx-auto flex max-w-2xl flex-col gap-2 sm:flex-row">
            <Button type="button" className="rounded-full" onClick={handleSave} disabled={updateMeal.isPending}>
              {updateMeal.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Salvar ajustes
            </Button>
            <Button type="button" variant="outline" className="rounded-full" asChild>
              <a href={getWhatsAppReturnUrl()}>
                <MessageCircle className="mr-2 h-4 w-4" />
                Voltar ao WhatsApp
              </a>
            </Button>
          </div>
        </div>

        {updateMeal.isSuccess ? (
          <div className="flex items-center gap-2 rounded-2xl border bg-muted/20 p-4 text-sm" role="status" aria-live="polite">
            <CheckCircle2 className="h-4 w-4 text-primary" />
            Ajustes salvos. Você já pode voltar ao WhatsApp.
          </div>
        ) : null}
      </div>
    </main>
  );
}
