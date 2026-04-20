import React from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { trpc } from "@/lib/trpc";
import { Activity, ArrowRight, BrainCircuit, Flame, Salad, Target } from "lucide-react";
import { Link } from "wouter";

function macroProgress(consumed: number, goal: number) {
  if (!goal) return 0;
  return Math.min((consumed / goal) * 100, 100);
}

export default function Home() {
  const overview = trpc.nutrition.dashboard.overview.useQuery();

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <section className="grid gap-4 xl:grid-cols-[1.5fr,1fr]">
          <Card className="overflow-hidden border-0 bg-gradient-to-br from-emerald-500 via-teal-500 to-cyan-600 text-white shadow-xl shadow-emerald-500/15">
            <CardContent className="relative p-6 sm:p-8">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.2),transparent_40%)]" />
              <div className="relative space-y-5">
                <Badge className="bg-white/12 text-white hover:bg-white/12">IA multimodal ativa</Badge>
                <div className="space-y-2">
                  <h1 className="max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">
                    Acompanhe calorias, macronutrientes e hábitos alimentares em um só painel.
                  </h1>
                  <p className="max-w-2xl text-sm leading-6 text-white/85 sm:text-base">
                    Registre refeições por texto, imagem ou áudio, confirme a inferência da IA e acompanhe sua aderência nutricional em tempo real.
                  </p>
                </div>
                <div className="flex flex-wrap gap-3">
                  <Link href="/log-meal">
                    <Button size="lg" variant="secondary" className="rounded-full bg-white text-emerald-700 hover:bg-white/90">
                      Registrar refeição
                    </Button>
                  </Link>
                  <Link href="/reports">
                    <Button size="lg" variant="outline" className="rounded-full border-white/30 bg-white/10 text-white hover:bg-white/15">
                      Ver relatórios
                    </Button>
                  </Link>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 bg-card shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Target className="h-5 w-5 text-primary" />
                Resumo de hoje
              </CardTitle>
              <CardDescription>Saldo diário com base nas metas cadastradas.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-2xl bg-muted/50 p-4">
                <p className="text-sm text-muted-foreground">Calorias consumidas</p>
                <div className="mt-2 flex items-end justify-between gap-4">
                  <div>
                    <p className="text-3xl font-semibold tracking-tight">
                      {overview.data ? Math.round(overview.data.today.consumed.calories) : "--"}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      de {overview.data?.goal.calories ?? "--"} kcal planejadas
                    </p>
                  </div>
                  <Badge variant="secondary">{overview.data?.today.adherence ?? 0}% da meta</Badge>
                </div>
                <Progress className="mt-4 h-2" value={overview.data?.today.adherence ?? 0} />
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <StatBlock
                  label="Proteínas"
                  value={`${Math.round(overview.data?.today.consumed.protein ?? 0)} g`}
                  sublabel={`Restam ${Math.round(overview.data?.today.remaining.protein ?? 0)} g`}
                />
                <StatBlock
                  label="Carboidratos"
                  value={`${Math.round(overview.data?.today.consumed.carbs ?? 0)} g`}
                  sublabel={`Restam ${Math.round(overview.data?.today.remaining.carbs ?? 0)} g`}
                />
                <StatBlock
                  label="Gorduras"
                  value={`${Math.round(overview.data?.today.consumed.fat ?? 0)} g`}
                  sublabel={`Restam ${Math.round(overview.data?.today.remaining.fat ?? 0)} g`}
                />
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard icon={Flame} title="Calorias" value={`${Math.round(overview.data?.today.consumed.calories ?? 0)} kcal`} description="Consumidas hoje" />
          <MetricCard icon={Salad} title="Refeições" value={`${overview.data?.meals.length ?? 0}`} description="Últimos registros" />
          <MetricCard icon={BrainCircuit} title="Hábitos lembrados" value={`${overview.data?.habits.length ?? 0}`} description="Preferências aprendidas" />
          <MetricCard icon={Activity} title="Evolução semanal" value={`${overview.data?.weekly.length ?? 0} dias`} description="Janela de monitoramento" />
        </section>

        <section className="grid gap-4 xl:grid-cols-[1.4fr,1fr]">
          <Card className="border-0 shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between gap-4">
              <div>
                <CardTitle>Evolução semanal de calorias</CardTitle>
                <CardDescription>Comparação entre consumo diário e meta calórica.</CardDescription>
              </div>
              <Link href="/reports">
                <Button variant="ghost" className="gap-2">
                  Abrir relatórios
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-7">
                {overview.data?.weekly.map(day => {
                  const value = macroProgress(day.calories, day.goalCalories);
                  return (
                    <div key={day.date} className="rounded-2xl border bg-muted/30 p-4">
                      <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">{day.label}</p>
                      <p className="mt-3 text-2xl font-semibold tracking-tight">{Math.round(day.calories)}</p>
                      <p className="text-xs text-muted-foreground">kcal</p>
                      <div className="mt-4 h-28 rounded-full bg-background px-3 py-2">
                        <div className="flex h-full items-end justify-center">
                          <div className="w-full rounded-full bg-primary/15">
                            <div
                              className="rounded-full bg-gradient-to-t from-emerald-500 to-teal-400 transition-all"
                              style={{ height: `${Math.max(value, 6)}%` }}
                            />
                          </div>
                        </div>
                      </div>
                      <p className="mt-3 text-xs text-muted-foreground">Meta {day.goalCalories} kcal</p>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle>Memória de hábitos</CardTitle>
              <CardDescription>Alimentos e padrões que a IA já pode reaproveitar nas próximas inferências.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {overview.data?.habits.length ? (
                overview.data.habits.map(habit => (
                  <div key={habit.foodName} className="rounded-2xl border bg-muted/30 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-medium tracking-tight">{habit.foodName}</p>
                        <p className="text-sm text-muted-foreground">{habit.typicalTimeLabel || "Horário livre"}</p>
                      </div>
                      <Badge variant="secondary">{habit.occurrenceCount}x</Badge>
                    </div>
                    <p className="mt-3 text-sm text-muted-foreground">{habit.notes || "Sem observações adicionais."}</p>
                  </div>
                ))
              ) : (
                <EmptyCopy text="As preferências alimentares aparecerão aqui depois das primeiras confirmações de refeições." />
              )}
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-4 xl:grid-cols-[1.4fr,1fr]">
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle>Refeições recentes</CardTitle>
              <CardDescription>Histórico consolidado após confirmação do usuário.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {overview.data?.meals.length ? (
                overview.data.meals.map(meal => (
                  <div key={meal.id} className="rounded-2xl border bg-background p-4 shadow-sm">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="font-medium tracking-tight">{meal.mealLabel}</p>
                        <p className="text-sm text-muted-foreground">
                          {new Date(meal.occurredAt).toLocaleString("pt-BR")}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary">{meal.source === "web" ? "Web" : "WhatsApp"}</Badge>
                        <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">{Math.round(meal.totals.calories)} kcal</Badge>
                      </div>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {meal.items.map(item => (
                        <Badge key={`${meal.id}-${item.foodName}`} variant="outline" className="rounded-full px-3 py-1 text-xs">
                          {item.foodName} · {item.portionText}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ))
              ) : (
                <EmptyCopy text="Nenhuma refeição foi confirmada ainda. Comece pelo fluxo de registro multimodal." />
              )}
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle>Progresso de macronutrientes</CardTitle>
              <CardDescription>Comparação direta entre consumo atual e objetivo definido.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <MacroBar
                label="Proteínas"
                consumed={overview.data?.today.consumed.protein ?? 0}
                goal={overview.data?.goal.proteinGrams ?? 0}
              />
              <MacroBar
                label="Carboidratos"
                consumed={overview.data?.today.consumed.carbs ?? 0}
                goal={overview.data?.goal.carbsGrams ?? 0}
              />
              <MacroBar
                label="Gorduras"
                consumed={overview.data?.today.consumed.fat ?? 0}
                goal={overview.data?.goal.fatGrams ?? 0}
              />
            </CardContent>
          </Card>
        </section>
      </div>
    </DashboardLayout>
  );
}

function MetricCard({
  icon: Icon,
  title,
  value,
  description,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  value: string;
  description: string;
}) {
  return (
    <Card className="border-0 bg-card shadow-sm">
      <CardContent className="flex items-start justify-between gap-4 p-5">
        <div>
          <p className="text-sm text-muted-foreground">{title}</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </div>
      </CardContent>
    </Card>
  );
}

function StatBlock({ label, value, sublabel }: { label: string; value: string; sublabel: string }) {
  return (
    <div className="rounded-2xl border bg-background p-4 shadow-sm">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 text-xl font-semibold tracking-tight">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{sublabel}</p>
    </div>
  );
}

function MacroBar({ label, consumed, goal }: { label: string; consumed: number; goal: number }) {
  const progress = macroProgress(consumed, goal);
  return (
    <div className="space-y-2 rounded-2xl border bg-muted/30 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="font-medium tracking-tight">{label}</p>
        <p className="text-sm text-muted-foreground">
          {Math.round(consumed)} g / {Math.round(goal)} g
        </p>
      </div>
      <Progress value={progress} className="h-2" />
      <p className="text-xs text-muted-foreground">{Math.round(progress)}% da meta atingida hoje.</p>
    </div>
  );
}

function EmptyCopy({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed bg-muted/20 p-6 text-sm leading-6 text-muted-foreground">
      {text}
    </div>
  );
}
