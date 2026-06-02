import React from "react";
import DashboardLayout from "@/components/DashboardLayout";
import PageIntro from "@/components/PageIntro";
import UXState from "@/components/UXState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { formatCalories, formatCountPtBr, formatGrams, formatPercentPtBr } from "@/lib/numberFormat";
import { trpc } from "@/lib/trpc";
import { buildDailyNutritionStatus, SAFE_NUTRITION_MESSAGES } from "@shared/safeMessages";
import { ArrowRight, BrainCircuit, Droplets, Dumbbell, Flame, ListChecks, Salad } from "lucide-react";
import { toast } from "sonner";
import { Link } from "wouter";

type AssistantSuggestion = {
  text: string;
  suggestedFoods: Array<{
    foodName: string;
    portionText: string;
    estimatedGrams: number;
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
  }>;
  estimatedCalories: number;
  estimatedMacros: {
    protein: number;
    carbs: number;
    fat: number;
  };
  alert?: string;
  educationalNotice: string;
};

function macroProgress(consumed: number, goal: number) {
  if (!goal) return 0;
  return Math.min((consumed / goal) * 100, 100);
}

function positiveRemaining(value: number) {
  return Math.max(value, 0);
}

export default function Home() {
  const utils = trpc.useUtils();
  const overview = trpc.nutrition.dashboard.overview.useQuery();
  const [assistantMessage, setAssistantMessage] = React.useState("");
  const [assistantSuggestion, setAssistantSuggestion] = React.useState<AssistantSuggestion | null>(null);

  const assistantSuggest = trpc.nutrition.assistant.suggest.useMutation({
    onSuccess: result => {
      setAssistantSuggestion(result as AssistantSuggestion);
    },
    onError: error => toast.error(error.message || "Não foi possível gerar uma sugestão agora."),
  });

  const saveAssistantMeal = trpc.nutrition.meals.createManual.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.nutrition.dashboard.overview.invalidate(),
        utils.nutrition.meals.list.invalidate(),
        utils.nutrition.meals.dayTotals.invalidate(),
        utils.nutrition.reports.weekly.invalidate(),
      ]);
      toast.success("Sugestão salva como refeição.");
    },
    onError: error => toast.error(error.message || "Não foi possível salvar a sugestão."),
  });

  const handleAssistantSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!assistantMessage.trim()) return;
    assistantSuggest.mutate({ message: assistantMessage });
  };

  const handleAssistantShortcut = (message: string) => {
    setAssistantMessage(message);
    assistantSuggest.mutate({ message });
  };

  const handleSaveSuggestionAsMeal = () => {
    if (!assistantSuggestion?.suggestedFoods.length) {
      toast.error("A sugestão não tem alimentos suficientes para salvar.");
      return;
    }

    saveAssistantMeal.mutate({
      mealLabel: "jantar",
      occurredAt: new Date().toISOString(),
      notes: "Sugestão educativa do assistente alimentar.",
      items: assistantSuggestion.suggestedFoods.map(food => ({
        foodName: food.foodName,
        canonicalName: food.foodName,
        portionText: food.portionText,
        servings: 1,
        estimatedGrams: food.estimatedGrams,
        calories: food.calories,
        protein: food.protein,
        carbs: food.carbs,
        fat: food.fat,
        confidence: 0.7,
        source: "heuristic" as const,
      })),
    });
  };

  const todaysMeals = overview.data?.meals ?? [];
  const consumedCalories = overview.data?.today.consumed.calories ?? 0;
  const calorieGoal = overview.data?.today.goal.calories ?? 0;
  const remainingCalories = overview.data?.today.remaining.calories ?? 0;
  const dailyStatus = buildDailyNutritionStatus(consumedCalories, calorieGoal, overview.data?.today.remaining.protein ?? 0);
  const exerciseCount = overview.data?.exercises.length ?? 0;
  const waterLogCount = overview.data?.water.logs.length ?? 0;

  if (overview.isLoading) {
    return (
      <DashboardLayout>
        <div className="mx-auto flex max-w-7xl flex-col gap-6">
          <div className="grid gap-4 md:grid-cols-3">
            <Skeleton className="h-36 rounded-2xl" />
            <Skeleton className="h-36 rounded-2xl" />
            <Skeleton className="h-36 rounded-2xl" />
          </div>
          <Skeleton className="h-80 rounded-2xl" />
        </div>
      </DashboardLayout>
    );
  }

  if (overview.isError) {
    return (
      <DashboardLayout>
        <div className="mx-auto max-w-7xl">
          <UXState
            variant="error"
            title="Não foi possível carregar o Hoje agora"
            description="Tente atualizar a página em instantes. Seus registros seguem sendo a base para acompanhar próximos passos com calma."
          />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="mx-auto flex max-w-7xl flex-col gap-8">
        <PageIntro
          eyebrow="Hoje"
          title="Como está o seu dia agora?"
          description="Esta tela fica focada no presente: saldo do dia, macros, água, exercícios, refeições recentes e atalhos para agir rápido."
          actions={
            <>
              <Link href="/registrar">
                <Button className="rounded-full">
                  Registrar refeição
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
              <Link href="/meals">
                <Button variant="outline" className="rounded-full">
                  Ver registros de hoje
                </Button>
              </Link>
              <Link href="/reports">
                <Button variant="outline" className="rounded-full">
                  Ver relatório da semana
                </Button>
              </Link>
            </>
          }
          stats={
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <DailyMetric
                title="Calorias consumidas"
                value={formatCalories(consumedCalories)}
                helper={`${formatPercentPtBr(overview.data?.today.adherence ?? 0)}% da meta do dia`}
                icon={Flame}
              />
              <DailyMetric
                title="Calorias restantes"
                value={formatCalories(positiveRemaining(remainingCalories))}
                helper={remainingCalories < 0 ? "Acima da meta planejada hoje" : "Disponíveis para os próximos registros"}
                icon={Salad}
              />
              <DailyMetric
                title="Saldo líquido"
                value={formatCalories(overview.data?.today.net.calories ?? 0)}
                helper="Consumo menos exercícios registrados"
                icon={Dumbbell}
              />
              <DailyMetric
                title="Água do dia"
                value={formatCountPtBr(overview.data?.today.water.consumedMl ?? 0, " ml")}
                helper={`Meta ${formatCountPtBr(overview.data?.today.water.goalMl ?? 0, " ml")}`}
                icon={Droplets}
              />
            </div>
          }
        />

        <section className="space-y-4">
          <SectionHeading
            title="Foco do dia"
            description="Aqui fica o que ajuda a decidir os próximos registros sem misturar histórico operacional ou análise semanal profunda."
          />
          <div className="grid gap-4 xl:grid-cols-[1.05fr,0.95fr]">
            <div className="space-y-4">
              <Card className="border-0 shadow-sm">
                <CardHeader>
                  <CardTitle>Status do dia</CardTitle>
                  <CardDescription>Leitura rápida do momento atual e da meta planejada.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="rounded-2xl border bg-muted/30 p-4">
                    <p className="text-sm leading-6 text-muted-foreground">{dailyStatus}</p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                    <StatBlock label="Meta calórica" value={formatCalories(calorieGoal)} sublabel={overview.data?.today.goal.label ?? "Planejamento diário"} />
                    <StatBlock label="Proteína" value={formatGrams(overview.data?.today.consumed.protein ?? 0)} sublabel={`Meta ${formatGrams(overview.data?.today.goal.protein ?? 0)}`} />
                    <StatBlock label="Carboidratos" value={formatGrams(overview.data?.today.consumed.carbs ?? 0)} sublabel={`Meta ${formatGrams(overview.data?.today.goal.carbs ?? 0)}`} />
                    <StatBlock label="Gorduras" value={formatGrams(overview.data?.today.consumed.fat ?? 0)} sublabel={`Meta ${formatGrams(overview.data?.today.goal.fat ?? 0)}`} />
                    <StatBlock label="Refeições" value={formatCountPtBr(todaysMeals.length)} sublabel="Registradas hoje" />
                  </div>
                  <div className="grid gap-3 lg:grid-cols-3">
                    <MacroBar label="Proteínas" consumed={overview.data?.today.consumed.protein ?? 0} goal={overview.data?.today.goal.protein ?? 0} />
                    <MacroBar label="Carboidratos" consumed={overview.data?.today.consumed.carbs ?? 0} goal={overview.data?.today.goal.carbs ?? 0} />
                    <MacroBar label="Gorduras" consumed={overview.data?.today.consumed.fat ?? 0} goal={overview.data?.today.goal.fat ?? 0} />
                  </div>
                </CardContent>
              </Card>

              <Card className="border-0 shadow-sm">
                <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <CardTitle>Refeições do dia</CardTitle>
                    <CardDescription>Registros confirmados hoje, com calorias e macros por refeição.</CardDescription>
                  </div>
                  <Link href="/meals">
                    <Button variant="ghost" className="gap-2 px-0 sm:px-3">
                      Ver lista completa
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  </Link>
                </CardHeader>
                <CardContent className="space-y-3">
                  {todaysMeals.length ? (
                    todaysMeals.map(meal => (
                      <div key={meal.id} className="rounded-2xl border bg-background p-4 shadow-sm">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-medium tracking-tight">{meal.mealLabel}</p>
                              <Badge variant="secondary">{meal.source === "web" ? "Web" : "WhatsApp"}</Badge>
                            </div>
                            <p className="text-sm text-muted-foreground">
                              {new Date(meal.occurredAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                            </p>
                          </div>
                          <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">{formatCalories(meal.totals.calories)}</Badge>
                        </div>
                        <div className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
                          <MiniMacro label="Proteínas" value={formatGrams(meal.totals.protein)} />
                          <MiniMacro label="Carboidratos" value={formatGrams(meal.totals.carbs)} />
                          <MiniMacro label="Gorduras" value={formatGrams(meal.totals.fat)} />
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
                    <EmptyCopy text="Nenhuma refeição foi registrada hoje. Um primeiro registro simples já ajuda a visualizar o dia com mais clareza." />
                  )}
                </CardContent>
              </Card>
            </div>

            <FoodAssistantCard
              message={assistantMessage}
              suggestion={assistantSuggestion}
              isGenerating={assistantSuggest.isPending}
              isSaving={saveAssistantMeal.isPending}
              onMessageChange={setAssistantMessage}
              onSubmit={handleAssistantSubmit}
              onShortcut={handleAssistantShortcut}
              onSaveSuggestion={handleSaveSuggestionAsMeal}
            />
          </div>
        </section>

        <section className="space-y-4">
          <SectionHeading
            title="Rotina de hoje"
            description="Água, exercícios e próximos passos ficam resumidos aqui, enquanto a edição detalhada e o histórico completo continuam nas telas certas."
          />
          <div className="grid gap-4 lg:grid-cols-3">
            <RoutineSummaryCard
              icon={Droplets}
              title="Água"
              value={formatCountPtBr(overview.data?.today.water.consumedMl ?? 0, " ml")}
              description={`Meta ${formatCountPtBr(overview.data?.today.water.goalMl ?? 0, " ml")} · ${formatCountPtBr(waterLogCount)} registro(s) hoje`}
              actionHref="/registrar"
              actionLabel="Registrar água"
            />
            <RoutineSummaryCard
              icon={Dumbbell}
              title="Exercícios"
              value={formatCalories(overview.data?.today.burned.calories ?? 0)}
              description={`${formatCountPtBr(exerciseCount)} exercício(s) registrados hoje`}
              actionHref="/registrar"
              actionLabel="Registrar exercício"
            />
            <RoutineSummaryCard
              icon={ListChecks}
              title="Próximos passos"
              value={todaysMeals.length ? "Dia em andamento" : "Primeiro registro"}
              description="Abra Registros para corrigir ou reaproveitar lançamentos, sem transformar Hoje em uma tela operacional longa."
              actionHref="/meals"
              actionLabel="Abrir Registros"
            />
          </div>
        </section>
      </div>
    </DashboardLayout>
  );
}

function SectionHeading({ title, description }: { title: string; description: string }) {
  return (
    <div className="space-y-1">
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{description}</p>
    </div>
  );
}

function DailyMetric({
  icon: Icon,
  title,
  value,
  helper,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  value: string;
  helper: string;
}) {
  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="flex min-h-36 items-start justify-between gap-4 p-5">
        <div>
          <p className="text-sm text-muted-foreground">{title}</p>
          <p className="mt-3 text-3xl font-semibold tracking-tight">{value}</p>
          <p className="mt-2 text-sm leading-5 text-muted-foreground">{helper}</p>
        </div>
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </div>
      </CardContent>
    </Card>
  );
}

function FoodAssistantCard({
  message,
  suggestion,
  isGenerating,
  isSaving,
  onMessageChange,
  onSubmit,
  onShortcut,
  onSaveSuggestion,
}: {
  message: string;
  suggestion: AssistantSuggestion | null;
  isGenerating: boolean;
  isSaving: boolean;
  onMessageChange: (value: string) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  onShortcut: (message: string) => void;
  onSaveSuggestion: () => void;
}) {
  const shortcuts = [
    "Sugira um jantar usando minhas calorias restantes.",
    "Como posso bater minha proteína hoje?",
    "Quero um lanche barato para agora.",
    "Sugira uma substituição alimentar simples.",
  ];

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <BrainCircuit className="h-5 w-5 text-primary" />
              Assistente alimentar
            </CardTitle>
            <CardDescription>Peça ideias simples considerando suas metas, preferências e restrições cadastradas.</CardDescription>
          </div>
          <Badge variant="secondary" className="w-fit">Educativo</Badge>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 lg:grid-cols-[0.95fr,1.05fr]">
        <form className="space-y-3" onSubmit={onSubmit}>
          <Textarea
            value={message}
            onChange={event => onMessageChange(event.target.value)}
            placeholder="Ex.: sugira um jantar leve com as calorias restantes"
            className="min-h-28 resize-none"
            maxLength={600}
          />
          <div className="flex flex-wrap gap-2">
            {shortcuts.map(shortcut => (
              <Button
                key={shortcut}
                type="button"
                variant="outline"
                size="sm"
                className="h-auto rounded-full px-3 py-2 text-left whitespace-normal"
                onClick={() => onShortcut(shortcut)}
                disabled={isGenerating}
              >
                {shortcut}
              </Button>
            ))}
          </div>
          <Button type="submit" disabled={isGenerating || message.trim().length < 3}>
            {isGenerating ? "Gerando sugestão..." : "Pedir sugestão"}
          </Button>
          <p className="text-xs leading-5 text-muted-foreground">
            As sugestões são educativas e não substituem orientação de nutricionista, médico ou outro profissional de saúde.
          </p>
        </form>

        <div className="rounded-2xl border bg-muted/20 p-4">
          {suggestion ? (
            <div className="space-y-4">
              <p className="text-sm leading-6 text-muted-foreground">{suggestion.text}</p>
              <div className="grid gap-2 sm:grid-cols-4">
                <MiniMacro label="Calorias" value={formatCalories(suggestion.estimatedCalories)} />
                <MiniMacro label="Proteínas" value={formatGrams(suggestion.estimatedMacros.protein)} />
                <MiniMacro label="Carboidratos" value={formatGrams(suggestion.estimatedMacros.carbs)} />
                <MiniMacro label="Gorduras" value={formatGrams(suggestion.estimatedMacros.fat)} />
              </div>
              {suggestion.suggestedFoods.length ? (
                <div className="space-y-2">
                  <p className="text-sm font-medium tracking-tight">Alimentos sugeridos</p>
                  <div className="grid gap-2">
                    {suggestion.suggestedFoods.map(food => (
                      <div key={`${food.foodName}-${food.portionText}`} className="rounded-xl border bg-background px-3 py-2 text-sm">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-medium">{food.foodName}</span>
                          <span className="text-muted-foreground">{food.portionText}</span>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {formatCalories(food.calories)} · {formatGrams(food.protein)} proteína
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              {suggestion.alert ? <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{suggestion.alert}</p> : null}
              <p className="text-xs leading-5 text-muted-foreground">{suggestion.educationalNotice}</p>
              <Button type="button" onClick={onSaveSuggestion} disabled={isSaving || !suggestion.suggestedFoods.length}>
                {isSaving ? "Salvando..." : "Salvar como refeição"}
              </Button>
            </div>
          ) : (
            <EmptyCopy text="A resposta aparecerá aqui com alimentos sugeridos, calorias, macros e uma observação de segurança quando necessário." />
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function RoutineSummaryCard({
  icon: Icon,
  title,
  value,
  description,
  actionHref,
  actionLabel,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  value: string;
  description: string;
  actionHref: string;
  actionLabel: string;
}) {
  return (
    <Card className="border-0 shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl">
          <Icon className="h-5 w-5 text-primary" />
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-3xl font-semibold tracking-tight">{value}</p>
        <Link href={actionHref}>
          <Button variant="outline" className="rounded-full">
            {actionLabel}
          </Button>
        </Link>
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
  const isAboveGoal = goal > 0 && consumed > goal;

  return (
    <div className="space-y-2 rounded-2xl border bg-muted/30 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="font-medium tracking-tight">{label}</p>
        <p className="text-sm text-muted-foreground">
          {formatGrams(consumed)} / {formatGrams(goal)}
        </p>
      </div>
      <Progress value={progress} className="h-2" />
      <p className="text-xs text-muted-foreground">
        {isAboveGoal ? SAFE_NUTRITION_MESSAGES.macroAboveGoal : `${formatPercentPtBr(progress)}% da meta de hoje.`}
      </p>
    </div>
  );
}

function MiniMacro({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-muted/40 px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-medium tracking-tight">{value}</p>
    </div>
  );
}

function EmptyCopy({ text }: { text: string }) {
  return <UXState compact description={text} />;
}