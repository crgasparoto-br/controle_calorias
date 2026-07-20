import React, { useEffect, useMemo, useState } from "react";
import { Plus, RotateCcw, Stethoscope, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type DraftException = {
  weekday: number;
  durationType: "1_week" | "2_weeks" | "3_weeks" | "always";
  calories: string;
  proteinGrams: string;
  carbsGrams: string;
  fatGrams: string;
};
const emptyTarget = {
  calories: "",
  proteinGrams: "",
  carbsGrams: "",
  fatGrams: "",
};

function tomorrowAfter(value?: string | null) {
  const today = new Date().toISOString().slice(0, 10);
  if (!value || value < today) return today;
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

export default function ProfessionalOfficialGoalCard({
  patientId,
  disabled,
}: {
  patientId: number;
  disabled: boolean;
}) {
  const utils = trpc.useUtils();
  const state = trpc.professionalRecord.officialGoal.professionalState.useQuery(
    { patientId },
    { enabled: patientId > 0, retry: false }
  );
  const [target, setTarget] = useState(emptyTarget);
  const [effectiveFrom, setEffectiveFrom] = useState(
    new Date().toISOString().slice(0, 10)
  );
  const [justification, setJustification] = useState("");
  const [includeExerciseCalories, setIncludeExerciseCalories] = useState(true);
  const [exceptions, setExceptions] = useState<DraftException[]>([]);
  const current = state.data?.current;
  useEffect(() => {
    if (!current) return;
    setTarget({
      calories: String(current.calories),
      proteinGrams: String(current.proteinGrams),
      carbsGrams: String(current.carbsGrams),
      fatGrams: String(current.fatGrams),
    });
    setIncludeExerciseCalories(current.includeExerciseCalories);
    setEffectiveFrom(tomorrowAfter(current.effectiveFrom));
  }, [current?.id]);
  const valid = useMemo(
    () =>
      Object.values(target).every(value => Number(value) > 0) &&
      justification.trim().length >= 3 &&
      Boolean(effectiveFrom),
    [effectiveFrom, justification, target]
  );
  const refresh = async () => {
    await Promise.all([
      state.refetch(),
      utils.professionalRecord.get.invalidate(),
      utils.nutrition.goals.get.invalidate(),
      utils.nutrition.reports.invalidate(),
    ]);
  };
  const activate = trpc.professionalRecord.officialGoal.activate.useMutation({
    onSuccess: async result => {
      await refresh();
      setJustification("");
      toast.success(
        result.notification.status === "sent"
          ? "Meta oficial ativada e paciente notificado."
          : "Meta oficial ativada. A notificação ficou registrada para nova tentativa."
      );
    },
    onError: error => toast.error(error.message),
  });
  const retry =
    trpc.professionalRecord.officialGoal.retryNotification.useMutation({
      onSuccess: async result => {
        await refresh();
        toast[result.status === "sent" ? "success" : "warning"](
          result.status === "sent"
            ? "Notificação enviada."
            : "A notificação ainda não pôde ser enviada."
        );
      },
      onError: error => toast.error(error.message),
    });
  const updateTarget = (field: keyof typeof target, value: string) =>
    setTarget(currentTarget => ({ ...currentTarget, [field]: value }));
  const addException = () =>
    setExceptions(items => [
      ...items,
      { weekday: 0, durationType: "always", ...target },
    ]);

  return (
    <Card className="border-primary/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Stethoscope className="h-5 w-5 text-primary" />
          Meta profissional oficial
        </CardTitle>
        <CardDescription>
          Ative uma versão auditável. A versão anterior continua no histórico e
          as sugestões legadas permanecem separadas.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {state.isLoading ? (
          <p role="status" className="text-sm text-muted-foreground">
            Carregando metas profissionais...
          </p>
        ) : null}
        {state.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {state.error.message}
          </p>
        ) : null}
        {current ? (
          <div className="rounded-md border bg-muted/20 p-4 text-sm">
            <p className="font-medium">
              Versão {current.version} ativa · {current.calories} kcal
            </p>
            <p className="text-muted-foreground">
              Vigência desde {current.effectiveFrom}. Justificativa registrada
              no histórico profissional.
            </p>
          </div>
        ) : (
          <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            Nenhuma meta profissional oficial ativa para este paciente.
          </p>
        )}
        {state.data?.reviewRequests?.some(
          item => item.status === "open"
        ) ? (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
            O paciente solicitou revisão desta meta. A solicitação será
            resolvida quando uma nova versão for ativada.
          </div>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {(
            ["calories", "proteinGrams", "carbsGrams", "fatGrams"] as const
          ).map((field, index) => (
            <label key={field} className="grid gap-1 text-sm">
              <span className="font-medium">
                {
                  [
                    "Calorias (kcal)",
                    "Proteínas (g)",
                    "Carboidratos (g)",
                    "Gorduras (g)",
                  ][index]
                }
              </span>
              <Input
                type="number"
                min={1}
                value={target[field]}
                onChange={event => updateTarget(field, event.target.value)}
                disabled={disabled}
              />
            </label>
          ))}
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="grid gap-1 text-sm">
            <span className="font-medium">Início da vigência</span>
            <Input
              type="date"
              value={effectiveFrom}
              onChange={event => setEffectiveFrom(event.target.value)}
              disabled={disabled}
            />
          </label>
          <label className="flex items-center gap-2 pt-6 text-sm">
            <input
              type="checkbox"
              checked={includeExerciseCalories}
              onChange={event =>
                setIncludeExerciseCalories(event.target.checked)
              }
              disabled={disabled}
            />
            Exercícios aumentam a meta ajustada
          </label>
        </div>
        <label className="grid gap-1 text-sm">
          <span className="font-medium">Justificativa profissional</span>
          <textarea
            className="min-h-24 rounded-md border bg-background p-3"
            value={justification}
            onChange={event => setJustification(event.target.value)}
            maxLength={2000}
            disabled={disabled}
          />
          <span className="text-xs text-muted-foreground">
            A justificativa é privada e não será incluída na notificação ao
            paciente.
          </span>
        </label>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">Exceções por dia</p>
              <p className="text-xs text-muted-foreground">
                Mantêm o contrato canônico de dias especiais.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={addException}
              disabled={disabled}
            >
              <Plus className="h-4 w-4" />
              Adicionar exceção
            </Button>
          </div>
          {exceptions.map((item, index) => (
            <div
              key={index}
              className="grid gap-2 rounded-md border p-3 md:grid-cols-6"
            >
              <select
                aria-label={`Dia da exceção ${index + 1}`}
                className="h-10 rounded-md border bg-background px-2 text-sm"
                value={item.weekday}
                onChange={event =>
                  setExceptions(values =>
                    values.map((value, itemIndex) =>
                      itemIndex === index
                        ? { ...value, weekday: Number(event.target.value) }
                        : value
                    )
                  )
                }
              >
                {[
                  "Segunda",
                  "Terça",
                  "Quarta",
                  "Quinta",
                  "Sexta",
                  "Sábado",
                  "Domingo",
                ].map((label, weekday) => (
                  <option key={label} value={weekday}>
                    {label}
                  </option>
                ))}
              </select>
              <select
                aria-label={`Duração da exceção ${index + 1}`}
                className="h-10 rounded-md border bg-background px-2 text-sm"
                value={item.durationType}
                onChange={event =>
                  setExceptions(values =>
                    values.map((value, itemIndex) =>
                      itemIndex === index
                        ? {
                            ...value,
                            durationType: event.target
                              .value as DraftException["durationType"],
                          }
                        : value
                    )
                  )
                }
              >
                <option value="1_week">1 semana</option>
                <option value="2_weeks">2 semanas</option>
                <option value="3_weeks">3 semanas</option>
                <option value="always">Sempre</option>
              </select>
              {(
                ["calories", "proteinGrams", "carbsGrams", "fatGrams"] as const
              ).map(field => (
                <Input
                  key={field}
                  aria-label={`${field} da exceção ${index + 1}`}
                  type="number"
                  min={1}
                  value={item[field]}
                  onChange={event =>
                    setExceptions(values =>
                      values.map((value, itemIndex) =>
                        itemIndex === index
                          ? { ...value, [field]: event.target.value }
                          : value
                      )
                    )
                  }
                />
              ))}
              <Button
                aria-label={`Remover exceção ${index + 1}`}
                variant="ghost"
                size="icon"
                onClick={() =>
                  setExceptions(values =>
                    values.filter((_, itemIndex) => itemIndex !== index)
                  )
                }
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
        <Button
          disabled={disabled || !valid || activate.isPending}
          onClick={() =>
            activate.mutate({
              patientId,
              expectedVersion: current?.version,
              effectiveFrom,
              justification: justification.trim(),
              goal: {
                includeExerciseCalories,
                defaultGoal: {
                  calories: Number(target.calories),
                  proteinGrams: Number(target.proteinGrams),
                  carbsGrams: Number(target.carbsGrams),
                  fatGrams: Number(target.fatGrams),
                },
                exceptions: exceptions.map(item => ({
                  weekday: item.weekday,
                  durationType: item.durationType,
                  calories: Number(item.calories),
                  proteinGrams: Number(item.proteinGrams),
                  carbsGrams: Number(item.carbsGrams),
                  fatGrams: Number(item.fatGrams),
                })),
              },
            })
          }
        >
          {activate.isPending
            ? "Ativando..."
            : current
              ? "Ativar nova versão"
              : "Ativar meta oficial"}
        </Button>
        {state.data?.notifications
          ?.filter(
            item => item.status === "failed" || item.status === "skipped"
          )
          .slice(0, 1)
          .map(item => (
            <div
              key={item.goalId}
              className="flex items-center justify-between gap-3 rounded-md border border-amber-300 p-3 text-sm"
            >
              <span>Notificação pendente ({item.attempts} tentativa(s)).</span>
              <Button
                variant="outline"
                disabled={retry.isPending}
                onClick={() => retry.mutate({ goalId: item.goalId })}
              >
                <RotateCcw className="h-4 w-4" />
                Tentar novamente
              </Button>
            </div>
          ))}
      </CardContent>
    </Card>
  );
}
