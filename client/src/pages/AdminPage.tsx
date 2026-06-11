import React, { useEffect, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import PageIntro from "@/components/PageIntro";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCountPtBr } from "@/lib/numberFormat";
import { trpc } from "@/lib/trpc";
import { KeyRound, Save, Shield, Users } from "lucide-react";
import { toast } from "sonner";

export default function AdminPage() {
  const utils = trpc.useUtils();
  const admin = trpc.nutrition.admin.overview.useQuery(undefined, {
    retry: false,
  });
  const whatsappTokenStatus = trpc.nutrition.admin.whatsappTokenStatus.useQuery(undefined, {
    retry: false,
  });

  const [accessToken, setAccessToken] = useState("");

  useEffect(() => {
    setAccessToken("");
  }, [whatsappTokenStatus.data?.updatedAt, whatsappTokenStatus.data?.source]);

  const updateWhatsappToken = trpc.nutrition.admin.updateWhatsappToken.useMutation({
    onSuccess: async () => {
      toast.success("Token do WhatsApp atualizado com sucesso.");
      setAccessToken("");
      await Promise.all([
        utils.nutrition.admin.overview.invalidate(),
        utils.nutrition.admin.whatsappTokenStatus.invalidate(),
        utils.nutrition.whatsapp.status.invalidate(),
      ]);
    },
    onError: error => {
      toast.error(error.message || "Não foi possível atualizar o token do WhatsApp agora.");
    },
  });

  const tokenStatus = whatsappTokenStatus.data ?? admin.data?.whatsappToken;
  const canSaveToken = accessToken.trim().length >= 20 && !updateWhatsappToken.isPending;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <PageIntro
          eyebrow="Operação e segurança"
          title="Administração da plataforma"
          description="Acompanhe o uso do sistema, revise perfis cadastrados e atualize a credencial do WhatsApp quando houver troca de token."
          stats={(
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <IntroStat
                label="Usuários"
                value={formatCountPtBr(admin.data?.usage.usersCount ?? 0)}
                supporting="perfis conhecidos pela aplicação"
              />
              <IntroStat
                label="Refeições confirmadas"
                value={formatCountPtBr(admin.data?.usage.mealsCount ?? 0)}
                supporting="registros consolidados no sistema"
              />
              <IntroStat
                label="WhatsApp"
                value={tokenStatus?.configured ? "Configurado" : "Pendente"}
                supporting={tokenStatus?.source === "database" ? "credencial salva no painel" : tokenStatus?.source === "environment" ? "credencial vinda das configurações do servidor" : "nenhuma credencial ativa"}
              />
              <IntroStat
                label="Logs registrados"
                value={formatCountPtBr(admin.data?.usage.logsCount ?? 0)}
                supporting={`${formatCountPtBr(admin.data?.usage.pendingInferences ?? 0)} análises pendentes`}
              />
            </div>
          )}
        />

        <div className="grid gap-6 xl:grid-cols-[1fr,1fr]">
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <KeyRound className="h-5 w-5 text-primary" />
                Credenciais do WhatsApp
              </CardTitle>
              <CardDescription>
                Atualize o token de acesso usado pelo WhatsApp. O valor salvo fica protegido e aparece apenas mascarado nesta tela.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <StatusPill
                  label="Configuração"
                  value={tokenStatus?.configured ? "Configurado" : "Pendente"}
                  tone={tokenStatus?.configured ? "success" : "warning"}
                />
                <StatusPill
                  label="Origem ativa"
                  value={tokenStatus?.source === "database" ? "Painel admin" : tokenStatus?.source === "environment" ? "Servidor" : "Não configurado"}
                  tone={tokenStatus?.source === "database" ? "success" : tokenStatus?.source === "environment" ? "neutral" : "warning"}
                />
                <StatusPill
                  label="Token mascarado"
                  value={tokenStatus?.maskedValue || "Ainda não salvo"}
                  tone="neutral"
                  mono
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="admin-whatsapp-access-token">Token de acesso do WhatsApp</Label>
                <Input
                  id="admin-whatsapp-access-token"
                  type="password"
                  autoComplete="off"
                  value={accessToken}
                  onChange={event => setAccessToken(event.target.value)}
                  placeholder="Cole aqui o novo token de acesso"
                />
                <p className="text-sm leading-6 text-muted-foreground">
                  Salve um novo token quando a credencial atual expirar, for revogada ou precisar ser substituída.
                </p>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-muted/20 p-4">
                <div className="space-y-1 text-sm text-muted-foreground">
                  <p className="font-medium text-foreground">Atualização segura da credencial</p>
                  <p>
                    Use este campo apenas quando você gerar um novo token na Meta. Depois de salvar, as mensagens passam a usar a nova credencial.
                  </p>
                </div>
                <Button
                  className="gap-2"
                  disabled={!canSaveToken}
                  onClick={() => updateWhatsappToken.mutate({ accessToken })}
                >
                  <Save className="h-4 w-4" />
                  {updateWhatsappToken.isPending ? "Salvando..." : "Salvar token"}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5 text-primary" />
                Usuários e perfis
              </CardTitle>
              <CardDescription>Lista resumida dos perfis cadastrados para acompanhamento administrativo.</CardDescription>
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
        </div>

        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-primary" />
              Histórico de análises e mensagens
            </CardTitle>
            <CardDescription>Acompanhe eventos recentes que ajudam a verificar se registros e respostas estão acontecendo como esperado.</CardDescription>
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
                Ainda não há registros administrativos disponíveis. Eles aparecerão conforme o app for usado.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}

function IntroStat({ label, value, supporting }: { label: string; value: string; supporting: string }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-background px-4 py-3">
      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-xl font-semibold tracking-tight text-foreground">{value}</p>
      <p className="mt-1 text-sm text-muted-foreground">{supporting}</p>
    </div>
  );
}

function StatusPill({
  label,
  value,
  tone,
  mono = false,
}: {
  label: string;
  value: string;
  tone: "success" | "warning" | "neutral";
  mono?: boolean;
}) {
  const toneClassName =
    tone === "success"
      ? "bg-emerald-100 text-emerald-700"
      : tone === "warning"
        ? "bg-amber-100 text-amber-700"
        : "bg-slate-100 text-slate-700";

  return (
    <div className="rounded-2xl border bg-background p-4">
      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className={`mt-2 inline-flex rounded-full px-3 py-1 text-sm font-medium ${toneClassName} ${mono ? "font-mono text-xs sm:text-sm" : ""}`}>
        {value}
      </p>
    </div>
  );
}
