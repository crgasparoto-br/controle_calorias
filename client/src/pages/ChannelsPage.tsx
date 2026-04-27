import React, { useEffect, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatCalories, formatPercentPtBr } from "@/lib/numberFormat";
import { trpc } from "@/lib/trpc";
import { Link2, MessageCircle, Save, Send, Smartphone, Webhook } from "lucide-react";
import { toast } from "sonner";

export default function ChannelsPage() {
  const utils = trpc.useUtils();
  const [phoneNumber, setPhoneNumber] = useState("");
  const [displayName, setDisplayName] = useState("");
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

  useEffect(() => {
    if (statusQuery.data?.connection) {
      setPhoneNumber(statusQuery.data.connection.phoneNumber ?? "");
      setDisplayName(statusQuery.data.connection.displayName ?? "");
      return;
    }

    setPhoneNumber("");
    setDisplayName("");
  }, [statusQuery.data?.connection]);

  const saveConnection = trpc.nutrition.whatsapp.upsertConnection.useMutation({
    onSuccess: async result => {
      toast.success(`Número ${result.phoneNumber} vinculado com sucesso ao seu usuário.`);
      await utils.nutrition.whatsapp.status.invalidate();
    },
    onError: error => toast.error(error.message || "Falha ao salvar o vínculo do WhatsApp."),
  });

  const simulateInbound = trpc.nutrition.whatsapp.simulateInbound.useMutation({
    onSuccess: result => {
      toast.success("Mensagem simulada com sucesso. Um rascunho foi criado para o usuário autenticado.");
      setLastSimulation(result);
    },
    onError: error => toast.error(error.message || "Falha ao simular mensagem do WhatsApp."),
  });

  const connection = statusQuery.data?.connection;
  const hasConnection = Boolean(connection?.phoneNumber);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="grid gap-6 xl:grid-cols-[1fr,1fr]">
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl">
                <MessageCircle className="h-5 w-5 text-primary" />
                WhatsApp Business Cloud API
              </CardTitle>
              <CardDescription>
                Painel operacional da integração de mensagens. Agora o número do WhatsApp precisa estar vinculado ao usuário autenticado para que o webhook consiga atribuir automaticamente as refeições recebidas.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <StatusRow label="Integração configurada" value={statusQuery.data?.configured ? "Sim" : "Não"} emphasize={!statusQuery.data?.configured} />
              <StatusRow label="Webhook público" value={statusQuery.data?.webhookPath || "/api/whatsapp/webhook"} mono />
              <StatusRow label="Usuário autenticado" value={statusQuery.data?.currentUserId ? `#${statusQuery.data.currentUserId}` : "Carregando..."} mono />
              <StatusRow label="Número vinculado" value={connection?.phoneNumber || "Não vinculado"} emphasize={!hasConnection} mono />
              <StatusRow label="Status do vínculo" value={connection?.status === "active" ? "Ativo" : hasConnection ? connection?.status || "Pendente" : "Pendente de vínculo"} emphasize={!hasConnection} />
              <div className="space-y-3 rounded-2xl border bg-muted/20 p-4 text-sm leading-6 text-muted-foreground">
                <p>
                  Sem um vínculo ativo entre o número do WhatsApp e o usuário logado, a plataforma não consegue identificar com segurança a quem atribuir os alimentos, a refeição e o horário recebidos pelo webhook.
                </p>
                <div className="rounded-2xl border bg-background p-4">
                  <p className="font-medium text-foreground">Credenciais esperadas para ativação</p>
                  <div className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
                    <div className="rounded-xl border bg-muted/30 p-3 font-mono">WHATSAPP_VERIFY_TOKEN</div>
                    <div className="rounded-xl border bg-muted/30 p-3 font-mono">WHATSAPP_ACCESS_TOKEN</div>
                    <div className="rounded-xl border bg-muted/30 p-3 font-mono">WHATSAPP_PHONE_NUMBER_ID</div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl">
                <Link2 className="h-5 w-5 text-primary" />
                Vínculo do número do WhatsApp
              </CardTitle>
              <CardDescription>
                Informe o número que envia as imagens para associá-lo ao seu usuário autenticado e habilitar o registro automático das refeições processadas pelo canal WhatsApp.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="whatsapp-phone">Número do WhatsApp</Label>
                <Input
                  id="whatsapp-phone"
                  value={phoneNumber}
                  onChange={event => setPhoneNumber(event.target.value)}
                  placeholder="Ex.: 5511999998888"
                />
                <p className="text-xs text-muted-foreground">
                  Use apenas números ou inclua os símbolos que preferir. O sistema normaliza automaticamente o valor salvo.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="whatsapp-display-name">Nome exibido no WhatsApp</Label>
                <Input
                  id="whatsapp-display-name"
                  value={displayName}
                  onChange={event => setDisplayName(event.target.value)}
                  placeholder="Ex.: Gaspa"
                />
              </div>

              <Button
                className="rounded-full"
                disabled={saveConnection.isPending || !phoneNumber.trim()}
                onClick={() =>
                  saveConnection.mutate({
                    phoneNumber,
                    displayName: displayName.trim() || undefined,
                  })
                }
              >
                <Save className="mr-2 h-4 w-4" />
                {saveConnection.isPending ? "Salvando vínculo..." : "Salvar vínculo"}
              </Button>

              <div className="rounded-2xl border bg-muted/20 p-4 text-sm leading-6 text-muted-foreground">
                <p className="font-medium text-foreground">Como o fluxo funciona</p>
                <div className="mt-3 space-y-3">
                  <StepCard title="1. Vincular o número" text="O número enviado aqui é associado ao usuário autenticado e passa a ser usado pelo webhook para resolver o userId correto." />
                  <StepCard title="2. Receber a imagem" text="Quando a imagem chega pelo WhatsApp, o sistema identifica o número remetente, localiza o vínculo ativo e processa os alimentos para o usuário correspondente." />
                  <StepCard title="3. Registrar automaticamente" text="Após o processamento, a refeição é salva automaticamente com o horário do evento recebido, além da resposta textual de retorno no próprio WhatsApp." />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

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
          <CardContent className="grid gap-6 xl:grid-cols-[0.9fr,1.1fr]">
            <div className="space-y-4">
              <div className="rounded-2xl border bg-muted/20 p-4 text-sm leading-6 text-muted-foreground">
                <div className="flex items-center gap-2 font-medium text-foreground">
                  <Smartphone className="h-4 w-4 text-primary" />
                  Contexto da simulação
                </div>
                <p className="mt-2">Usuário autenticado: {statusQuery.data?.currentUserId ? `#${statusQuery.data.currentUserId}` : "Carregando..."}</p>
                <p>Número atualmente vinculado: {connection?.phoneNumber || "não vinculado"}</p>
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
                <div className="rounded-3xl border border-dashed bg-muted/20 p-6 text-sm leading-6 text-muted-foreground">
                  O resultado da simulação aparecerá aqui com o rascunho criado e os alimentos reconhecidos pela inferência nutricional.
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
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

function StepCard({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-2xl border bg-background p-4">
      <p className="font-medium tracking-tight">{title}</p>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{text}</p>
    </div>
  );
}
