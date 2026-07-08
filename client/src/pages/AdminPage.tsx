import React, { useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import PageIntro from "@/components/PageIntro";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatCountPtBr } from "@/lib/numberFormat";
import { trpc } from "@/lib/trpc";
import { Database, KeyRound, Save, Search, Shield, Users } from "lucide-react";
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
  const [foodCatalogQuery, setFoodCatalogQuery] = useState("");

  const foodCatalog = trpc.nutrition.foods.catalogSearch.useQuery({
    query: foodCatalogQuery,
    limit: 50,
    includeInactive: true,
  }, {
    retry: false,
  });

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
  const foodCatalogItems = foodCatalog.data ?? [];
  const globalFoodCount = useMemo(() => foodCatalogItems.filter(food => food.scope === "global").length, [foodCatalogItems]);
  const customFoodCount = useMemo(() => foodCatalogItems.filter(food => food.scope === "user").length, [foodCatalogItems]);
  const inactiveFoodCount = useMemo(() => foodCatalogItems.filter(food => food.status !== "active").length, [foodCatalogItems]);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <PageIntro
          eyebrow="Operação e segurança"
          title="Administração da plataforma"
          description="Acompanhe o uso do sistema, revise perfis cadastrados, consulte a base alimentar e atualize a credencial do WhatsApp quando houver troca de token."
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

        <Tabs defaultValue="operation" className="space-y-6">
          <TabsList className="h-auto w-full flex-wrap rounded-2xl p-1 sm:w-auto">
            <TabsTrigger value="operation" className="min-w-[150px] rounded-xl px-4 py-2">Operação</TabsTrigger>
            <TabsTrigger value="foods" className="min-w-[150px] rounded-xl px-4 py-2">Base de alimentos</TabsTrigger>
          </TabsList>

          <TabsContent value="operation" className="space-y-6">
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
          </TabsContent>

          <TabsContent value="foods" className="space-y-6">
            <div className="grid gap-3 md:grid-cols-3">
              <IntroStat label="Itens listados" value={formatCountPtBr(foodCatalogItems.length)} supporting="resultado atual da consulta" />
              <IntroStat label="Globais" value={formatCountPtBr(globalFoodCount)} supporting="itens compartilhados pelo sistema" />
              <IntroStat label="Personalizados/inativos" value={`${formatCountPtBr(customFoodCount)} / ${formatCountPtBr(inactiveFoodCount)}`} supporting="usuário / status não ativo" />
            </div>

            <Card className="border-0 shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Database className="h-5 w-5 text-primary" />
                  Base de alimentos usada pelo sistema
                </CardTitle>
                <CardDescription>
                  Consulte alimentos globais, personalizados e registros inativos usados nas buscas nutricionais. A consulta mostra até 50 itens por vez; use o filtro para localizar marcas, nomes, categorias ou alimentos específicos.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="pl-9"
                    value={foodCatalogQuery}
                    onChange={event => setFoodCatalogQuery(event.target.value)}
                    placeholder="Buscar na base: arroz, requeijão, catupiry, zero lactose..."
                  />
                </div>

                {foodCatalog.isLoading ? (
                  <div className="rounded-2xl border border-dashed bg-muted/20 p-6 text-sm leading-6 text-muted-foreground">
                    Carregando base de alimentos...
                  </div>
                ) : foodCatalog.isError ? (
                  <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6 text-sm leading-6 text-destructive">
                    {foodCatalog.error.message || "Não foi possível consultar a base de alimentos agora."}
                  </div>
                ) : foodCatalogItems.length ? (
                  <div className="grid gap-3">
                    {foodCatalogItems.map(food => <FoodCatalogCard key={food.id} food={food} />)}
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed bg-muted/20 p-6 text-sm leading-6 text-muted-foreground">
                    Nenhum alimento encontrado nesta consulta. Tente buscar por outro nome, marca ou categoria.
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
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

function FoodCatalogCard({
  food,
}: {
  food: {
    id: number;
    scope: string;
    source: {
      slug: string | null;
      name: string | null;
      version: string | null;
      foodCode: string | null;
    } | null;
    name: string;
    brandName: string | null;
    category: string | null;
    status: "active" | "deprecated" | "merged";
    nutrientsPer100g: {
      caloriesKcal: number;
      proteinGrams: number;
      carbsGrams: number;
      fatGrams: number;
      fiberGrams: number | null;
      sugarGrams: number | null;
      sodiumMg: number | null;
    };
    userSignals: {
      favorite: boolean;
      usageCount: number;
      lastUsedAt: string | null;
    };
  };
}) {
  return (
    <div className="rounded-2xl border bg-background p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold tracking-tight text-foreground">{food.name}</p>
            {food.brandName ? <Badge variant="secondary">{food.brandName}</Badge> : null}
            {food.category ? <Badge variant="outline">{food.category}</Badge> : null}
            <Badge variant={food.scope === "global" ? "default" : "secondary"}>{food.scope === "global" ? "Global" : "Usuário"}</Badge>
            <Badge variant={food.status === "active" ? "outline" : "secondary"}>{food.status}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Fonte: {food.source?.name || food.source?.slug || "personalizada/manual"}
            {food.source?.foodCode ? ` · código ${food.source.foodCode}` : ""}
            {food.source?.version ? ` · versão ${food.source.version}` : ""}
          </p>
        </div>
        <div className="text-right text-xs text-muted-foreground">
          <p>ID #{food.id}</p>
          <p>{food.userSignals.usageCount ? `${formatCountPtBr(food.userSignals.usageCount)} usos` : "sem uso recente"}</p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4 xl:grid-cols-7">
        <NutritionValue label="Kcal" value={food.nutrientsPer100g.caloriesKcal} />
        <NutritionValue label="Proteínas" value={food.nutrientsPer100g.proteinGrams} unit="g" />
        <NutritionValue label="Carboidratos" value={food.nutrientsPer100g.carbsGrams} unit="g" />
        <NutritionValue label="Gorduras" value={food.nutrientsPer100g.fatGrams} unit="g" />
        <NutritionValue label="Fibras" value={food.nutrientsPer100g.fiberGrams} unit="g" />
        <NutritionValue label="Açúcares" value={food.nutrientsPer100g.sugarGrams} unit="g" />
        <NutritionValue label="Sódio" value={food.nutrientsPer100g.sodiumMg} unit="mg" />
      </div>
    </div>
  );
}

function NutritionValue({ label, value, unit = "" }: { label: string; value: number | null; unit?: string }) {
  return (
    <div className="rounded-xl bg-muted/50 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-semibold">
        {value == null ? "-" : `${Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}${unit}`}
      </p>
    </div>
  );
}
