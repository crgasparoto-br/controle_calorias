import React from "react";
import {
  AlertTriangle,
  Check,
  EyeOff,
  RefreshCw,
} from "lucide-react";
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

const labels: Record<string, string> = {
  no_food_records: "Sem registros alimentares",
  weigh_in_overdue: "Pesagem pendente",
  goal_review_due: "Revisão de meta pendente",
  professional_request_overdue: "Solicitação sem resposta",
  record_requires_review: "Registro que exige revisão",
};

const originLabels: Record<string, string> = {
  meals: "Registros alimentares",
  professional_request: "Solicitação profissional",
  tracking_next_review: "Próxima revisão do acompanhamento",
};

function formatDateTime(value: number | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatPeriod(period: { start: number | null; end: number | null }) {
  const start = formatDateTime(period.start);
  const end = formatDateTime(period.end);
  if (start && end) return `${start} até ${end}`;
  if (end) return `Até ${end}`;
  if (start) return `Desde ${start}`;
  return "Não aplicável";
}

export default function ProfessionalOperationalAlertsPanel({
  patientId,
}: {
  patientId?: number;
}) {
  const query = trpc.professionalRecord.operationalAlerts.list.useQuery(
    patientId ? { patientId } : {},
    {
      retry: false,
      refetchInterval: 30_000,
      refetchOnWindowFocus: true,
    }
  );
  const close = trpc.professionalRecord.operationalAlerts.close.useMutation({
    onSuccess: async () => {
      await query.refetch();
      toast.success("Pendência atualizada.");
    },
    onError: error => toast.error(error.message),
  });
  const evaluate =
    trpc.professionalRecord.operationalAlerts.evaluate.useMutation({
      onSuccess: async () => {
        await query.refetch();
        toast.success("Pendências reavaliadas.");
      },
      onError: error => toast.error(error.message),
    });

  if (query.isLoading) {
    return (
      <div
        role="status"
        className="rounded-md border p-4 text-sm text-muted-foreground"
      >
        Carregando pendências operacionais...
      </div>
    );
  }

  if (query.isError) {
    return (
      <div
        role="alert"
        className="flex items-center justify-between gap-3 rounded-md border border-destructive/40 p-4 text-sm"
      >
        <span>Não foi possível carregar as pendências.</span>
        <Button variant="outline" onClick={() => void query.refetch()}>
          <RefreshCw className="h-4 w-4" />
          Tentar novamente
        </Button>
      </div>
    );
  }

  const alerts = query.data ?? [];
  const isUpdating = close.isPending || evaluate.isPending;

  return (
    <Card>
      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5" />
            Pendências operacionais
          </CardTitle>
          <CardDescription>
            Regras objetivas do acompanhamento. Estes avisos não representam
            diagnóstico.
          </CardDescription>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={isUpdating}
          onClick={() => evaluate.mutate()}
        >
          <RefreshCw
            className={`h-4 w-4 ${evaluate.isPending ? "animate-spin" : ""}`}
          />
          Reavaliar
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {alerts.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhuma pendência operacional aberta.
          </p>
        ) : (
          alerts.map(alert => (
            <div key={alert.id} className="rounded-md border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 space-y-2">
                  <div>
                    <p className="font-medium">
                      {labels[alert.type] ?? alert.type}
                    </p>
                    {!patientId && (
                      <p className="text-sm font-medium text-foreground/80">
                        Paciente: {alert.patientName}
                      </p>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {alert.reason}
                  </p>
                  <dl className="grid gap-1 text-xs text-muted-foreground">
                    <div>
                      <dt className="inline font-medium text-foreground/70">
                        Período: {" "}
                      </dt>
                      <dd className="inline">{formatPeriod(alert.period)}</dd>
                    </div>
                    <div>
                      <dt className="inline font-medium text-foreground/70">
                        Origem: {" "}
                      </dt>
                      <dd className="inline break-all">
                        {originLabels[alert.origin.type] ?? alert.origin.type}
                        {alert.origin.id ? ` (${alert.origin.id})` : ""}
                      </dd>
                    </div>
                    <div>
                      <dt className="inline font-medium text-foreground/70">
                        Ação sugerida: {" "}
                      </dt>
                      <dd className="inline">{alert.suggestedAction}</dd>
                    </div>
                  </dl>
                </div>
                <span className="rounded-full border px-2 py-1 text-xs">
                  {alert.severity}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={isUpdating}
                  onClick={() =>
                    close.mutate({
                      alertId: alert.id,
                      decision: "resolved",
                    })
                  }
                >
                  <Check className="h-4 w-4" />
                  Resolver
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={isUpdating}
                  onClick={() =>
                    close.mutate({
                      alertId: alert.id,
                      decision: "dismissed",
                    })
                  }
                >
                  <EyeOff className="h-4 w-4" />
                  Dispensar
                </Button>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
