import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { formatCalories, formatCountPtBr } from "@/lib/numberFormat";
import { trpc } from "@/lib/trpc";
import { Activity, HeartPulse, Link2, RefreshCw, Unlink } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const DATA_TYPES = [
  { value: "steps", label: "Passos" },
  { value: "weight", label: "Peso" },
  { value: "activity", label: "Atividade física" },
  { value: "energy_burned", label: "Gasto energético" },
  { value: "sleep", label: "Sono" },
] as const;

type HealthDataType = typeof DATA_TYPES[number]["value"];
type HealthProvider = "apple_health" | "health_connect" | "google_fit" | "mock";

export default function HealthIntegrationsPage() {
  const utils = trpc.useUtils();
  const status = trpc.nutrition.healthIntegrations.status.useQuery();
  const [selectedScopes, setSelectedScopes] = useState<HealthDataType[]>(["steps", "activity", "energy_burned"]);

  const invalidate = async () => {
    await utils.nutrition.healthIntegrations.status.invalidate();
  };

  const connect = trpc.nutrition.healthIntegrations.connect.useMutation({
    onSuccess: async () => {
      toast.success("Integração conectada com consentimento explícito.");
      await invalidate();
    },
    onError: error => toast.error(error.message || "Não foi possível conectar a integração."),
  });

  const sync = trpc.nutrition.healthIntegrations.sync.useMutation({
    onSuccess: async result => {
      toast.success(`${formatCountPtBr(result.records.length, " registros")} sincronizados com origem identificada.`);
      await invalidate();
    },
    onError: error => toast.error(error.message || "Falha ao sincronizar dados de saúde."),
  });

  const disconnect = trpc.nutrition.healthIntegrations.disconnect.useMutation({
    onSuccess: async () => {
      toast.success("Integração desconectada. Dados sincronizados desse provider foram removidos da área de integração.");
      await invalidate();
    },
    onError: error => toast.error(error.message || "Não foi possível desconectar a integração."),
  });

  const toggleScope = (scope: HealthDataType) => {
    setSelectedScopes(current =>
      current.includes(scope)
        ? current.filter(item => item !== scope)
        : [...current, scope],
    );
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <section className="space-y-2">
          <Badge variant="secondary" className="w-fit">Privacidade e consentimento</Badge>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Integrações de saúde</h1>
          <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
            Conecte fontes externas somente com consentimento explícito. Calorias ingeridas continuam separadas do gasto energético vindo de atividade.
          </p>
        </section>

        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <HeartPulse className="h-5 w-5 text-primary" />
              Permissões
            </CardTitle>
            <CardDescription>Escolha os tipos de dados permitidos antes de conectar. Você pode desconectar depois.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            {DATA_TYPES.map(item => (
              <label key={item.value} className="flex items-center gap-2 rounded-xl border bg-background px-3 py-2 text-sm">
                <Checkbox
                  checked={selectedScopes.includes(item.value)}
                  onCheckedChange={() => toggleScope(item.value)}
                />
                {item.label}
              </label>
            ))}
          </CardContent>
        </Card>

        <div className="grid gap-4 xl:grid-cols-2">
          {status.data?.providers.map(provider => {
            const connection = provider.connection;
            const connected = connection?.status === "connected";
            return (
              <Card key={provider.provider} className="border-0 shadow-sm">
                <CardHeader>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <CardTitle>{provider.label}</CardTitle>
                      <CardDescription>
                        Plataforma: {provider.platform === "web" ? "Web/dev" : provider.platform}
                      </CardDescription>
                    </div>
                    <Badge variant={provider.available ? "secondary" : "outline"}>
                      {provider.available ? "Disponível" : "Requer app nativo"}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <StatusLine label="Status" value={connection?.status ?? "disconnected"} />
                  <StatusLine label="Última sincronização" value={connection?.lastSyncedAt ? new Date(connection.lastSyncedAt).toLocaleString("pt-BR") : "Nunca"} />
                  <StatusLine label="Origem dos dados" value={provider.provider} />
                  {connection?.lastError ? <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{connection.lastError}</p> : null}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      className="rounded-full"
                      disabled={!provider.available || connect.isPending || selectedScopes.length === 0 || connected}
                      onClick={() => connect.mutate({ provider: provider.provider as HealthProvider, consentAccepted: true, scopes: selectedScopes })}
                    >
                      <Link2 className="mr-2 h-4 w-4" />
                      Conectar
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="rounded-full"
                      disabled={!connected || sync.isPending}
                      onClick={() => sync.mutate({ provider: provider.provider as HealthProvider })}
                    >
                      <RefreshCw className="mr-2 h-4 w-4" />
                      Sincronizar
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="rounded-full"
                      disabled={!connection || disconnect.isPending}
                      onClick={() => disconnect.mutate({ provider: provider.provider as HealthProvider })}
                    >
                      <Unlink className="mr-2 h-4 w-4" />
                      Desconectar
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-primary" />
              Dados sincronizados
            </CardTitle>
            <CardDescription>Registros externos mantêm tipo, unidade e origem. Gasto energético externo não altera calorias ingeridas.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-4">
              <Metric label="Passos" value={formatCountPtBr(status.data?.totals.steps ?? 0)} />
              <Metric label="Atividade" value={formatCountPtBr(status.data?.totals.activityMinutes ?? 0, " min")} />
              <Metric label="Gasto externo" value={formatCalories(status.data?.totals.energyBurnedCalories ?? 0)} />
              <Metric label="Sono" value={formatCountPtBr(status.data?.totals.sleepMinutes ?? 0, " min")} />
            </div>
            {status.data?.recentRecords.length ? (
              <div className="grid gap-2">
                {status.data.recentRecords.map(record => (
                  <div key={record.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-background px-3 py-2 text-sm">
                    <div>
                      <p className="font-medium">{record.dataType}</p>
                      <p className="text-xs text-muted-foreground">{new Date(record.measuredAt).toLocaleString("pt-BR")} · origem: {record.source}</p>
                    </div>
                    <Badge variant="outline">{record.value} {record.unit}</Badge>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed bg-muted/20 p-6 text-sm leading-6 text-muted-foreground">
                Nenhum dado externo sincronizado ainda.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}

function StatusLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border bg-muted/20 px-3 py-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-background p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 text-xl font-semibold tracking-tight">{value}</p>
    </div>
  );
}

