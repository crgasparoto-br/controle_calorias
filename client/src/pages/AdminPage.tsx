import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { Shield, Users } from "lucide-react";

export default function AdminPage() {
  const admin = trpc.nutrition.admin.overview.useQuery(undefined, {
    retry: false,
  });

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-4">
          <AdminMetric title="Usuários" value={String(admin.data?.usage.usersCount ?? 0)} />
          <AdminMetric title="Refeições confirmadas" value={String(admin.data?.usage.mealsCount ?? 0)} />
          <AdminMetric title="Inferências pendentes" value={String(admin.data?.usage.pendingInferences ?? 0)} />
          <AdminMetric title="Logs registrados" value={String(admin.data?.usage.logsCount ?? 0)} />
        </div>

        <div className="grid gap-6 xl:grid-cols-[1fr,1fr]">
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5 text-primary" />
                Usuários e perfis
              </CardTitle>
              <CardDescription>Lista resumida dos perfis conhecidos pela aplicação para acompanhamento operacional.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {admin.data?.users.map(user => (
                <div key={user.id} className="rounded-2xl border bg-muted/20 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-medium tracking-tight">{user.name || "Usuário sem nome"}</p>
                      <p className="text-sm text-muted-foreground">{user.email || user.openId}</p>
                    </div>
                    <Badge variant={user.role === "admin" ? "default" : "secondary"}>{user.role}</Badge>
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground">
                    Último acesso: {new Date(user.lastSignedIn).toLocaleString("pt-BR")}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5 text-primary" />
                Logs de inferência e operações
              </CardTitle>
              <CardDescription>Visão consolidada das principais operações do backend multimodal e do canal de mensagens.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {admin.data?.recentInferenceLogs.length ? (
                admin.data.recentInferenceLogs.map(log => (
                  <div key={log.id} className="rounded-2xl border bg-background p-4 shadow-sm">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="font-medium tracking-tight">{log.eventType}</p>
                        <p className="text-sm text-muted-foreground">{log.detail}</p>
                      </div>
                      <Badge
                        className={
                          log.status === "error"
                            ? "bg-rose-100 text-rose-700 hover:bg-rose-100"
                            : log.status === "warning"
                              ? "bg-amber-100 text-amber-700 hover:bg-amber-100"
                              : "bg-emerald-100 text-emerald-700 hover:bg-emerald-100"
                        }
                      >
                        {log.status}
                      </Badge>
                    </div>
                    <p className="mt-3 text-xs text-muted-foreground">
                      {log.origin} · {new Date(log.createdAt).toLocaleString("pt-BR")}
                    </p>
                  </div>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed bg-muted/20 p-6 text-sm leading-6 text-muted-foreground">
                  Ainda não há registros administrativos disponíveis. Eles aparecerão automaticamente após o uso do dashboard e das inferências multimodais.
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}

function AdminMetric({ title, value }: { title: string; value: string }) {
  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="p-5">
        <p className="text-sm text-muted-foreground">{title}</p>
        <p className="mt-2 text-3xl font-semibold tracking-tight">{value}</p>
      </CardContent>
    </Card>
  );
}
