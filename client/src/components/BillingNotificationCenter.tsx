import React from "react";
import BillingUsageLimitationAppeal from "@/components/BillingUsageLimitationAppeal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { Bell, CheckCheck, RefreshCw, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

function formatDateTime(value: Date | string) {
  return new Date(value).toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

const DELIVERY_LABELS: Record<string, string> = {
  email: "e-mail",
  whatsapp: "WhatsApp",
};

export default function BillingNotificationCenter() {
  const utils = trpc.useUtils();
  const notifications = trpc.billing.notifications.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: true,
    staleTime: 10_000,
  });
  const markRead = trpc.billing.markNotificationRead.useMutation({
    onSuccess: async () => {
      await utils.billing.notifications.invalidate();
    },
    onError: error =>
      toast.error(error.message || "Não foi possível marcar o aviso como lido."),
  });

  return (
    <section aria-labelledby="billing-notifications-heading" className="space-y-6">
      <Card>
        <CardHeader>
          <h2
            id="billing-notifications-heading"
            className="flex items-center gap-2 font-semibold leading-none"
          >
            <Bell className="h-5 w-5" aria-hidden="true" />
            Avisos sobre plano e acesso
          </h2>
          <CardDescription>
            Este histórico é a fonte permanente das comunicações comerciais e financeiras da
            sua conta. Ler um aviso não conclui a ação comercial correspondente.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {notifications.isLoading ? (
            <div role="status" aria-live="polite" className="rounded-xl border p-4 text-sm text-muted-foreground">
              Carregando avisos do backend...
            </div>
          ) : notifications.isError ? (
            <div role="alert" className="space-y-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
              <p className="text-sm">
                Não foi possível carregar o histórico de avisos. Nenhuma situação comercial foi
                alterada por esta falha.
              </p>
              <Button type="button" variant="outline" onClick={() => void notifications.refetch()}>
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                Tentar novamente
              </Button>
            </div>
          ) : notifications.data?.length ? (
            <ol className="space-y-4">
              {notifications.data.map(notification => {
                const unread = notification.readState === "unread";
                const open = notification.completionState === "open";
                const externalFailed = notification.deliveryState === "failed";
                return (
                  <li key={notification.notificationId}>
                    <article
                      aria-label={notification.title}
                      className={`rounded-2xl border p-4 sm:p-5 ${
                        unread ? "border-primary/40 bg-primary/[0.03]" : "bg-card"
                      }`}
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0 space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant={unread ? "default" : "secondary"}>
                              {unread ? "Não lida" : "Lida"}
                            </Badge>
                            <Badge variant={open ? "outline" : "secondary"}>
                              {notification.situation}
                            </Badge>
                          </div>
                          <div>
                            <h3 className="font-semibold">{notification.title}</h3>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {notification.campaign} · {notification.campaignVersion} ·{" "}
                              {formatDateTime(notification.effectiveAt)}
                            </p>
                          </div>
                        </div>
                        {unread ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={markRead.isPending}
                            onClick={() =>
                              markRead.mutate({ notificationId: notification.notificationId })
                            }
                            aria-label={`Marcar como lido: ${notification.title}`}
                          >
                            <CheckCheck className="h-4 w-4" aria-hidden="true" />
                            Marcar como lido
                          </Button>
                        ) : null}
                      </div>

                      <dl className="mt-4 grid gap-3 md:grid-cols-2">
                        <NotificationDetail label="O que aconteceu" value={notification.whatOccurred} />
                        <NotificationDetail
                          label="Ação esperada"
                          value={notification.expectedAction ?? "Nenhuma ação é necessária neste momento."}
                        />
                        <NotificationDetail label="Se nada for feito" value={notification.consequence} />
                        <NotificationDetail label="Ajuda" value={notification.support} />
                      </dl>

                      {externalFailed ? (
                        <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-sm" role="status">
                          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                          <p>
                            O envio externo por {DELIVERY_LABELS[notification.deliveryChannel ?? ""] ?? "outro canal"} não foi confirmado. Este aviso continua disponível aqui e não precisa ser recriado.
                          </p>
                        </div>
                      ) : null}

                      {notification.actionHref && open ? (
                        <div className="mt-4">
                          <a
                            href={notification.actionHref}
                            className="text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            Revisar ação em Plano e acesso
                          </a>
                        </div>
                      ) : null}
                    </article>
                  </li>
                );
              })}
            </ol>
          ) : (
            <div className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">
              Ainda não há avisos comerciais ou financeiros registrados para esta conta.
            </div>
          )}
        </CardContent>
      </Card>
      <BillingUsageLimitationAppeal />
    </section>
  );
}

function NotificationDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-muted/30 p-3">
      <dt className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 text-sm">{value}</dd>
    </div>
  );
}
