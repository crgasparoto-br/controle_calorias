import DashboardLayout from "@/components/DashboardLayout";
import PageIntro from "@/components/PageIntro";
import UXState from "@/components/UXState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatCalories, formatCountPtBr } from "@/lib/numberFormat";
import { trpc } from "@/lib/trpc";
import { Activity, ExternalLink, Gauge, HeartPulse, Link2, RefreshCw, Route, ShieldCheck, Timer, Unlink, Zap } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

const DATA_TYPES = [
  { value: "steps", label: "Passos" },
  { value: "weight", label: "Peso" },
  { value: "activity", label: "Atividade física" },
  { value: "energy_burned", label: "Gasto energético" },
  { value: "sleep", label: "Sono" },
] as const;

type HealthDataType = typeof DATA_TYPES[number]["value"];
type HealthProvider = "apple_health" | "health_connect" | "google_fit" | "strava" | "mock";

type StravaActivityMetadata = {
  externalId: string;
  name: string;
  sportType: string;
  distanceMeters: number | null;
  movingTimeSeconds: number | null;
  elapsedTimeSeconds: number | null;
  calories: number | null;
  caloriesSource: "strava" | "kilojoules" | "estimated_strength" | null;
  estimatedCalories: boolean;
  estimatedCaloriesWeightKg: number | null;
  estimatedCaloriesMet: number | null;
  kilojoules: number | null;
  totalElevationGainMeters: number | null;
  averageSpeedMetersPerSecond: number | null;
  maxSpeedMetersPerSecond: number | null;
  averageHeartRate: number | null;
  maxHeartRate: number | null;
  averageCadence: number | null;
  averageWatts: number | null;
  maxWatts: number | null;
  weightedAverageWatts: number | null;
  deviceName: string | null;
  gearId: string | null;
  startDateLocal: string | null;
  timezone: string | null;
  visibility: string | null;
  achievementCount: number | null;
  kudosCount: number | null;
  prCount: number | null;
  trainer: boolean | null;
  commute: boolean | null;
  manual: boolean | null;
  private: boolean | null;
  hasHeartRate: boolean | null;
};

type SyncedHealthRecord = {
  id: string;
  source: string;
  dataType: string;
  measuredAt: string;
  value: number;
  unit: string;
  activityType?: string;
  metadata?: StravaActivityMetadata | null;
};

const CONNECTION_STATUS_LABELS: Record<string, string> = {
  connected: "Conectado",
  disconnected: "Desconectado",
  pending: "Pendente",
  error: "Com erro",
  syncing: "Sincronizando",
};

export default function HealthIntegrationsPage() {
  const utils = trpc.useUtils();
  const status = trpc.nutrition.healthIntegrations.status.useQuery();
  const [selectedScopes, setSelectedScopes] = useState<HealthDataType[]>(["steps", "activity", "energy_burned"]);

  const invalidate = async () => {
    await utils.nutrition.healthIntegrations.status.invalidate();
    await utils.nutrition.exercises.list.invalidate();
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

  const toggleScope = (scope: HealthDataType) => {
    setSelectedScopes(current =>
      current.includes(scope)
        ? current.filter(item => item !== scope)
        : [...current, scope],
    );
  };

  const providers = status.data?.providers ?? [];
  const recentRecords = status.data?.recentRecords ?? [];
  const recentStravaActivityRecords = recentRecords.filter(record => record.source === "strava" && record.dataType === "activity");
  const recentStravaActivities = recentStravaActivityRecords.length;
  const stravaDistanceKm = recentStravaActivityRecords.reduce((sum, record) => sum + ((record.metadata?.distanceMeters ?? 0) / 1000), 0);
  const stravaActivitiesWithHeartRate = recentStravaActivityRecords.filter(record => record.metadata?.averageHeartRate).length;

  const availableProviders = useMemo(() => providers.filter(provider => provider.available).length, [providers]);
  const connectedProviders = useMemo(
    () => providers.filter(provider => provider.connection?.status === "connected").length,
    [providers],
  );
  const selectedScopeLabels = useMemo(
    () => DATA_TYPES.filter(item => selectedScopes.includes(item.value)).map(item => item.label),
    [selectedScopes],
  );

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-7xl space-y-6">
        <PageIntro
          eyebrow="Saúde"
          title="Integrações de saúde"
          description="Conecte provedores externos com consentimento explícito. No Strava, o usuário autoriza pelo próprio Strava e o vínculo fica salvo para sincronizar exercícios depois."
          stats={
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <IntroStat label="Providers disponíveis" value={String(availableProviders)} helper="prontos para uso" />
              <IntroStat label="Providers conectados" value={String(connectedProviders)} helper="com vínculo ativo" />
              <IntroStat label="Escopos selecionados" value={String(selectedScopes.length)} helper="tipos de dados permitidos" />
              <IntroStat label="Atividades Strava" value={String(recentStravaActivities)} helper="sincronizadas agora" />
            </div>
          }
        />

        <Tabs defaultValue="connections" className="space-y-4">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <TabsList className="h-auto w-full flex-wrap rounded-2xl p-1 sm:w-auto">
              <TabsTrigger value="connections" className="min-w-[140px] rounded-xl px-4 py-2">Conexões</TabsTrigger>
              <TabsTrigger value="permissions" className="min-w-[140px] rounded-xl px-4 py-2">Permissões</TabsTrigger>
              <TabsTrigger value="data" className="min-w-[140px] rounded-xl px-4 py-2">Dados sincronizados</TabsTrigger>
            </TabsList>
            <div className="grid gap-3 sm:grid-cols-3 xl:w-[34rem]">
              <SurfaceStat
                label="Consentimentos ativos"
                value={selectedScopeLabels.length ? selectedScopeLabels.join(", ") : "Nenhum selecionado"}
              />
              <SurfaceStat
                label="Providers prontos"
                value={availableProviders ? `${availableProviders} disponíveis` : "Aguardando setup"}
              />
              <SurfaceStat
                label="Exercícios importáveis"
                value={recentStravaActivities ? `${recentStravaActivities} atividades recentes` : "Sem sync do Strava"}
              />
            </div>
          </div>

          <TabsContent value="connections" className="space-y-4">
            <div className="grid gap-4 xl:grid-cols-[1.45fr,0.95fr]">
              <Card className="border-0 shadow-sm">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Link2 className="h-5 w-5 text-primary" />
                    Providers e vínculo ativo
                  </CardTitle>
                  <CardDescription>
                    Cada integração aparece com disponibilidade, estado atual, última sincronização e ações principais. No Strava, conectar redireciona para autorização no Strava e sincronizar atualiza o registro de exercícios.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {status.isLoading ? (
                    <UXState
                      variant="loading"
                      title="Carregando integrações"
                      description="Estou buscando o estado atual dos providers e das conexões de saúde."
                    />
                  ) : status.error ? (
                    <UXState
                      variant="error"
                      title="Não foi possível carregar as integrações"
                      description={status.error.message || "Tente novamente em instantes para revisar o estado dos providers."}
                    />
                  ) : providers.length ? (
                    <div className="grid gap-4">
                      {providers.map(provider => {
                        const connection = provider.connection;
                        const connected = connection?.status === "connected";
                        const authorizationUrl = "authorizationUrl" in provider ? provider.authorizationUrl : null;
                        const isStrava = provider.provider === "strava";
                        const setupStatus = "setupStatus" in provider ? provider.setupStatus : undefined;
                        return (
                          <div key={provider.provider} className="rounded-3xl border bg-background p-4 shadow-sm">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="space-y-2">
                                <div className="flex flex-wrap items-center gap-2">
                                  <h2 className="text-lg font-semibold tracking-tight">{provider.label}</h2>
                                  <Badge variant={provider.available ? "secondary" : "outline"}>
                                    {provider.available ? "Disponível" : isStrava ? "Configuração pendente" : "Requer app nativo"}
                                  </Badge>
                                  {connected ? <Badge variant="outline">Vínculo ativo</Badge> : null}
                                </div>
                                <p className="text-sm text-muted-foreground">
                                  Plataforma: {provider.platform === "web" ? "Web/dev" : provider.platform}
                                </p>
                              </div>
                              <div className="rounded-2xl border bg-muted/20 px-3 py-2 text-right text-sm">
                                <p className="text-muted-foreground">Status</p>
                                <p className="font-medium">{formatConnectionStatus(connection?.status)}</p>
                              </div>
                            </div>

                            <div className="mt-4 grid gap-3 md:grid-cols-3">
                              <StatusLine label="Última sincronização" value={connection?.lastSyncedAt ? new Date(connection.lastSyncedAt).toLocaleString("pt-BR") : "Nunca"} />
                              <StatusLine label="Origem dos dados" value={provider.provider} />
                              <StatusLine label="Escopos prontos" value={selectedScopeLabels.length ? formatCountPtBr(selectedScopeLabels.length) : "0"} />
                            </div>

                            {setupStatus === "missing_credentials" ? (
                              <p className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                                Configure STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET e STRAVA_REDIRECT_URI no backend para liberar o OAuth do Strava.
                              </p>
                            ) : null}
                            {isStrava ? (
                              <p className="mt-4 rounded-2xl border bg-muted/20 px-3 py-2 text-sm leading-6 text-muted-foreground">
                                O usuário é enviado para o Strava, faz login e autoriza o app por lá. O callback salva o vínculo no backend e atividades com duração e calorias válidas entram no histórico de exercícios sem duplicar a mesma atividade Strava.
                              </p>
                            ) : null}
                            {connection?.lastError ? (
                              <p className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                                {connection.lastError}
                              </p>
                            ) : null}

                            <div className="mt-4 flex flex-wrap gap-2">
                              {authorizationUrl ? (
                                <Button
                                  type="button"
                                  className="rounded-full"
                                  onClick={() => {
                                    window.location.href = authorizationUrl;
                                  }}
                                >
                                  <ExternalLink className="mr-2 h-4 w-4" />
                                  {connected ? "Reconectar Strava" : "Conectar Strava"}
                                </Button>
                              ) : (
                                <Button
                                  type="button"
                                  className="rounded-full"
                                  disabled={!provider.available || connect.isPending || selectedScopes.length === 0 || connected || isStrava}
                                  onClick={() => connect.mutate({ provider: provider.provider as HealthProvider, consentAccepted: true, scopes: selectedScopes })}
                                >
                                  <Link2 className="mr-2 h-4 w-4" />
                                  Conectar
                                </Button>
                              )}
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
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <UXState
                      variant="empty"
                      title="Nenhum provider encontrado"
                      description="Quando houver integrações disponíveis, elas aparecerão aqui com status, sincronização e ações de conexão."
                    />
                  )}
                </CardContent>
              </Card>

              <div className="grid gap-4">
                <Card className="border-0 shadow-sm">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <ShieldCheck className="h-5 w-5 text-primary" />
                      Resumo de consentimento
                    </CardTitle>
                    <CardDescription>
                      O Strava coleta o consentimento na própria tela de autorização externa; providers locais continuam exigindo seleção visível de escopo na interface.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {selectedScopeLabels.length ? (
                      <div className="flex flex-wrap gap-2">
                        {selectedScopeLabels.map(scope => (
                          <Badge key={scope} variant="secondary" className="rounded-full px-3 py-1">{scope}</Badge>
                        ))}
                      </div>
                    ) : (
                      <UXState
                        variant="info"
                        compact
                        title="Selecione ao menos um tipo de dado"
                        description="Sem um consentimento marcado, a tela mantém a conexão bloqueada para evitar vínculo externo sem escopo definido."
                      />
                    )}
                    <div className="rounded-2xl border bg-muted/20 p-4 text-sm leading-6 text-muted-foreground">
                      A organização da tela separa autorização, vínculo técnico e sincronização. Isso reduz dúvida operacional e mostra quando o Strava já pode alimentar o registro de exercícios.
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-0 shadow-sm">
                  <CardHeader>
                    <CardTitle>Leitura rápida</CardTitle>
                    <CardDescription>Resumo curto para entender o estado geral sem percorrer a página inteira.</CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-3">
                    <Metric label="Disponibilidade" value={`${availableProviders}/${providers.length || 0} providers`} />
                    <Metric label="Conectados" value={connectedProviders ? `${connectedProviders} ativos` : "Nenhum ativo"} />
                    <Metric label="Atividades Strava" value={recentStravaActivities ? `${recentStravaActivities} recentes` : "Sem sync"} />
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="permissions" className="space-y-4">
            <div className="grid gap-4 xl:grid-cols-[1.2fr,0.8fr]">
              <Card className="border-0 shadow-sm">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <HeartPulse className="h-5 w-5 text-primary" />
                    Permissões antes da conexão
                  </CardTitle>
                  <CardDescription>
                    Escolha os tipos de dados permitidos antes de vincular providers locais. Para Strava, a autorização e os escopos são confirmados diretamente no OAuth externo.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {DATA_TYPES.map(item => {
                      const checked = selectedScopes.includes(item.value);
                      return (
                        <label key={item.value} className={`flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm transition ${checked ? "border-primary/30 bg-primary/5" : "bg-background"}`}>
                          <Checkbox
                            checked={checked}
                            onCheckedChange={() => toggleScope(item.value)}
                            className="mt-0.5"
                          />
                          <span className="space-y-1">
                            <span className="block font-medium text-foreground">{item.label}</span>
                            <span className="block text-muted-foreground">
                              {checked ? "Consentimento pronto para uso." : "Ainda não liberado para sincronização."}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                  {!selectedScopeLabels.length ? (
                    <UXState
                      variant="info"
                      title="Nenhum tipo de dado selecionado"
                      description="Marque pelo menos um consentimento para liberar a conexão dos providers disponíveis."
                    />
                  ) : null}
                </CardContent>
              </Card>

              <Card className="border-0 shadow-sm">
                <CardHeader>
                  <CardTitle>Como essa permissão entra no fluxo</CardTitle>
                  <CardDescription>
                    A tela tenta deixar claro o passo atual para evitar rolagem inútil e decisões feitas fora de contexto.
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3">
                  <FlowStep title="1. Conecte pelo Strava" description="O botão leva o usuário para login e autorização diretamente no Strava." />
                  <FlowStep title="2. Salve o vínculo" description="O callback grava o vínculo OAuth criptografado no backend quando o Strava retorna para o app." />
                  <FlowStep title="3. Sincronize e acompanhe" description="Revise os dados externos e confira os exercícios importados no registro principal." />
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="data" className="space-y-4">
            <Card className="border-0 shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Activity className="h-5 w-5 text-primary" />
                  Dados sincronizados
                </CardTitle>
                <CardDescription>
                  Registros externos mantêm tipo, unidade e origem para auditoria rápida. Atividades Strava com calorias válidas também são registradas como exercícios.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                  <Metric label="Passos" value={formatCountPtBr(status.data?.totals.steps ?? 0)} />
                  <Metric label="Atividade" value={formatCountPtBr(status.data?.totals.activityMinutes ?? 0, " min")} />
                  <Metric label="Gasto externo" value={formatCalories(status.data?.totals.energyBurnedCalories ?? 0)} />
                  <Metric label="Distância Strava" value={stravaDistanceKm > 0 ? `${formatNumber(stravaDistanceKm, 2)} km` : "0 km"} />
                  <Metric label="Com FC" value={formatCountPtBr(stravaActivitiesWithHeartRate)} />
                </div>

                {status.isLoading ? (
                  <UXState
                    variant="loading"
                    title="Carregando histórico externo"
                    description="Estou reunindo os últimos registros sincronizados para preencher este painel."
                  />
                ) : recentRecords.length ? (
                  <div className="space-y-5">
                    {recentStravaActivityRecords.length ? (
                      <section className="space-y-3" aria-labelledby="strava-activities-title">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <h2 id="strava-activities-title" className="text-base font-semibold tracking-tight">Atividades Strava detalhadas</h2>
                            <p className="text-sm text-muted-foreground">Distância, tempo, ritmo, elevação, frequência cardíaca e dados técnicos quando o Strava disponibilizar.</p>
                          </div>
                          <Badge variant="secondary" className="rounded-full px-3 py-1">
                            {formatCountPtBr(recentStravaActivityRecords.length, " atividades")}
                          </Badge>
                        </div>
                        <div className="grid gap-3 xl:grid-cols-2">
                          {recentStravaActivityRecords.map(record => (
                            <StravaActivityPanel key={record.id} record={record as SyncedHealthRecord} />
                          ))}
                        </div>
                      </section>
                    ) : null}

                    <section className="space-y-3" aria-labelledby="synced-records-title">
                      <div>
                        <h2 id="synced-records-title" className="text-base font-semibold tracking-tight">Registros brutos sincronizados</h2>
                        <p className="text-sm text-muted-foreground">Auditoria operacional com origem, tipo, unidade e horário medido.</p>
                      </div>
                      <div className="grid gap-2">
                        {recentRecords.map(record => (
                          <div key={record.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-background px-4 py-3 text-sm shadow-sm">
                            <div>
                              <p className="font-medium">{record.metadata?.name || formatDataType(record.dataType)}</p>
                              <p className="text-xs text-muted-foreground">
                                {new Date(record.measuredAt).toLocaleString("pt-BR")} · origem: {record.source}
                              </p>
                            </div>
                            <Badge variant="outline">{record.value} {record.unit}</Badge>
                          </div>
                        ))}
                      </div>
                    </section>
                  </div>
                ) : (
                  <UXState
                    variant="empty"
                    title="Nenhum dado externo sincronizado"
                    description="Depois de conectar e sincronizar um provider, os registros recentes aparecerão aqui com origem, unidade e horário medido."
                  />
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
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

function SurfaceStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-background px-4 py-3 shadow-sm">
      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-sm font-medium leading-6 text-foreground">{value}</p>
    </div>
  );
}

function StatusLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border bg-muted/20 px-3 py-3 text-sm">
      <p className="text-muted-foreground">{label}</p>
      <p className="mt-1 font-medium text-foreground">{value}</p>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border bg-background p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 text-xl font-semibold tracking-tight">{value}</p>
    </div>
  );
}

function FlowStep({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-2xl border bg-muted/20 p-4">
      <p className="font-medium tracking-tight text-foreground">{title}</p>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
    </div>
  );
}

function StravaActivityPanel({ record }: { record: SyncedHealthRecord }) {
  const metadata = record.metadata;
  const sportType = metadata?.sportType || record.activityType || "Atividade";
  const measuredAt = metadata?.startDateLocal || record.measuredAt;
  const caloriesLabel = metadata?.calories
    ? `${formatCalories(metadata.calories)}${metadata.estimatedCalories ? " estimadas" : ""}`
    : "Não informado";
  const primaryMetrics = [
    {
      icon: Route,
      label: "Distância",
      value: metadata?.distanceMeters ? formatDistance(metadata.distanceMeters) : "Não informado",
    },
    {
      icon: Timer,
      label: "Tempo",
      value: formatDuration(metadata?.movingTimeSeconds ?? record.value * 60),
    },
    {
      icon: Zap,
      label: "Calorias",
      value: caloriesLabel,
    },
    {
      icon: Gauge,
      label: isPaceActivity(sportType) ? "Ritmo médio" : "Velocidade média",
      value: metadata?.averageSpeedMetersPerSecond ? formatPaceOrSpeed(metadata.averageSpeedMetersPerSecond, sportType) : "Não informado",
    },
  ];
  const details = [
    metadata?.elapsedTimeSeconds ? ["Tempo total", formatDuration(metadata.elapsedTimeSeconds)] : null,
    metadata?.estimatedCalories ? ["Origem das calorias", "Estimativa do sistema"] : null,
    metadata?.estimatedCaloriesMet ? ["MET estimado", formatNumber(metadata.estimatedCaloriesMet, 1)] : null,
    metadata?.estimatedCaloriesWeightKg ? ["Peso de referência", `${formatNumber(metadata.estimatedCaloriesWeightKg, 0)} kg`] : null,
    metadata?.totalElevationGainMeters ? ["Elevação", `${Math.round(metadata.totalElevationGainMeters)} m`] : null,
    metadata?.averageHeartRate ? ["FC média", `${Math.round(metadata.averageHeartRate)} bpm`] : null,
    metadata?.maxHeartRate ? ["FC máxima", `${Math.round(metadata.maxHeartRate)} bpm`] : null,
    metadata?.averageCadence ? ["Cadência", formatNumber(metadata.averageCadence, 1)] : null,
    metadata?.averageWatts ? ["Potência média", `${Math.round(metadata.averageWatts)} W`] : null,
    metadata?.weightedAverageWatts ? ["Potência ponderada", `${Math.round(metadata.weightedAverageWatts)} W`] : null,
    metadata?.maxWatts ? ["Potência máxima", `${Math.round(metadata.maxWatts)} W`] : null,
    metadata?.maxSpeedMetersPerSecond ? ["Velocidade máxima", formatSpeed(metadata.maxSpeedMetersPerSecond)] : null,
    metadata?.kilojoules ? ["Energia", `${formatNumber(metadata.kilojoules, 1)} kJ`] : null,
    metadata?.deviceName ? ["Dispositivo", metadata.deviceName] : null,
    metadata?.gearId ? ["Equipamento", metadata.gearId] : null,
    metadata?.visibility ? ["Visibilidade", metadata.visibility] : null,
    metadata?.achievementCount ? ["Conquistas", formatCountPtBr(metadata.achievementCount)] : null,
    metadata?.prCount ? ["Recordes", formatCountPtBr(metadata.prCount)] : null,
    metadata?.kudosCount ? ["Kudos", formatCountPtBr(metadata.kudosCount)] : null,
    metadata?.trainer === true ? ["Tipo", "Indoor"] : null,
    metadata?.commute === true ? ["Deslocamento", "Sim"] : null,
    metadata?.manual === true ? ["Entrada manual", "Sim"] : null,
    metadata?.private === true ? ["Privada", "Sim"] : null,
  ].filter(Boolean) as Array<[string, string]>;

  return (
    <div className="rounded-2xl border bg-background p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="truncate text-base font-semibold tracking-tight">{metadata?.name || formatDataType(record.dataType)}</p>
          <p className="text-sm text-muted-foreground">{new Date(measuredAt).toLocaleString("pt-BR")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary" className="rounded-full px-3 py-1">{sportType}</Badge>
          {metadata?.estimatedCalories ? <Badge variant="outline" className="rounded-full px-3 py-1">Calorias estimadas</Badge> : null}
          {metadata?.hasHeartRate ? <Badge variant="outline" className="rounded-full px-3 py-1">FC</Badge> : null}
        </div>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {primaryMetrics.map(metric => (
          <div key={metric.label} className="rounded-2xl border bg-muted/20 p-3">
            <div className="flex items-center gap-2 text-muted-foreground">
              <metric.icon className="h-4 w-4" />
              <span className="text-xs font-medium uppercase tracking-[0.14em]">{metric.label}</span>
            </div>
            <p className="mt-2 text-sm font-semibold text-foreground">{metric.value}</p>
          </div>
        ))}
      </div>

      {details.length ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {details.map(([label, value]) => (
            <span key={`${label}-${value}`} className="rounded-full border bg-muted/20 px-3 py-1 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{label}:</span> {value}
            </span>
          ))}
        </div>
      ) : (
        <p className="mt-4 rounded-2xl border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
          O Strava não retornou métricas adicionais para esta atividade.
        </p>
      )}
    </div>
  );
}

function formatConnectionStatus(status?: string) {
  if (!status) return CONNECTION_STATUS_LABELS.disconnected;
  return CONNECTION_STATUS_LABELS[status] ?? status;
}

function formatDataType(dataType: string) {
  const match = DATA_TYPES.find(item => item.value === dataType);
  return match?.label ?? dataType;
}

function formatNumber(value: number, fractionDigits = 1) {
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

function formatDistance(distanceMeters: number) {
  return `${formatNumber(distanceMeters / 1000, 2)} km`;
}

function formatDuration(totalSeconds: number) {
  const safeSeconds = Math.max(Math.round(totalSeconds), 0);
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatSpeed(speedMetersPerSecond: number) {
  return `${formatNumber(speedMetersPerSecond * 3.6, 1)} km/h`;
}

function isPaceActivity(sportType: string) {
  return /run|walk|hike|corrida|caminhada|trilha/i.test(sportType);
}

function formatPaceOrSpeed(speedMetersPerSecond: number, sportType: string) {
  if (speedMetersPerSecond <= 0) return "Não informado";
  if (!isPaceActivity(sportType)) return formatSpeed(speedMetersPerSecond);

  const secondsPerKm = Math.round(1000 / speedMetersPerSecond);
  const minutes = Math.floor(secondsPerKm / 60);
  const seconds = String(secondsPerKm % 60).padStart(2, "0");
  return `${minutes}:${seconds}/km`;
}
