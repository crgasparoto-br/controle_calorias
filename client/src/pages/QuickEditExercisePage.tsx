import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { getBrowserTimeZone, toDateTimeLocalValue, zonedDateTimeLocalToIso } from "@/lib/dateTime";
import { formatCalories } from "@/lib/numberFormat";
import { trpc } from "@/lib/trpc";
import { Activity, CheckCircle2, Clock, Flame, Loader2, MessageCircle, Save } from "lucide-react";
import React from "react";
import { toast } from "sonner";
import { useRoute } from "wouter";

function getWhatsAppReturnUrl() {
  return "https://wa.me/";
}

function QuickEditErrorState({ message }: { message: string }) {
  return (
    <main className="min-h-screen bg-background px-4 py-6">
      <div className="mx-auto flex min-h-[70vh] max-w-xl items-center justify-center">
        <div className="space-y-3 rounded-2xl border border-dashed bg-muted/20 p-6 text-center">
          <p className="text-lg font-semibold tracking-tight">Não foi possível abrir o exercício</p>
          <p className="text-sm leading-6 text-muted-foreground">{message}</p>
        </div>
      </div>
    </main>
  );
}

function StatPill({ icon: Icon, label, value }: { icon: typeof Activity; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-background px-4 py-3">
      <Icon className="h-4 w-4 text-primary" />
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-semibold">{value}</p>
      </div>
    </div>
  );
}

export default function QuickEditExercisePage() {
  const [, params] = useRoute("/quick-edit/exercise/:token");
  const token = params?.token ?? "";
  const userTimeZone = React.useMemo(() => getBrowserTimeZone(), []);
  const exerciseQuery = trpc.quickEdit.getExercise.useQuery({ token }, { enabled: Boolean(token), retry: false });
  const updateExercise = trpc.quickEdit.updateExercise.useMutation({
    onSuccess: () => toast.success("Exercício atualizado com sucesso."),
    onError: error => toast.error(error.message || "Não foi possível salvar o exercício."),
  });

  const [activityType, setActivityType] = React.useState("");
  const [durationMinutes, setDurationMinutes] = React.useState("");
  const [caloriesBurned, setCaloriesBurned] = React.useState("");
  const [occurredAt, setOccurredAt] = React.useState(() => toDateTimeLocalValue());
  const [notes, setNotes] = React.useState("");

  React.useEffect(() => {
    const exercise = exerciseQuery.data?.exercise;
    if (!exercise) return;

    setActivityType(exercise.activityType);
    setDurationMinutes(String(exercise.durationMinutes));
    setCaloriesBurned(String(exercise.caloriesBurned));
    setOccurredAt(toDateTimeLocalValue(new Date(exercise.occurredAt), userTimeZone));
    setNotes(exercise.notes ?? "");
  }, [exerciseQuery.data?.exercise, userTimeZone]);

  const durationValue = Number(durationMinutes || 0);
  const caloriesValue = Number(caloriesBurned || 0);
  const expiresAtLabel = exerciseQuery.data?.expiresAt
    ? new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: userTimeZone,
      }).format(new Date(exerciseQuery.data.expiresAt))
    : null;

  const handleSave = () => {
    const normalizedActivityType = activityType.trim();
    const normalizedDuration = Math.round(Number(durationMinutes));
    const normalizedCalories = Number(caloriesBurned);

    if (normalizedActivityType.length < 2) {
      toast.error("Informe o tipo de exercício.");
      return;
    }
    if (!Number.isFinite(normalizedDuration) || normalizedDuration < 1) {
      toast.error("Informe uma duração válida em minutos.");
      return;
    }
    if (!Number.isFinite(normalizedCalories) || normalizedCalories < 1) {
      toast.error("Informe as calorias queimadas.");
      return;
    }

    updateExercise.mutate({
      token,
      exercise: {
        activityType: normalizedActivityType,
        durationMinutes: normalizedDuration,
        caloriesBurned: normalizedCalories,
        occurredAt: zonedDateTimeLocalToIso(occurredAt, userTimeZone),
        notes: notes.trim() || undefined,
      },
    });
  };

  if (!token) {
    return <QuickEditErrorState message="O link recebido não contém um token de edição válido." />;
  }

  if (exerciseQuery.isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-4" role="status" aria-live="polite">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando exercício...
        </div>
      </main>
    );
  }

  if (exerciseQuery.error || !exerciseQuery.data?.exercise) {
    return <QuickEditErrorState message="Esse link pode ter expirado, já não existir ou não estar mais disponível." />;
  }

  return (
    <main className="min-h-screen bg-background px-4 py-5">
      <div className="mx-auto max-w-2xl space-y-5">
        <header className="space-y-2">
          <p className="text-sm font-medium text-primary">Edição rápida</p>
          <h1 className="text-2xl font-semibold tracking-tight">Ajustar exercício</h1>
          <p className="text-sm leading-6 text-muted-foreground">
            Revise os dados do treino importado antes de salvar. {expiresAtLabel ? `Link válido até ${expiresAtLabel}.` : null}
          </p>
        </header>

        <section className="grid gap-3 sm:grid-cols-3">
          <StatPill icon={Activity} label="Tipo" value={activityType || "Exercício"} />
          <StatPill icon={Clock} label="Duração" value={`${Math.max(Math.round(durationValue), 0)} min`} />
          <StatPill icon={Flame} label="Calorias" value={formatCalories(Math.max(caloriesValue, 0))} />
        </section>

        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle>Dados do exercício</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="quick-edit-exercise-type">Tipo de exercício</Label>
              <Input id="quick-edit-exercise-type" value={activityType} onChange={event => setActivityType(event.target.value)} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="quick-edit-exercise-duration">Duração em minutos</Label>
                <Input id="quick-edit-exercise-duration" type="number" min={1} step={1} value={durationMinutes} onChange={event => setDurationMinutes(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="quick-edit-exercise-calories">Calorias queimadas</Label>
                <Input id="quick-edit-exercise-calories" type="number" min={1} step={1} value={caloriesBurned} onChange={event => setCaloriesBurned(event.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="quick-edit-exercise-occurred-at">Data e hora</Label>
              <Input id="quick-edit-exercise-occurred-at" type="datetime-local" value={occurredAt} onChange={event => setOccurredAt(event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="quick-edit-exercise-notes">Observações</Label>
              <Textarea id="quick-edit-exercise-notes" value={notes} onChange={event => setNotes(event.target.value)} rows={4} />
            </div>
          </CardContent>
        </Card>

        <div className="sticky bottom-0 -mx-4 border-t bg-background/95 px-4 py-3 backdrop-blur">
          <div className="mx-auto flex max-w-2xl flex-col gap-2 sm:flex-row">
            <Button type="button" className="rounded-full" onClick={handleSave} disabled={updateExercise.isPending}>
              {updateExercise.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Salvar exercício
            </Button>
            <Button type="button" variant="outline" className="rounded-full" asChild>
              <a href={getWhatsAppReturnUrl()}>
                <MessageCircle className="mr-2 h-4 w-4" />
                Voltar ao WhatsApp
              </a>
            </Button>
          </div>
        </div>

        {updateExercise.isSuccess ? (
          <div className="flex items-center gap-2 rounded-2xl border bg-muted/20 p-4 text-sm" role="status" aria-live="polite">
            <CheckCircle2 className="h-4 w-4 text-primary" />
            Ajustes salvos. Você já pode voltar ao WhatsApp.
          </div>
        ) : null}
      </div>
    </main>
  );
}
