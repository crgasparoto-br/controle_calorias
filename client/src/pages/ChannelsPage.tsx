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

export default function ChannelsPage() {
  const [message, setMessage] = useState("almocei arroz, feijão, frango grelhado e salada");
  const [lastSimulation, setLastSimulation] = useState<null | {
    draftId: string;
    processed: {
      detectedMealLabel: string;
      confidence: number;
      items: Array<{ foodName: string; portionText: string }>;
      totals: { calories: number; protein: number; carbs: number; fat: number };
    };
  }>(null);

  const statusQuery = trpc.nutrition.whatsapp.status.useQuery();

  const simulateInbound = trpc.nutrition.whatsapp.simulateInbound.useMutation({
    onSuccess: result => {
      toast.success("Mensagem simulada com sucesso. Um rascunho foi criado para o usuário autenticado.");
      setLastSimulation(result);
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
          title="Operação do WhatsApp"
          description="A tela ficou focada na infraestrutura do canal e na simulação de mensagens. O vínculo do contato do usuário foi movido para Configurações para ficar junto das preferências e acessos pessoais."
          stats={
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <IntroStat label="Integração" value={isConfigured ? "Ativa" : "Pendente"} helper="status do ambiente" />
              <IntroStat label="Canal oficial" value={hasOfficialChannel ? "Configurado" : "Ausente"} helper="número da solução" />
              <IntroStat label="Contato vinculado" value={hasConnection ? "Sim" : "Não"} helper="gerenciado em Configurações" />
              <IntroStat label="Usuário atual" value={statusQuery.data?.currentUserId ? `#${statusQuery.data.currentUserId}` : "..."} helper="contexto da sessão" />
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
              <SurfaceStat label="Última simulação" value={lastSimulation ? lastSimulation.processed.detectedMealLabel : "Nenhuma rodada ainda"} />
            </div>
          </div>

          <TabsContent value="overview" className="space-y-4">
            <div className="grid gap-4 xl:grid-cols-[1.3fr,0.9fr]">
              <Card className="border-0 shadow-sm">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-xl">
                    <MessageCircle className="h-5 w-5 text-primary" />
                    WhatsApp Business Cloud API
                  </CardTitle>
                  <CardDescription>
                    Infraestrutura do canal oficial da solução. Este bloco deixa claro o que é ambiente, o que é webhook e o que depende de credenciais válidas.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {statusQuery.isLoading ? (
                    <UXState
                      variant="loading"
                      title="Carregando estado do canal"
                      description="Estou reunindo as informações do ambiente, webhook e canal oficial do WhatsApp."
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
                        <StatusRow label="Webhook público" value={statusQuery.data?.webhookPath || "/api/whatsapp/webhook"} mono />
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
                    <CardDescription>Leitura curta para identificar o próximo bloqueio sem percorrer a página inteira.</CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-3">
                    <FlowStep title="1. Ambiente pronto" text={isConfigured ? "As credenciais principais já estão ativas no ambiente." : "Ainda faltam ajustes de ambiente antes do uso real do canal."} />
                    <FlowStep title="2. Canal oficial definido" text={hasOfficialChannel ? "O número oficial da solução já está associado ao canal." : "O número oficial ainda não está disponível no status atual."} />
                    <FlowStep title="3. Contato do usuário vinculado" text={hasConnection ? "Já existe um telefone de origem associado ao usuário logado em Configurações." : "O vínculo do contato agora é feito em Configurações para evitar duplicidade com a tela de canais."} />
                  </CardContent>
                </Card>

                <Card className="border-0 shadow-sm">
                  <CardHeader>
                    <CardTitle>Credenciais esperadas</CardTitle>
                    <CardDescription>Referência visual do que o ambiente precisa expor para a operação do canal.</CardDescription>
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
                    Vínculo agora fica em Configurações
                  </CardTitle>
                  <CardDescription>
                    O telefone do usuário final foi centralizado em Configurações para ficar junto das preferências pessoais e das solicitações recebidas como paciente.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <StatusRow label="Telefone vinculado" value={connection?.phoneNumber || "Nenhum vínculo ativo"} mono emphasize={!hasConnection} />
                  <StatusRow label="Nome exibido" value={connection?.displayName || "Não informado"} emphasize={!connection?.displayName} />
                  <div className="rounded-2xl border bg-muted/20 p-4 text-sm leading-6 text-muted-foreground">
                    Use Configurações para editar esse telefone. A tela Canais continua responsável pelo estado do provedor, do webhook e das simulações técnicas.
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
                  <CardDescription>A sequência abaixo deixa explícita a diferença entre número oficial, telefone do usuário final e resposta do sistema.</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3">
                  <FlowStep title="1. Configurar o canal oficial" text="O ambiente define um único WHATSAPP_PHONE_NUMBER_ID usado para receber e responder mensagens." />
                  <FlowStep title="2. Vincular o contato em Configurações" text="O telefone de origem salvo nas configurações é associado ao usuário autenticado e passa a resolver o userId correto." />
                  <FlowStep title="3. Responder pelo canal fixo" text="Após o processamento, a refeição é salva para o contato identificado e a resposta sai pelo Phone Number ID oficial configurado." />
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="simulation" className="space-y-4">
            <Card className="border-0 shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Webhook className="h-5 w-5 text-primary" />
                  Simulação de mensagem inbound
                </CardTitle>
                <CardDescription>
                  Use esta área para validar o comportamento lógico do canal com o contexto do usuário autenticado, sem precisar informar manualmente o ID interno.
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
                    <UXState
                      variant="empty"
                      title="Nenhuma simulação executada"
                      description="O resultado da simulação aparecerá aqui com o rascunho criado e os alimentos reconhecidos pela inferência nutricional."
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
