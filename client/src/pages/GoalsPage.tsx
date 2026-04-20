import React from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { trpc } from "@/lib/trpc";
import { Goal, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

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
      toast.success("Metas atualizadas com sucesso.");
    },
    onError: error => toast.error(error.message || "Falha ao atualizar metas."),
  });

  const [calories, setCalories] = useState(2200);
  const [proteinGrams, setProteinGrams] = useState(160);
  const [carbsGrams, setCarbsGrams] = useState(240);
  const [fatGrams, setFatGrams] = useState(70);

  useEffect(() => {
    if (!goalQuery.data) return;
    setCalories(goalQuery.data.calories);
    setProteinGrams(goalQuery.data.proteinGrams);
    setCarbsGrams(goalQuery.data.carbsGrams);
    setFatGrams(goalQuery.data.fatGrams);
  }, [goalQuery.data]);

  const totalMacroCalories = proteinGrams * 4 + carbsGrams * 4 + fatGrams * 9;
  const alignment = calories ? Math.min((totalMacroCalories / calories) * 100, 140) : 0;

  return (
    <DashboardLayout>
      <div className="grid gap-6 xl:grid-cols-[1fr,0.9fr]">
        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <Goal className="h-5 w-5 text-primary" />
              Metas nutricionais por usuário
            </CardTitle>
            <CardDescription>
              Defina o objetivo diário de calorias, proteínas, carboidratos e gorduras. Esses parâmetros alimentam o dashboard, os relatórios e o cálculo do saldo diário.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Calorias diárias" value={calories} onChange={setCalories} suffix="kcal" />
              <Field label="Proteínas" value={proteinGrams} onChange={setProteinGrams} suffix="g" />
              <Field label="Carboidratos" value={carbsGrams} onChange={setCarbsGrams} suffix="g" />
              <Field label="Gorduras" value={fatGrams} onChange={setFatGrams} suffix="g" />
            </div>
            <Button
              className="rounded-full"
              disabled={updateGoal.isPending}
              onClick={() =>
                updateGoal.mutate({
                  calories,
                  proteinGrams,
                  carbsGrams,
                  fatGrams,
                })
              }
            >
              <Save className="mr-2 h-4 w-4" />
              {updateGoal.isPending ? "Salvando..." : "Salvar metas"}
            </Button>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle>Consistência energética</CardTitle>
            <CardDescription>
              Visualize a relação entre sua meta calórica total e a distribuição de calorias estimada pelos macronutrientes configurados.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="rounded-3xl bg-muted/30 p-5">
              <p className="text-sm text-muted-foreground">Calorias calculadas pelos macros</p>
              <p className="mt-2 text-4xl font-semibold tracking-tight">{Math.round(totalMacroCalories)} kcal</p>
              <p className="mt-2 text-sm text-muted-foreground">Meta registrada: {Math.round(calories)} kcal</p>
              <Progress className="mt-4 h-2" value={alignment} />
              <p className="mt-3 text-sm text-muted-foreground">
                {Math.round(alignment)}% de alinhamento entre os macronutrientes e a meta calórica total.
              </p>
            </div>
            <div className="grid gap-3">
              <MacroSplit label="Proteínas" value={proteinGrams} calorieFactor={4} accent="bg-emerald-500" />
              <MacroSplit label="Carboidratos" value={carbsGrams} calorieFactor={4} accent="bg-sky-500" />
              <MacroSplit label="Gorduras" value={fatGrams} calorieFactor={9} accent="bg-amber-500" />
            </div>
          </CardContent>
        </Card>
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
    <div className="space-y-2 rounded-2xl border bg-muted/20 p-4">
      <Label>{label}</Label>
      <div className="flex items-center gap-3">
        <Input type="number" value={value} onChange={event => onChange(Number(event.target.value))} />
        <span className="text-sm text-muted-foreground">{suffix}</span>
      </div>
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
