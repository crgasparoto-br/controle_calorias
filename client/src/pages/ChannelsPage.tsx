import React from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { MessageCircle, Send, Webhook } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export default function ChannelsPage() {
  const [userId, setUserId] = useState(1);
  const [message, setMessage] = useState("almocei arroz, feijão, frango grelhado e salada");
  const statusQuery = trpc.nutrition.whatsapp.status.useQuery();
  const simulateInbound = trpc.nutrition.whatsapp.simulateInbound.useMutation({
    onSuccess: result => {
      toast.success("Mensagem simulada com sucesso. Um rascunho foi criado para o usuário informado.");
      setLastSimulation(result);
    },
    onError: error => toast.error(error.message || "Falha ao simular mensagem do WhatsApp."),
  });
  const [lastSimulation, setLastSimulation] = useState<null | {
    draftId: string;
    processed: {
      detectedMealLabel: string;
      confidence: number;
      items: Array<{ foodName: string; portionText: string }>;
      totals: { calories: number; protein: number; carbs: number; fat: number };
    };
  }>(null);

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
                Painel operacional da integração de mensagens. O webhook já está preparado na aplicação e pode ser validado assim que as credenciais forem informadas.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <StatusRow label="Integração configurada" value={statusQuery.data?.configured ? "Sim" : "Não"} emphasize={!statusQuery.data?.configured} />
              <StatusRow label="Webhook público" value={statusQuery.data?.webhookPath || "/api/whatsapp/webhook"} mono />
              <div className="space-y-3 rounded-2xl border bg-muted/20 p-4 text-sm leading-6 text-muted-foreground">
                <p>
                  Enquanto as credenciais não são preenchidas, a plataforma continua apta para desenvolvimento do fluxo web e para testes simulados de mensagens recebidas.
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
                <Webhook className="h-5 w-5 text-primary" />
                Próximos passos de configuração
              </CardTitle>
              <CardDescription>
                Assim que você trouxer os dados da Meta, a conexão poderá ser finalizada com validação do webhook e respostas automáticas reais.
              </CardDescription>
            </CardHeader>
              <CardContent className="space-y-3">
              <StepCard title="1. Informar credenciais" text="Fornecer verify token, access token e phone number id do número comercial." />
              <StepCard title="2. Validar webhook" text="Apontar a URL pública da aplicação na conta Meta e confirmar o desafio de verificação." />
              <StepCard title="3. Testar mídia real" text="Executar testes com texto, imagem e áudio reais vindos do WhatsApp para fechar o ciclo multimodal." />
              <StepCard title="4. Confirmar retorno operacional" text="Verificar se a mensagem recebida gera rascunho, log de inferência e resposta automática sem erro no painel administrativo." />
            </CardContent>

          </Card>
        </div>

        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle>Simulação de mensagem inbound</CardTitle>
            <CardDescription>
              Use esta área para validar o comportamento lógico do canal enquanto o acesso oficial ainda não está configurado.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6 xl:grid-cols-[0.9fr,1.1fr]">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="simulation-user">ID interno do usuário</Label>
                <Input id="simulation-user" type="number" value={userId} onChange={event => setUserId(Number(event.target.value))} />
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
                onClick={() => simulateInbound.mutate({ userId, text: message })}
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
                    <Badge>{Math.round(lastSimulation.processed.confidence * 100)}% de confiança</Badge>
                  </div>
                  <div>
                    <p className="font-medium tracking-tight">{lastSimulation.processed.detectedMealLabel}</p>
                    <p className="mt-1 text-sm text-muted-foreground">Total estimado: {Math.round(lastSimulation.processed.totals.calories)} kcal</p>
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
    <div className="rounded-2xl border bg-muted/20 p-4">
      <p className="font-medium tracking-tight">{title}</p>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{text}</p>
    </div>
  );
}
