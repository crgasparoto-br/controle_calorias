import React from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { BarChart3, Clock3, TrendingUp } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

function formatMacro(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
}

function formatMealTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function ReportsPage() {
  const weekly = trpc.nutrition.reports.weekly.useQuery();
  const meals = trpc.nutrition.meals.list.useQuery();

  const caloricTrend = weekly.data ?? [];
  const macroTrend = (weekly.data ?? []).map(day => ({
    label: day.label,
    protein: Math.round(day.protein),
    carbs: Math.round(day.carbs),
    fat: Math.round(day.fat),
  }));
  const detailedMeals = meals.data ?? [];

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="grid gap-4 lg:grid-cols-3">
          <HighlightCard
            title="Consumo semanal"
            value={`${Math.round(caloricTrend.reduce((acc, day) => acc + day.calories, 0))} kcal`}
            description="Soma do período monitorado nos últimos sete dias."
          />
          <HighlightCard
            title="Média diária"
            value={`${Math.round(caloricTrend.reduce((acc, day) => acc + day.calories, 0) / Math.max(caloricTrend.length, 1))} kcal`}
            description="Média simples de calorias ingeridas por dia."
          />
          <HighlightCard
            title="Maior consumo"
            value={`${Math.round(Math.max(...caloricTrend.map(day => day.calories), 0))} kcal`}
            description="Pico calórico identificado na janela semanal atual."
          />
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.2fr,0.8fr]">
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-primary" />
                Calorias consumidas versus meta
              </CardTitle>
              <CardDescription>
                Compare o volume de ingestão de cada dia com a meta calórica diária configurada para o usuário.
              </CardDescription>
            </CardHeader>
            <CardContent className="h-[360px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={caloricTrend} barSize={28}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="goalCalories" name="Meta" fill="#cbd5e1" radius={[8, 8, 0, 0]} />
                  <Bar dataKey="calories" name="Consumido" fill="#10b981" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-primary" />
                Leitura da semana
              </CardTitle>
              <CardDescription>Resumo analítico do comportamento alimentar observado no período.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {caloricTrend.map(day => {
                const delta = day.calories - day.goalCalories;
                return (
                  <div key={day.date} className="rounded-2xl border bg-muted/20 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-medium tracking-tight">{day.label}</p>
                      <p className={`text-sm font-medium ${delta > 0 ? "text-amber-600" : "text-emerald-600"}`}>
                        {delta > 0 ? `+${Math.round(delta)}` : Math.round(delta)} kcal
                      </p>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">
                      Proteínas {Math.round(day.protein)} g · Carboidratos {Math.round(day.carbs)} g · Gorduras {Math.round(day.fat)} g
                    </p>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>

        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle>Distribuição de macronutrientes</CardTitle>
            <CardDescription>
              Evolução agregada de proteínas, carboidratos e gorduras ao longo da semana. Útil para avaliar consistência alimentar e desvios de estratégia.
            </CardDescription>
          </CardHeader>
          <CardContent className="h-[360px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={macroTrend}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="protein" name="Proteínas" stroke="#10b981" strokeWidth={3} dot={{ r: 4 }} />
                <Line type="monotone" dataKey="carbs" name="Carboidratos" stroke="#0ea5e9" strokeWidth={3} dot={{ r: 4 }} />
                <Line type="monotone" dataKey="fat" name="Gorduras" stroke="#f59e0b" strokeWidth={3} dot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle>Detalhamento das refeições registradas</CardTitle>
            <CardDescription>
              Lista completa das refeições com horário do registro e composição nutricional de cada alimento confirmado.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {detailedMeals.length ? (
              detailedMeals.map(meal => (
                <div key={meal.id} className="rounded-2xl border bg-muted/20 p-4">
                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="font-semibold tracking-tight">{meal.mealLabel}</p>
                      <p className="text-sm text-muted-foreground">
                        Total da refeição: {formatMacro(meal.totals.calories)} kcal · {formatMacro(meal.totals.protein)} g proteína · {formatMacro(meal.totals.carbs)} g carboidratos · {formatMacro(meal.totals.fat)} g gorduras
                      </p>
                    </div>
                    <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                      <Clock3 className="h-4 w-4" />
                      Horário do registro: {formatMealTime(meal.occurredAt)}
                    </div>
                  </div>

                  <div className="mt-4 space-y-3">
                    {meal.items.map((item, index) => (
                      <div key={`${meal.id}-${item.foodName}-${index}`} className="rounded-xl bg-background p-3 shadow-sm">
                        <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                          <p className="font-medium">{item.foodName}</p>
                          <p className="text-sm text-muted-foreground">Porção: {item.portionText}</p>
                        </div>
                        <p className="mt-2 text-sm text-muted-foreground">
                          Proteínas {formatMacro(item.protein)} g · Carboidratos {formatMacro(item.carbs)} g · Gorduras {formatMacro(item.fat)} g · Calorias {formatMacro(item.calories)} kcal
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-2xl border border-dashed bg-muted/10 p-6 text-sm text-muted-foreground">
                Nenhuma refeição confirmada foi encontrada para detalhamento no relatório.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}

function HighlightCard({ title, value, description }: { title: string; value: string; description: string }) {
  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="p-5">
        <p className="text-sm text-muted-foreground">{title}</p>
        <p className="mt-2 text-3xl font-semibold tracking-tight">{value}</p>
        <p className="mt-2 text-sm text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}
