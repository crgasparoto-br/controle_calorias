import React, { useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { trpc } from "@/lib/trpc";
import { CalendarRange, Goal, Save } from "lucide-react";
import { toast } from "sonner";

type GoalDayForm = {
  weekday: number;
  label: string;
  shortLabel: string;
  calories: number;
  proteinGrams: number;
  carbsGrams: number;
  fatGrams: number;
};

const DEFAULT_DAYS: GoalDayForm[] = [
  { weekday: 0, label: "Segunda-feira", shortLabel: "seg.", calories: 2200, proteinGrams: 160, carbsGrams: 240, fatGrams: 70 },
  { weekday: 1, label: "Terça-feira", shortLabel: "ter.", calories: 2200, proteinGrams: 160, carbsGrams: 240, fatGrams: 70 },
  { weekday: 2, label: "Quarta-feira", shortLabel: "qua.", calories: 2200, proteinGrams: 160, carbsGrams: 240, fatGrams: 70 },
  { weekday: 3, label: "Quinta-feira", shortLabel: "qui.", calories: 2200, proteinGrams: 160, carbsGrams: 240, fatGrams: 70 },
  { weekday: 4, label: "Sexta-feira", shortLabel: "sex.", calories: 2200, proteinGrams: 160, carbsGrams: 240, fatGrams: 70 },
  { weekday: 5, label: "Sábado", shortLabel: "sáb.", calories: 2200, proteinGrams: 160, carbsGrams: 240, fatGrams: 70 },
  { weekday: 6, label: "Domingo", shortLabel: "dom.", calories: 2200, proteinGrams: 160, carbsGrams: 240, fatGrams: 70 },
];

function getWeekdayIndex(date: Date) {
  return (date.getDay() + 6) % 7;
}

export default function GoalsPage() {
  const utils = trpc.useUtils();
  const goalQuery = trpc.nutrition.goals.get.useQuery();
  const updateGoal = trpc.nutrition.goals.update.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.nutrition.goals.get.invalidate(),
        utils.nutrition.dashboard.overview.invalidate(),
        utils.nutrition.reports.weekly.invalidate(),
      ]);
      toast.success("Metas semanais atualizadas com sucesso.");
    },
    onError: error => toast.error(error.message || "Falha ao atualizar metas."),
  });

  const [days, setDays] = useState<GoalDayForm[]>(DEFAULT_DAYS);

  useEffect(() => {
    if (!goalQuery.data?.days?.length) return;
    setDays(goalQuery.data.days.map(day => ({
      weekday: day.weekday,
      label: day.label,
      shortLabel: day.shortLabel,
      calories: day.calories,
      proteinGrams: day.proteinGrams,
      carbsGrams: day.carbsGrams,
      fatGrams: day.fatGrams,
    })));
  }, [goalQuery.data]);

  const weeklyTotals = useMemo(() => days.reduce(
    (acc, day) => {
      acc.calories += day.calories;
      acc.proteinGrams += day.proteinGrams;
      acc.carbsGrams += day.carbsGrams;
      acc.fatGrams += day.fatGrams;
      return acc;
    },
    { calories: 0, proteinGrams: 0, carbsGrams: 0, fatGrams: 0 },
  ), [days]);

  const weeklyMacroCalories = weeklyTotals.proteinGrams * 4 + weeklyTotals.carbsGrams * 4 + weeklyTotals.fatGrams * 9;
  const alignment = weeklyTotals.calories ? Math.min((weeklyMacroCalories / weeklyTotals.calories) * 100, 140) : 0;
  const todayGoal = days[getWeekdayIndex(new Date())] ?? days[0];

  function updateDayValue(weekday: number, field: keyof Omit<GoalDayForm, "weekday" | "label" | "shortLabel">, value: number) {
    setDays(current => current.map(day => day.weekday === weekday ? { ...day, [field]: value } : day));
  }

  return (
    <DashboardLayout>
      <div className="grid gap-6 xl:grid-cols-[1.5fr,1fr]">
        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <Goal className="h-5 w-5 text-primary" />
              Planejamento nutricional por dia da semana
            </CardTitle>
            <CardDescription>
              Configure uma meta diferente para cada dia. O sistema passa a comparar o consumo do dia com a meta daquele dia e também acompanha o acumulado planejado da semana inteira.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4">
              {days.map(day => (
                <div key={day.weekday} className="rounded-3xl border bg-muted/20 p-4">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold tracking-tight">{day.label}</p>
                      <p className="text-sm text-muted-foreground">Meta diária específica para planejamento e acompanhamento.</p>
                    </div>
                    <span className="rounded-full bg-background px-3 py-1 text-xs font-medium text-muted-foreground">{day.shortLabel}</span>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <Field label="Calorias" value={day.calories} onChange={value => updateDayValue(day.weekday, "calories", value)} suffix="kcal" />
                    <Field label="Proteínas" value={day.proteinGrams} onChange={value => updateDayValue(day.weekday, "proteinGrams", value)} suffix="g" />
                    <Field label="Carboidratos" value={day.carbsGrams} onChange={value => updateDayValue(day.weekday, "carbsGrams", value)} suffix="g" />
                    <Field label="Gorduras" value={day.fatGrams} onChange={value => updateDayValue(day.weekday, "fatGrams", value)} suffix="g" />
                  </div>
                </div>
              ))}
            </div>
            <Button
              className="rounded-full"
              disabled={updateGoal.isPending}
              onClick={() => updateGoal.mutate({
                days: days.map(day => ({
                  weekday: day.weekday,
                  calories: day.calories,
                  proteinGrams: day.proteinGrams,
                  carbsGrams: day.carbsGrams,
                  fatGrams: day.fatGrams,
                })),
              })}
            >
              <Save className="mr-2 h-4 w-4" />
              {updateGoal.isPending ? "Salvando..." : "Salvar metas da semana"}
            </Button>
          </CardContent>
        </Card>

        <div className="grid gap-6">
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CalendarRange className="h-5 w-5 text-primary" />
                Soma planejada da semana
              </CardTitle>
              <CardDescription>
                Visão consolidada do que foi planejado entre segunda-feira e domingo.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                <SummaryTile label="Calorias semanais" value={`${Math.round(weeklyTotals.calories)} kcal`} />
                <SummaryTile label="Proteínas na semana" value={`${Math.round(weeklyTotals.proteinGrams)} g`} />
                <SummaryTile label="Carboidratos na semana" value={`${Math.round(weeklyTotals.carbsGrams)} g`} />
                <SummaryTile label="Gorduras na semana" value={`${Math.round(weeklyTotals.fatGrams)} g`} />
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle>Foco do dia atual</CardTitle>
              <CardDescription>
                Referência diária usada pelo dashboard e pelos relatórios no acompanhamento do dia.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="rounded-3xl bg-muted/30 p-5">
                <p className="text-sm text-muted-foreground">Meta ativa hoje</p>
                <p className="mt-2 text-3xl font-semibold tracking-tight">{todayGoal.label}</p>
                <p className="mt-2 text-sm text-muted-foreground">{Math.round(todayGoal.calories)} kcal planejadas para o dia.</p>
              </div>
              <div className="grid gap-3">
                <MacroSplit label="Proteínas" value={todayGoal.proteinGrams} calorieFactor={4} accent="bg-emerald-500" />
                <MacroSplit label="Carboidratos" value={todayGoal.carbsGrams} calorieFactor={4} accent="bg-sky-500" />
                <MacroSplit label="Gorduras" value={todayGoal.fatGrams} calorieFactor={9} accent="bg-amber-500" />
              </div>
              <div className="rounded-3xl border bg-background p-4 shadow-sm">
                <p className="text-sm text-muted-foreground">Consistência energética da semana</p>
                <p className="mt-2 text-3xl font-semibold tracking-tight">{Math.round(weeklyMacroCalories)} kcal</p>
                <p className="mt-2 text-sm text-muted-foreground">Equivalente calórico estimado a partir dos macronutrientes planejados na semana.</p>
                <Progress className="mt-4 h-2" value={alignment} />
                <p className="mt-3 text-sm text-muted-foreground">{Math.round(alignment)}% de alinhamento entre macros e calorias planejadas para a semana.</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}

function Field({
  label,
  value,
  onChange,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  suffix: string;
}) {
  return (
    <div className="space-y-2 rounded-2xl border bg-background p-4">
      <Label>{label}</Label>
      <div className="flex items-center gap-3">
        <Input type="number" value={value} onChange={event => onChange(Number(event.target.value))} />
        <span className="text-sm text-muted-foreground">{suffix}</span>
      </div>
    </div>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border bg-muted/20 p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
    </div>
  );
}

function MacroSplit({
  label,
  value,
  calorieFactor,
  accent,
}: {
  label: string;
  value: number;
  calorieFactor: number;
  accent: string;
}) {
  return (
    <div className="rounded-2xl border bg-background p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className={`h-3 w-3 rounded-full ${accent}`} />
          <p className="font-medium tracking-tight">{label}</p>
        </div>
        <p className="text-sm text-muted-foreground">{Math.round(value)} g</p>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{Math.round(value * calorieFactor)} kcal atribuídas a este macronutriente.</p>
    </div>
  );
}
