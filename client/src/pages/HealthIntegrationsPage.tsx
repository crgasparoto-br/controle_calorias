import DashboardLayout from "@/components/DashboardLayout";
import PageIntro from "@/components/PageIntro";
import UXState from "@/components/UXState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCountPtBr } from "@/lib/numberFormat";
import { trpc } from "@/lib/trpc";
import { Activity, AlertCircle, CheckCircle2, ExternalLink, RefreshCw, ShieldCheck, Unlink } from "lucide-react";
import { toast } from "sonner";

const DATA_TYPE_LABELS: Record<string, string> = {
  steps: "Passos",
  weight: "Peso",
  activity: "Atividade física",
  energy_burned: "Gasto energético",
  sleep: "Sono",
};

const CONNECTION_STATUS_LABELS: Record<string, string> = {
  connected: "Conectado",
  disconnected: "Desconectado",
  pending: "Com pendências",
  error: "Com erro",
  syncing: "Sincronizando",
};

type HealthProvider = "apple_health" | "health_connect" | "google_fit" | "strava" | "garmin_connect" | "mock";

export default function HealthIntegrationsPage() {
  const utils = trpc.useUtils();
  const status = trpc.nutrition.healthIntegrations.status.useQuery();

  const invalidate = async () => {
    await utils.nutrition.healthIntegrations.status.invalidate();
    await utils.nutrition.exercises.list.invalidate();
  };

  const sync = trpc.nutrition.healthIntegrations.sync.useMutation({
    onSuccess: async result => {
      const imported = result.importedExercises;
      const exerciseSummary = imported
        ? ` ${formatCountPtBr(imported.created, " exercícios criados")}, ${formatCountPtBr(imported.updated, " atualizados")} e ${formatCountPtBr(imported.skipped, " ignorados")}.`
        : "";
      toast.success(`${formatCountPtBr(result.records.length, " registros")} sincronizados com origem identificada.${exerciseSummary}`);
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

  const providers = status.data?.providers ?? [];
  const visibleProviders = providers.filter(provider => provider.provider === "strava" && (provider.available || provider.connection));
  const connectedProviders = visibleProviders.filter(provider => provider.connection?.status === "connected").length;
  const recentStravaActivities = (status.data?.recentRecords ?? []).filter(record => record.source === "strava" && record.dataType === "activity").length;

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-6xl space-y-6">
        <PageIntro
          eyebrow="Integrações"
          title="Integrações"
          description="Conecte providers finalizados e acompanhe status, permissões e ações em um único lugar. Nesta etapa, somente o Strava aparece para o usuário final quando está configurado ou já conectado."
          stats={
            <div className="grid gap-4 md:grid-cols-3">
              <IntroStat label="Integrações visíveis" value={String(visibleProviders.length)} helper="finalizadas para uso web" />
              <IntroStat label="Conectadas" value={String(connectedProviders)} helper="com vínculo ativo" />
              <IntroStat label="Atividades recentes" value={String(recentStravaActivities)} helper="sincronizadas do Strava" />
            </div>
          }
        />

        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-primary" />
              Providers disponíveis
            </CardTitle>
            <CardDescription>
              Permissões, conexão, sincronização e erros ficam no próprio card da integração para evitar decisões fora de contexto.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {status.isLoading ? (
              <UXState
                variant="loading"
                title="Carregando integrações"
                description="Estou buscando o estado atual dos providers e vínculos externos."
              />
            ) : status.error ? (
              <UXState
                variant="error"
                title="Não foi possível carregar as integrações"
                description={status.error.message || "Tente novamente em instantes para revisar o estado dos providers."}
              />
            ) : visibleProviders.length ? (
              <div className="grid gap-4">
                {visibleProviders.map(provider => (
                  <IntegrationCard
                    key={provider.provider}
                    provider={provider}
                    syncing={sync.isPending}
                    disconnecting={disconnect.isPending}
                    onSync={() => sync.mutate({ provider: provider.provider as HealthProvider })}
                    onDisconnect={() => disconnect.mutate({ provider: provider.provider as HealthProvider })}
                  />
                ))}
              </div>
            ) : (
              <UXState
                variant="empty"
                title="Nenhuma integração finalizada disponível"
                description="O Strava aparecerá aqui quando as credenciais OAuth estiverem configuradas. Apple Health, Health Connect, Google Fit, Garmin e mock seguem ocultos para reduzir ruído."
              />
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}

function IntegrationCard({
  provider,
  syncing,
  disconnecting,
  onSync,
  onDisconnect,
}: {
  provider: {
    provider: string;
    label: string;
    available: boolean;
    platform: string;
    supportedDataTypes: readonly string[];
    authorizationUrl?: string | null;
    athleteName?: string | null;
    connection?: {
      status: string;
      scopes: readonly string[];
      consentGrantedAt: number | null;
      lastSyncedAt: number | null;
      lastError: string | null;
    } | null;
  };
  syncing: boolean;
  disconnecting: boolean;
  onSync: () => void;
  onDisconnect: () => void;
}) {
  const connection = provider.connection;
  const connected = connection?.status === "connected";
  const hasError = connection?.status === "error" || Boolean(connection?.lastError);
  const missingScopes = provider.supportedDataTypes.filter(scope => !(connection?.scopes ?? []).includes(scope));
  const statusLabel = syncing
    ? CONNECTION_STATUS_LABELS.syncing
    : hasError
      ? CONNECTION_STATUS_LABELS.error
      : connected && missingScopes.length === 0
        ? "Conectado completo"
        : connected
          ? "Conectado com pendências"
          : CONNECTION_STATUS_LABELS[connection?.status ?? "disconnected"];

  return (
    <div className="rounded-2xl border bg-background p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold tracking-tight">{provider.label}</h2>
            <Badge variant={connected ? "secondary" : "outline"} className="rounded-full px-3 py-1">
              {statusLabel}
            </Badge>
            {provider.athleteName ? (
              <Badge variant="outline" className="rounded-full px-3 py-1">{provider.athleteName}</Badge>
            ) : null}
          </div>
          <p className="text-sm leading-6 text-muted-foreground">
            O Strava usa OAuth externo para autorizar atividades e gasto energético. Depois de conectado, a sincronização importa registros e cria exercícios quando houver duração e calorias válidas.
          </p>
        </div>
        <StatusIcon connected={connected} hasError={hasError} />
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <StatusLine label="Plataforma" value={provider.platform === "web" ? "Web OAuth" : provider.platform} />
        <StatusLine label="Consentimento" value={connection?.consentGrantedAt ? new Date(connection.consentGrantedAt).toLocaleString("pt-BR") : "Aguardando autorização"} />
        <StatusLine label="Última sincronização" value={connection?.lastSyncedAt ? new Date(connection.lastSyncedAt).toLocaleString("pt-BR") : "Nunca"} />
      </div>

      <section className="mt-5 rounded-2xl border bg-muted/20 p-4" aria-labelledby="strava-permissions-title">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <h3 id="strava-permissions-title" className="text-sm font-semibold tracking-tight">Permissões da integração</h3>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {provider.supportedDataTypes.map(scope => {
            const granted = (connection?.scopes ?? []).includes(scope);
            return (
              <Badge key={scope} variant={granted ? "secondary" : "outline"} className="rounded-full px-3 py-1">
                {DATA_TYPE_LABELS[scope] ?? scope}{connected && !granted ? " pendente" : ""}
              </Badge>
            );
          })}
        </div>
      </section>

      {connection?.lastError ? (
        <p className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {connection.lastError}
        </p>
      ) : null}

      <div className="mt-5 flex flex-wrap gap-2">
        {provider.authorizationUrl ? (
          <Button
            type="button"
            className="rounded-full"
            onClick={() => {
              window.location.href = provider.authorizationUrl ?? "";
            }}
          >
            <ExternalLink className="mr-2 h-4 w-4" />
            {connected ? "Reconectar Strava" : "Conectar Strava"}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="outline"
          className="rounded-full"
          disabled={!connected || syncing}
          onClick={onSync}
        >
          <RefreshCw className="mr-2 h-4 w-4" />
          Sincronizar
        </Button>
        <Button
          type="button"
          variant="outline"
          className="rounded-full"
          disabled={!connection || disconnecting}
          onClick={onDisconnect}
        >
          <Unlink className="mr-2 h-4 w-4" />
          Desconectar
        </Button>
      </div>
    </div>
  );
}

function StatusIcon({ connected, hasError }: { connected: boolean; hasError: boolean }) {
  if (hasError) {
    return (
      <div className="rounded-full border border-amber-200 bg-amber-50 p-3 text-amber-700">
        <AlertCircle className="h-5 w-5" />
      </div>
    );
  }

  return (
    <div className={`rounded-full border p-3 ${connected ? "bg-primary/10 text-primary" : "bg-muted/30 text-muted-foreground"}`}>
      <CheckCircle2 className="h-5 w-5" />
    </div>
  );
}

function IntroStat({ label, value, helper }: { label: string; value: string; helper: string }) {
  return (
    <div className="rounded-2xl border bg-background p-4 shadow-sm">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{helper}</p>
    </div>
  );
}

function StatusLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border bg-background px-3 py-3 text-sm">
      <p className="text-muted-foreground">{label}</p>
      <p className="mt-1 font-medium text-foreground">{value}</p>
    </div>
  );
}
