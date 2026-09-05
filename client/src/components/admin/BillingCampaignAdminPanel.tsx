import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { MailWarning, PauseCircle, RefreshCw, Send, ShieldCheck } from "lucide-react";
import React, { useMemo, useRef, useState } from "react";
import { toast } from "sonner";

function formatDate(value: Date | string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

const CATEGORY_LABELS: Record<string, string> = {
  promotional: "Promocional",
  operational: "Operacional",
  financial: "Financeira",
  security: "Segurança",
};

const AUDIENCE_LABELS: Record<string, string> = {
  individual: "Individual",
  professional: "Profissional",
};

const CHANNEL_LABELS: Record<string, string> = {
  internal: "Interno",
  email: "E-mail",
  whatsapp: "WhatsApp",
};

const DELIVERY_STATE_LABELS: Record<string, string> = {
  not_attempted: "Não tentado",
  pending: "Pendente",
  delivered: "Entregue",
  failed: "Falhou",
};

export default function BillingCampaignAdminPanel() {
  const utils = trpc.useUtils();
  const [campaign, setCampaign] = useState("");
  const [campaignVersion, setCampaignVersion] = useState("");
  const [category, setCategory] = useState<"" | "promotional" | "operational" | "financial" | "security">("");
  const [audience, setAudience] = useState<"" | "individual" | "professional">("");
  const [trigger, setTrigger] = useState("");
  const [milestone, setMilestone] = useState("");
  const [channel, setChannel] = useState<"" | "internal" | "email" | "whatsapp">("");
  const [deliveryState, setDeliveryState] = useState<"" | "not_attempted" | "pending" | "delivered" | "failed">("");
  const [state, setState] = useState<"" | "open" | "completed" | "failed">("");
  const [reason, setReason] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [responsibleUserId, setResponsibleUserId] = useState("");
  const retryRequestIds = useRef(new Map<string, string>());

  const queryInput = useMemo(() => ({
    limit: 100,
    ...(campaign.trim() ? { campaign: campaign.trim() } : {}),
    ...(campaignVersion.trim() ? { campaignVersion: campaignVersion.trim() } : {}),
    ...(category ? { category } : {}),
    ...(audience ? { audience } : {}),
    ...(trigger.trim() ? { trigger: trigger.trim() } : {}),
    ...(milestone.trim() ? { milestone: milestone.trim() } : {}),
    ...(channel ? { channel } : {}),
    ...(deliveryState ? { deliveryState } : {}),
    ...(state ? { state } : {}),
  }), [audience, campaign, campaignVersion, category, channel, deliveryState, milestone, state, trigger]);
  const notifications = trpc.billing.adminNotifications.useQuery(queryInput, { retry: false });

  const refresh = async () => {
    await utils.billing.adminNotifications.invalidate();
  };

  const retry = trpc.billing.adminRetryNotification.useMutation({
    onSuccess: async (result, variables) => {
      if (result.status === "delivered") toast.success("Comunicação reprocessada.");
      else if (result.status === "pending") toast.info("A tentativa ainda está em processamento; o mesmo pedido será reaproveitado.");
      else toast.warning("A tentativa foi registrada, mas o canal não confirmou a entrega.");
      if (result.status !== "pending") retryRequestIds.current.delete(`${variables.notificationId}:${variables.channel}`);
      await refresh();
    },
    onError: error => toast.error(error.message || "Não foi possível reprocessar a comunicação."),
  });
  const requestIdForRetry = (notificationId: string, channel: "email" | "whatsapp") => {
    const key = `${notificationId}:${channel}`;
    const current = retryRequestIds.current.get(key);
    if (current) return current;
    const created = window.crypto.randomUUID();
    retryRequestIds.current.set(key, created);
    return created;
  };
  const acknowledge = trpc.billing.adminAcknowledgeNotificationFailure.useMutation({
    onSuccess: async () => { toast.success("Falha reconhecida e atribuída."); await refresh(); },
    onError: error => toast.error(error.message || "Não foi possível reconhecer a falha."),
  });
  const pause = trpc.billing.adminSetCampaignPaused.useMutation({
    onSuccess: async result => {
      toast.success(result.paused ? "Campanha pausada para novas entregas." : "Campanha reativada para novas entregas.");
      await refresh();
    },
    onError: error => toast.error(error.message || "Não foi possível alterar a campanha."),
  });

  const requireReason = () => {
    if (reason.trim().length < 3) {
      toast.error("Informe um motivo para registrar a operação.");
      return false;
    }
    return true;
  };

  return (
    <section className="space-y-6" aria-labelledby="billing-campaign-admin-title">
      <Card>
        <CardHeader>
          <CardTitle id="billing-campaign-admin-title" className="flex items-center gap-2">
            <MailWarning className="h-5 w-5" /> Campanhas e entregas
          </CardTitle>
          <CardDescription>
            Acompanhe as comunicações internas, por e-mail e WhatsApp. Reprocessar uma entrega mantém o registro e o histórico originais.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
            <TextFilter id="campaign-filter" label="Campanha" value={campaign} onChange={setCampaign} placeholder="Nome exato" />
            <TextFilter id="campaign-version-filter" label="Versão" value={campaignVersion} onChange={setCampaignVersion} placeholder="Ex.: v1" />
            <SelectFilter id="category-filter" label="Categoria" value={category} onChange={value => setCategory(value as typeof category)} options={[['', 'Todas'], ['promotional', 'Promocional'], ['operational', 'Operacional'], ['financial', 'Financeira'], ['security', 'Segurança']]} />
            <SelectFilter id="audience-filter" label="Público" value={audience} onChange={value => setAudience(value as typeof audience)} options={[['', 'Todos'], ['individual', 'Individual'], ['professional', 'Profissional']]} />
            <TextFilter id="trigger-filter" label="Evento de origem" value={trigger} onChange={setTrigger} placeholder="Código do evento" />
            <TextFilter id="milestone-filter" label="Etapa" value={milestone} onChange={setMilestone} placeholder="Ex.: D7" />
            <SelectFilter id="channel-filter" label="Canal" value={channel} onChange={value => setChannel(value as typeof channel)} options={[['', 'Todos'], ['internal', 'Interno'], ['email', 'E-mail'], ['whatsapp', 'WhatsApp']]} />
            <SelectFilter id="delivery-filter" label="Situação da entrega" value={deliveryState} onChange={value => setDeliveryState(value as typeof deliveryState)} options={[['', 'Todas'], ['not_attempted', 'Não tentada'], ['pending', 'Pendente'], ['delivered', 'Entregue'], ['failed', 'Falhou']]} />
            <SelectFilter id="state-filter" label="Situação da comunicação" value={state} onChange={value => setState(value as typeof state)} options={[['', 'Todas'], ['open', 'Ação pendente'], ['completed', 'Concluída'], ['failed', 'Falha de canal']]} />
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-2 md:col-span-2"><Label htmlFor="campaign-reason">Motivo da operação</Label><Textarea id="campaign-reason" value={reason} onChange={event => setReason(event.target.value)} placeholder="Obrigatório para pausar, reprocessar ou atribuir uma falha" /></div>
            <div className="space-y-2"><Label htmlFor="campaign-owner">Responsável (ID do administrador)</Label><Input id="campaign-owner" value={responsibleUserId} onChange={event => setResponsibleUserId(event.target.value)} placeholder="Ex.: 12" /></div>
          </div>
          <div className="space-y-2"><Label htmlFor="campaign-override">Justificativa excepcional</Label><Input id="campaign-override" value={overrideReason} onChange={event => setOverrideReason(event.target.value)} placeholder="Use apenas para comunicação concluída, obsoleta ou pausada" /></div>

          {notifications.isLoading ? <div role="status" className="rounded-xl border p-4 text-sm text-muted-foreground">Carregando campanhas e entregas...</div> : null}
          {notifications.isError ? <div role="alert" className="rounded-xl border border-destructive/30 p-4 text-sm text-destructive">Não foi possível carregar a operação de campanhas.</div> : null}
          <div className="space-y-3">
            {notifications.data?.items.map(item => (
              <article key={item.notificationId} className="rounded-xl border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2"><p className="font-medium">{item.campaign}</p><Badge variant="outline">{item.campaignVersion}</Badge><Badge variant="secondary">{CATEGORY_LABELS[item.category] ?? item.category}</Badge><Badge variant="outline">{AUDIENCE_LABELS[item.audience] ?? item.audience}</Badge>{item.paused ? <Badge variant="destructive">Pausada</Badge> : null}{item.obsolete ? <Badge variant="destructive">Obsoleta</Badge> : null}</div>
                    <p className="mt-1 text-sm">{item.title}</p>
                    <p className="mt-1 text-xs text-muted-foreground">Usuário {item.payerUserId} · evento {item.trigger}{item.milestone ? ` · etapa ${item.milestone}` : ""} · {formatDate(item.effectiveAt)}</p>
                    <p className="mt-1 text-xs text-muted-foreground">Referência {item.correlationId} · chave de repetição segura {item.idempotencyKey} · versão do registro {item.audit.sourceFactVersion} · cancelamento de envio promocional {item.optOutApplicable ? "aplicável" : "não aplicável"}</p>
                    <p className="mt-1 text-xs text-muted-foreground">Base e classificação: {item.legalBasisClassification}</p>
                  </div>
                  <Badge variant={item.completionState === "open" ? "default" : "secondary"}>{item.completionState === "open" ? "Ação pendente" : "Concluída ou informativa"}</Badge>
                </div>
                <div className="mt-3 grid gap-2 md:grid-cols-3">
                  {item.channels.map(delivery => {
                    const sender = item.senders[delivery.channel];
                    return <div key={delivery.channel} className="rounded-lg bg-muted/30 p-3 text-xs"><div className="flex items-center justify-between"><span className="font-medium">{CHANNEL_LABELS[delivery.channel] ?? delivery.channel}</span><Badge variant="outline">{DELIVERY_STATE_LABELS[delivery.state] ?? delivery.state}</Badge></div><p className="mt-2 text-muted-foreground">Emissor: {sender.label} · {sender.configured ? "configurado" : "não configurado"}</p><p className="mt-1 text-muted-foreground">Tentativas: {delivery.attempts}{delivery.responsibleUserId ? ` · responsável ${delivery.responsibleUserId}` : ""}</p><p className="mt-1 text-muted-foreground">Próxima tentativa: {formatDate(delivery.nextAttemptAt)} · atualização {formatDate(delivery.updatedAt)}</p></div>;
                  })}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" disabled={pause.isPending} onClick={() => { if (!requireReason()) return; pause.mutate({ campaign: item.campaign, campaignVersion: item.campaignVersion, paused: !item.paused, reason: reason.trim() }); }}><PauseCircle className="h-4 w-4" />{item.paused ? "Retomar campanha" : "Pausar campanha"}</Button>
                  <Button size="sm" variant="outline" disabled={retry.isPending} onClick={() => { if (!requireReason()) return; retry.mutate({ requestId: requestIdForRetry(item.notificationId, "whatsapp"), notificationId: item.notificationId, userId: item.payerUserId, channel: "whatsapp", reason: reason.trim(), ...(overrideReason.trim() ? { overrideReason: overrideReason.trim() } : {}) }); }}><Send className="h-4 w-4" />Reprocessar WhatsApp</Button>
                  <Button size="sm" variant="outline" disabled={retry.isPending} onClick={() => { if (!requireReason()) return; retry.mutate({ requestId: requestIdForRetry(item.notificationId, "email"), notificationId: item.notificationId, userId: item.payerUserId, channel: "email", reason: reason.trim(), ...(overrideReason.trim() ? { overrideReason: overrideReason.trim() } : {}) }); }}><Send className="h-4 w-4" />Reprocessar e-mail</Button>
                  {item.channels.filter(delivery => delivery.definitiveFailure && delivery.channel !== "internal").map(delivery => <Button key={delivery.channel} size="sm" variant="secondary" disabled={acknowledge.isPending} onClick={() => { const assignedToUserId = Number(responsibleUserId); if (!requireReason()) return; if (!Number.isInteger(assignedToUserId) || assignedToUserId <= 0) { toast.error("Informe o ID do responsável administrativo."); return; } acknowledge.mutate({ notificationId: item.notificationId, userId: item.payerUserId, channel: delivery.channel as "email" | "whatsapp", assignedToUserId, reason: reason.trim() }); }}><ShieldCheck className="h-4 w-4" />Reconhecer {CHANNEL_LABELS[delivery.channel] ?? delivery.channel}</Button>)}
                </div>
              </article>
            ))}
            {!notifications.isLoading && !notifications.data?.items.length ? <p className="rounded-xl border p-6 text-center text-sm text-muted-foreground">Nenhuma comunicação encontrada para os filtros atuais.</p> : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Indicadores por campanha, versão e canal</CardTitle><CardDescription>Métricas sem fonte confiável permanecem “n/d”, em vez de serem estimadas.</CardDescription></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[1180px] text-sm"><thead className="bg-muted/40 text-left text-xs text-muted-foreground"><tr><th className="p-3">Campanha</th><th className="p-3">Versão</th><th className="p-3">Canal</th><th className="p-3">Criadas</th><th className="p-3">Enviadas</th><th className="p-3">Entregues</th><th className="p-3">Falhas</th><th className="p-3">Reprocessamentos</th><th className="p-3">Duplicidades evitadas</th><th className="p-3">Aberturas</th><th className="p-3">Ação concluída</th><th className="p-3">Cancelamentos de envio</th><th className="p-3">Chamados</th><th className="p-3">Tempo de resolução</th></tr></thead><tbody className="divide-y">{notifications.data?.analytics.map(row => <tr key={`${row.campaign}-${row.campaignVersion}-${row.channel}`}><td className="p-3">{row.campaign}</td><td className="p-3">{row.campaignVersion}</td><td className="p-3">{CHANNEL_LABELS[row.channel] ?? row.channel}</td><td className="p-3">{row.created}</td><td className="p-3">{row.sent}</td><td className="p-3">{row.delivered}</td><td className="p-3">{row.failed}</td><td className="p-3">{row.retries}</td><td className="p-3">{row.deduplications}</td><td className="p-3">{row.opened ?? "n/d"}</td><td className="p-3">{row.actionCompleted}</td><td className="p-3">{row.optOut ?? "n/d"}</td><td className="p-3">{row.tickets ?? "n/d"}</td><td className="p-3">{row.averageResolutionMinutes == null ? "n/d" : `${row.averageResolutionMinutes} min`}</td></tr>)}</tbody></table>
          <div className="mt-4 flex justify-end"><Button variant="ghost" onClick={() => void refresh()}><RefreshCw className="h-4 w-4" />Atualizar</Button></div>
        </CardContent>
      </Card>
    </section>
  );
}

function TextFilter({ id, label, value, onChange, placeholder }: { id: string; label: string; value: string; onChange: (value: string) => void; placeholder: string }) {
  return <div className="space-y-2"><Label htmlFor={id}>{label}</Label><Input id={id} value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} /></div>;
}

function SelectFilter({ id, label, value, onChange, options }: { id: string; label: string; value: string; onChange: (value: string) => void; options: Array<[string, string]> }) {
  return <div className="space-y-2"><Label htmlFor={id}>{label}</Label><select id={id} className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={value} onChange={event => onChange(event.target.value)}>{options.map(([optionValue, text]) => <option key={optionValue || "all"} value={optionValue}>{text}</option>)}</select></div>;
}