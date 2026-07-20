import React, { useState } from "react";
import { CalendarRange, RefreshCw, Stethoscope } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { formatCalories, formatGrams } from "@/lib/numberFormat";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function PatientOfficialGoalCard() {
  const utils = trpc.useUtils();
  const [reason, setReason] = useState("");
  const state = trpc.professionalRecord.officialGoal.patientState.useQuery(
    undefined,
    { retry: false }
  );
  const request =
    trpc.professionalRecord.officialGoal.requestReview.useMutation({
      onSuccess: async result => {
        await state.refetch();
        toast.success(
          result.idempotent
            ? "Sua solicitação de revisão já estava registrada."
            : "Solicitação de revisão enviada ao profissional."
        );
        setReason("");
      },
      onError: error => toast.error(error.message),
    });
  const adopt =
    trpc.professionalRecord.officialGoal.adoptAsPersonal.useMutation({
      onSuccess: async () => {
        await Promise.all([
          state.refetch(),
          utils.nutrition.goals.get.invalidate(),
          utils.nutrition.dashboard.overview.invalidate(),
          utils.nutrition.reports.invalidate(),
        ]);
        toast.success(
          "A última meta profissional foi adotada como meta pessoal."
        );
      },
      onError: error => toast.error(error.message),
    });

  if (state.isLoading)
    return (
      <Card>
        <CardContent
          className="py-6 text-sm text-muted-foreground"
          role="status"
        >
          Carregando origem da meta...
        </CardContent>
      </Card>
    );
  if (state.isError)
    return (
      <Card>
        <CardContent className="flex items-center justify-between gap-3 py-6">
          <p role="alert" className="text-sm text-destructive">
            Não foi possível carregar os dados do acompanhamento.
          </p>
          <Button variant="outline" onClick={() => void state.refetch()}>
            <RefreshCw className="h-4 w-4" />
            Tentar novamente
          </Button>
        </CardContent>
      </Card>
    );
  const current = state.data?.current;
  const scheduled = state.data?.scheduled;
  const latestHistorical = state.data?.history?.[0];
  if (!current && !scheduled && !latestHistorical) return null;

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Stethoscope className="h-5 w-5 text-primary" />
          {current
            ? "Meta oficial do acompanhamento"
            : scheduled
              ? "Próxima meta oficial do acompanhamento"
              : "Histórico da meta profissional"}
        </CardTitle>
        <CardDescription>
          {current
            ? `Definida por ${current.professional.displayName}. A meta profissional prevalece durante o acompanhamento.`
            : scheduled
              ? `Definida por ${scheduled.professionalName} para iniciar em ${scheduled.effectiveFrom}. Sua meta atual continua valendo até essa data.`
              : "O controle profissional foi encerrado. Esta meta permanece no histórico e pode ser adotada como pessoal."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {current ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <Metric
                label="Calorias"
                value={formatCalories(current.calories)}
              />
              <Metric
                label="Proteínas"
                value={formatGrams(current.proteinGrams)}
              />
              <Metric
                label="Carboidratos"
                value={formatGrams(current.carbsGrams)}
              />
              <Metric label="Gorduras" value={formatGrams(current.fatGrams)} />
              <Metric
                label="Versão"
                value={String(current.professionalGoalVersion)}
              />
            </div>
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <CalendarRange className="h-4 w-4" />
              Vigência desde {current.effectiveFromDate}
              {current.effectiveUntilDate
                ? ` até ${current.effectiveUntilDate}`
                : ""}{" "}
              · exercícios{" "}
              {current.includeExerciseCalories ? "aumentam" : "não alteram"} a
              meta ajustada.
            </p>
            {state.data?.reviewRequest ? (
              <p className="rounded-md border bg-background p-3 text-sm">
                Sua solicitação de revisão está registrada e não alterou os
                valores da meta.
              </p>
            ) : (
              <div className="grid gap-2">
                <label
                  className="text-sm font-medium"
                  htmlFor="professional-goal-review"
                >
                  Solicitar revisão sem alterar a meta
                </label>
                <textarea
                  id="professional-goal-review"
                  className="min-h-20 rounded-md border bg-background p-3 text-sm"
                  value={reason}
                  onChange={event => setReason(event.target.value)}
                  maxLength={1000}
                  placeholder="Explique opcionalmente o que você gostaria de revisar."
                />
                <Button
                  className="w-fit"
                  variant="outline"
                  disabled={request.isPending}
                  onClick={() =>
                    request.mutate({ reason: reason.trim() || undefined })
                  }
                >
                  {request.isPending ? "Enviando..." : "Solicitar revisão"}
                </Button>
              </div>
            )}
          </>
        ) : scheduled ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <Metric
              label="Calorias"
              value={formatCalories(scheduled.calories)}
            />
            <Metric
              label="Proteínas"
              value={formatGrams(scheduled.proteinGrams)}
            />
            <Metric
              label="Carboidratos"
              value={formatGrams(scheduled.carbsGrams)}
            />
            <Metric label="Gorduras" value={formatGrams(scheduled.fatGrams)} />
            <Metric label="Versão" value={String(scheduled.version)} />
          </div>
        ) : latestHistorical ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-background p-4">
            <div>
              <p className="font-medium">
                Versão {latestHistorical.version} ·{" "}
                {formatCalories(latestHistorical.calories)}
              </p>
              <p className="text-sm text-muted-foreground">
                {latestHistorical.professionalName} · vigência iniciada em{" "}
                {latestHistorical.effectiveFrom}
              </p>
            </div>
            <Button
              disabled={adopt.isPending}
              onClick={() => adopt.mutate({ goalId: latestHistorical.id })}
            >
              {adopt.isPending ? "Adotando..." : "Adotar como meta pessoal"}
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-background p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-semibold">{value}</p>
    </div>
  );
}
