import React, { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import PageIntro from "@/components/PageIntro";
import UXState from "@/components/UXState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { formatCalories, formatPercentPtBr } from "@/lib/numberFormat";
import { trpc } from "@/lib/trpc";
import { Link2, MessageCircle, Send, Smartphone, Webhook } from "lucide-react";
import { toast } from "sonner";
import { Link } from "wouter";

type SimulationDraftResult = {
  draftId: string;
  processed: {
    detectedMealLabel: string;
    confidence: number;
    items: Array<{ foodName: string; portionText: string }>;
    totals: { calories: number; protein: number; carbs: number; fat: number };
  };
};

type SimulationIntentResult = {
  handled: true;
  action: "water_logged" | "meal_item_grams_adjusted" | "clarification_needed";
  reply: string;
  eventType: string;
  detail: string;
};

type SimulationResult = SimulationDraftResult | SimulationIntentResult;

function isDraftSimulation(result: SimulationResult): result is SimulationDraftResult {
  return "draftId" in result;
}

function getSimulationSummary(result: SimulationResult | null) {
  if (!result) return "Nenhuma rodada ainda";
  if (isDraftSimulation(result)) return result.processed.detectedMealLabel;
  if (result.action === "clarification_needed") return "Aguardando esclarecimento";
  return "Ação interpretada";
}

export default function ChannelsPage() {
  const [message, setMessage] = useState("almocei arroz, feijão, frango grelhado e salada");
  const [lastSimulation, setLastSimulation] = useState<SimulationResult | null>(null);

  const statusQuery = trpc.nutrition.whatsapp.status.useQuery();

  const simulateInbound = trpc.nutrition.whatsapp.simulateInbound.useMutation({
    onSuccess: result => {
      const simulation = result as SimulationResult;
      toast.success(isDraftSimulation(simulation) ? "Mensagem simulada com sucesso. Um rascunho foi criado para o usuário autenticado." : simulation.reply);
      setLastSimulation(simulation);
    },
    onError: error => toast.error(error.message || "Não foi possível simular a mensagem do WhatsApp agora."),
  });

  const connection = statusQuery.data?.connection;
  const hasConnection = Boolean(connection?.phoneNumber);
  const isConfigured = Boolean(statusQuery.data?.configured);
  const hasOfficialChannel = Boolean(statusQuery.data?.channel?.phoneNumber);

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-7xl space-y-6">
        <PageIntro
          eyebrow="Canais"
          title="WhatsApp Business Cloud API"
          description="Revise se o canal está pronto para receber mensagens, confira o telefone vinculado e teste uma mensagem antes de usar no dia a dia."
          stats={
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <IntroStat label="Integração" value={isConfigured ? "Ativa" : "Pendente"} helper="status do canal" />
              <IntroStat label="Canal oficial" value={hasOfficialChannel ? "Configurado" : "Ausente"} helper="número usado pelo app" />
              <IntroStat label="Contato vinculado" value={hasConnection ? "Sim" : "Não"} helper="gerenciado em Configurações" />
              <IntroStat label="Usuário atual" value={statusQuery.data?.currentUserId ? `#${statusQuery.data.currentUserId}` : "..."} helper="sessão em uso" />
            </div>
          }
        />

        <Tabs defaultValue="overview" className="space-y-4">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <TabsList className="h-auto w-full flex-wrap rounded-2xl p-1 sm:w-auto">
              <TabsTrigger value="overview" className="min-w-[140px] rounded-xl px-4 py-2">Canal oficial</TabsTrigger>
              <TabsTrigger value="connection" className="min-w-[140px] rounded-xl px-4 py-2">Vínculo do contato</TabsTrigger>
              <TabsTrigger value="simulation" className="min-w-[140px] rounded-xl px-4 py-2">Simulação</TabsTrigger>
            </TabsList>
            <div className="grid gap-3 sm:grid-cols-3 xl:w-[34rem]">
              <SurfaceStat label="Canal" value={isConfigured ? "Pronto para receber mensagens" : "Ainda depende de configuração"} />
              <SurfaceStat label="Contato" value={hasConnection ? connection?.phoneNumber ?? "Vinculado" : "Sem vínculo ativo"} />
              <SurfaceStat label="Última simulação" value={getSimulationSummary(lastSimulation)} />
            </div>
          </div>

          <TabsContent value="overview" className="space-y-4">
            <div className="grid gap-4 xl:grid-cols-[1.3fr,0.9fr]">
              <Card className="border-0 shadow-sm">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-xl">
                    <MessageCircle className="h-5 w-5 text-primary" />
                    Canal oficial do WhatsApp
                  </CardTitle>
                  <CardDescription>
                    Veja se o número oficial está configurado e se o canal está pronto para receber registros por mensagem.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {statusQuery.isLoading ? (
                    <UXState
                      variant="loading"
                      title="Carregando estado do canal"
                      description="Estamos verificando o número oficial, o vínculo do contato e a disponibilidade para mensagens."
                    />
                  ) : statusQuery.isError ? (
                    <UXState
                      variant="error"
                      title="Não foi possível carregar o canal"
                      description={statusQuery.error.message || "Tente novamente em instantes para revisar o estado da integração."}
                    />
                  ) : (
                    <>
                      <div className="grid gap-3 md:grid-cols-2">
                        <StatusRow label="Integração configurada" value={isConfigured ? "Sim" : "Não"} emphasize={!isConfigured} />
                        <StatusRow label="Usuário autenticado" value={statusQuery.data?.currentUserId ? `#${statusQuery.data.currentUserId}` : "Carregando..."} mono />
                        <StatusRow label="Endereço de recebimento" value={statusQuery.data?.webhookPath || "/api/whatsapp/webhook"} mono />
                        <StatusRow label="Status do vínculo" value={connection?.status === "active" ? "Ativo" : hasConnection ? connection?.status || "Pendente" : "Pendente de vínculo"} emphasize={!hasConnection} />
                      </div>
                      <div className="grid gap-3">
                        <StatusRow label="Número oficial da solução" value={statusQuery.data?.channel?.phoneNumber || "Não configurado"} emphasize={!hasOfficialChannel} mono />
                        <StatusRow label="Phone Number ID oficial" value={statusQuery.data?.channel?.phoneNumberId || "Não configurado"} emphasize={!statusQuery.data?.channel?.phoneNumberId} mono />
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>

              <div className="grid gap-4">
                <Card className="border-0 shadow-sm">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-xl">
                      <Webhook className="h-5 w-5 text-primary" />
                      Checklist rápido
                    </CardTitle>
                    <CardDescription>Use esta leitura para identificar o que ainda falta antes de receber mensagens reais.</CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-3">
                    <FlowStep title="1. Canal pronto" text={isConfigured ? "As credenciais principais já estão ativas." : "Ainda faltam ajustes antes do uso real do canal."} />
                    <FlowStep title="2. Número oficial definido" text={hasOfficialChannel ? "O número oficial do app já está associado ao canal." : "O número oficial ainda não aparece como disponível."} />
                    <FlowStep title="3. Contato do usuário vinculado" text={hasConnection ? "Já existe um telefone associado ao usuário logado em Configurações." : "Vincule o telefone em Configurações para associar mensagens ao usuário correto."} />
                  </CardContent>
                </Card>

                <Card className="border-0 shadow-sm">
                  <CardHeader>
                    <CardTitle>Credenciais esperadas</CardTitle>
                    <CardDescription>Itens necessários para manter o WhatsApp funcionando corretamente.</CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-2 text-xs sm:grid-cols-2">
                    <EnvTile value="WHATSAPP_PHONE_NUMBER" />
                    <EnvTile value="WHATSAPP_VERIFY_TOKEN" />
                    <EnvTile value="WHATSAPP_ACCESS_TOKEN" />
                    <EnvTile value="WHATSAPP_PHONE_NUMBER_ID" />
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="connection" className="space-y-4">
            <div className="grid gap-4 xl:grid-cols-[1fr,0.95fr]">
              <Card className="border-0 shadow-sm">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-xl">
                    <Link2 className="h-5 w-5 text-primary" />
                    Vínculo do contato
                  </CardTitle>
                  <CardDescription>
                    O telefone usado para enviar mensagens fica em Configurações, junto das preferências pessoais da conta.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <StatusRow label="Telefone vinculado" value={connection?.phoneNumber || "Nenhum vínculo ativo"} mono emphasize={!hasConnection} />
                  <StatusRow label="Nome exibido" value={connection?.displayName || "Não informado"} emphasize={!connection?.displayName} />
                  <div className="rounded-2xl border bg-muted/20 p-4 text-sm leading-6 text-muted-foreground">
                    Use Configurações para editar esse telefone. Esta tela mostra o estado do canal e permite testar mensagens.
                  </div>
                  <Link href="/settings">
                    <Button className="rounded-full" type="button">Abrir configurações</Button>
                  </Link>
                </CardContent>
              </Card>

              <Card className="border-0 shadow-sm">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-xl">
                    <Smartphone className="h-5 w-5 text-primary" />
                    Como o fluxo funciona
                  </CardTitle>
                  <CardDescription>Entenda a diferença entre o número oficial do app, o seu telefone e a resposta enviada pelo sistema.</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3">
                  <FlowStep title="1. Usar o número oficial" text="O app recebe mensagens por um número oficial configurado para o serviço." />
                  <FlowStep title="2. Vincular seu contato" text="O telefone salvo em Configurações identifica a conta que enviou a mensagem." />
                  <FlowStep title="3. Receber a resposta" text="Depois do registro, a resposta volta pelo número oficial do app para o contato identificado." />
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="simulation" className="space-y-4">
            <Card className="border-0 shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Webhook className="h-5 w-5 text-primary" />
                  Simulação de mensagem recebida
                </CardTitle>
                <CardDescription>
                  Teste uma mensagem como se ela tivesse chegado pelo WhatsApp e confira o resultado antes de usar o canal real.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-6 xl:grid-cols-[0.92fr,1.08fr]">
                <div className="space-y-4">
                  <div className="rounded-2xl border bg-muted/20 p-4 text-sm leading-6 text-muted-foreground">
                    <div className="flex items-center gap-2 font-medium text-foreground">
                      <Smartphone className="h-4 w-4 text-primary" />
                      Contexto da simulação
                    </div>
                    <p className="mt-2">Usuário autenticado: {statusQuery.data?.currentUserId ? `#${statusQuery.data.currentUserId}` : "Carregando..."}</p>
                    <p>Contato atualmente vinculado: {connection?.phoneNumber || "não vinculado"}</p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="simulation-message">Mensagem simulada</Label>
                    <Textarea
                      id="simulation-message"
                      className="min-h-40 rounded-2xl"
                      value={message}
                      onChange={event => setMessage(event.target.value)}
                      placeholder="Descreva uma refeição como se tivesse chegado pelo WhatsApp"
                    />
                  </div>

                  <Button
                    className="rounded-full"
                    disabled={simulateInbound.isPending || !message.trim()}
                    onClick={() => simulateInbound.mutate({ text: message })}
                  >
                    <Send className="mr-2 h-4 w-4" />
                    {simulateInbound.isPending ? "Simulando..." : "Simular mensagem"}
                  </Button>
                </div>

                <div>
                  {lastSimulation ? (
                    isDraftSimulation(lastSimulation) ? (
                      <div className="space-y-4 rounded-3xl border bg-muted/20 p-5">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="text-sm text-muted-foreground">Rascunho gerado</p>
                            <p className="font-mono text-sm text-foreground">{lastSimulation.draftId}</p>
                          </div>
                          <Badge>{formatPercentPtBr(lastSimulation.processed.confidence * 100)}% de confiança</Badge>
                        </div>
                        <div>
                          <p className="font-medium tracking-tight">{lastSimulation.processed.detectedMealLabel}</p>
                          <p className="mt-1 text-sm text-muted-foreground">Total estimado: {formatCalories(lastSimulation.processed.totals.calories)}</p>
                        </div>
                        <div className="space-y-2">
                          {lastSimulation.processed.items.map((item, index) => (
                            <div key={`${item.foodName}-${index}`} className="rounded-2xl border bg-background p-3 text-sm">
                              <strong className="text-foreground">{item.foodName}</strong>
                              <span className="text-muted-foreground"> · {item.portionText}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-4 rounded-3xl border bg-muted/20 p-5">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="text-sm text-muted-foreground">Ação interpretada</p>
                            <p className="font-medium tracking-tight">{getSimulationSummary(lastSimulation)}</p>
                          </div>
                          <Badge variant={lastSimulation.action === "clarification_needed" ? "secondary" : "default"}>{lastSimulation.action}</Badge>
                        </div>
                        <p className="text-sm leading-6 text-muted-foreground">{lastSimulation.reply}</p>
                      </div>
                    )
                  ) : (
                    <UXState
                      variant="empty"
                      title="Nenhuma simulação executada"
                      description="O resultado da simulação aparecerá aqui com o rascunho criado, a ação interpretada ou o pedido de esclarecimento."
                    />
                  )}
                </div>
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

function StatusRow({
  label,
  value,
  emphasize,
  mono,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl border bg-background p-4 shadow-sm">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={`${mono ? "font-mono" : "font-medium"} ${emphasize ? "text-amber-600" : "text-foreground"}`}>{value}</p>
    </div>
  );
}

function FlowStep({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-2xl border bg-background p-4">
      <p className="font-medium tracking-tight">{title}</p>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{text}</p>
    </div>
  );
}

function EnvTile({ value }: { value: string }) {
  return <div className="rounded-xl border bg-muted/30 p-3 font-mono">{value}</div>;
}
