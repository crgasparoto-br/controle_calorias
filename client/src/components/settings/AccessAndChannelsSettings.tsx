import React, { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { Link2, Save, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";

export default function AccessAndChannelsSettings() {
  const utils = trpc.useUtils();
  const [phoneNumber, setPhoneNumber] = useState("");
  const [displayName, setDisplayName] = useState("");

  const whatsappStatusQuery = trpc.nutrition.whatsapp.status.useQuery();
  const patientRequestsQuery = trpc.nutrition.professionals.patientRequests.useQuery();

  useEffect(() => {
    if (whatsappStatusQuery.data?.connection) {
      setPhoneNumber(whatsappStatusQuery.data.connection.phoneNumber ?? "");
      setDisplayName(whatsappStatusQuery.data.connection.displayName ?? "");
      return;
    }

    setPhoneNumber("");
    setDisplayName("");
  }, [whatsappStatusQuery.data?.connection]);

  const saveConnection = trpc.nutrition.whatsapp.upsertConnection.useMutation({
    onSuccess: async result => {
      toast.success(`Contato ${result.phoneNumber} vinculado com sucesso ao seu usuário.`);
      await utils.nutrition.whatsapp.status.invalidate();
    },
    onError: error => toast.error(error.message || "Não foi possível salvar o contato do WhatsApp agora."),
  });

  const approveAccess = trpc.nutrition.professionals.approveAccess.useMutation({
    onSuccess: async () => {
      toast.success("Solicitação aprovada.");
      await Promise.all([
        utils.nutrition.professionals.patientRequests.invalidate(),
        utils.nutrition.professionals.myAccesses.invalidate(),
        utils.nutrition.professionals.history.invalidate(),
      ]);
    },
    onError: error => toast.error(error.message || "Não foi possível aprovar a solicitação."),
  });

  const revokeAccess = trpc.nutrition.professionals.revokeAccess.useMutation({
    onSuccess: async () => {
      toast.success("Compartilhamento revogado.");
      await Promise.all([
        utils.nutrition.professionals.patientRequests.invalidate(),
        utils.nutrition.professionals.myAccesses.invalidate(),
        utils.nutrition.professionals.history.invalidate(),
      ]);
    },
    onError: error => toast.error(error.message || "Não foi possível revogar a solicitação."),
  });

  const connection = whatsappStatusQuery.data?.connection;
  const hasConnection = Boolean(connection?.phoneNumber);
  const pendingCount = patientRequestsQuery.data?.filter(request => request.status === "pending").length ?? 0;

  return (
    <section className="grid gap-4 xl:grid-cols-[1.02fr,0.98fr]">
      <Card className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <Link2 className="h-5 w-5 text-primary" />
            Vínculo do WhatsApp
          </CardTitle>
          <CardDescription>
            O telefone do usuário final agora fica em Configurações, junto das preferências e dos outros vínculos pessoais. A operação do canal oficial continua na tela Canais.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <StatusCard label="Status" value={hasConnection ? "Vinculado" : "Pendente"} helper={hasConnection ? connection?.phoneNumber ?? "Contato salvo" : "Sem telefone associado ainda"} />
            <StatusCard label="Canal oficial" value={whatsappStatusQuery.data?.configured ? "Pronto" : "Pendente"} helper={whatsappStatusQuery.data?.channel?.phoneNumber || "Veja a tela Canais para configurar"} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="settings-whatsapp-phone">Telefone de origem do usuário</Label>
            <Input
              id="settings-whatsapp-phone"
              value={phoneNumber}
              onChange={event => setPhoneNumber(event.target.value)}
              placeholder="Ex.: 5511999998888"
            />
            <p className="text-xs text-muted-foreground">
              Use aqui o telefone que aparece no campo `from` do webhook. O número oficial da solução continua sendo configurado separadamente no ambiente.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="settings-whatsapp-display-name">Nome exibido no WhatsApp</Label>
            <Input
              id="settings-whatsapp-display-name"
              value={displayName}
              onChange={event => setDisplayName(event.target.value)}
              placeholder="Ex.: Gaspa"
            />
          </div>

          <Button
            type="button"
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
            {saveConnection.isPending ? "Salvando contato..." : "Salvar contato"}
          </Button>
        </CardContent>
      </Card>

      <Card className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <ShieldCheck className="h-5 w-5 text-primary" />
            Solicitações recebidas
          </CardTitle>
          <CardDescription>
            Aprovações e revogações como paciente ficam centralizadas aqui para evitar ida e volta entre telas quando você estiver ajustando preferências e acessos.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <StatusCard label="Pendentes" value={String(pendingCount)} helper="aguardando sua decisão" />
            <StatusCard label="Total" value={String(patientRequestsQuery.data?.length ?? 0)} helper="histórico carregado na sessão" />
          </div>

          {patientRequestsQuery.data?.length ? (
            <div className="grid gap-3">
              {patientRequestsQuery.data.map(request => (
                <div key={request.id} className="rounded-2xl border bg-background p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{request.professional?.displayName ?? `Profissional #${request.professionalUserId}`}</p>
                      <p className="mt-1 text-sm text-muted-foreground">{request.reason}</p>
                      <Badge className="mt-2" variant="secondary">{request.status}</Badge>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {request.status === "pending" ? (
                        <Button type="button" size="sm" onClick={() => approveAccess.mutate({ accessId: request.id })}>
                          Aprovar
                        </Button>
                      ) : null}
                      {request.status === "approved" || request.status === "pending" ? (
                        <Button type="button" size="sm" variant="outline" onClick={() => revokeAccess.mutate({ accessId: request.id })}>
                          <X className="mr-2 h-4 w-4" />
                          Revogar
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed bg-muted/20 p-6 text-sm leading-6 text-muted-foreground">
              Nenhuma solicitação recebida por enquanto.
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function StatusCard({ label, value, helper }: { label: string; value: string; helper: string }) {
  return (
    <div className="rounded-2xl border bg-background px-4 py-3 shadow-sm">
      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-base font-semibold tracking-tight">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{helper}</p>
    </div>
  );
}
