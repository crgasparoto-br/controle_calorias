import React, { useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import PageIntro from "@/components/PageIntro";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatCountPtBr } from "@/lib/numberFormat";
import { trpc } from "@/lib/trpc";
import {
  Activity,
  AlertTriangle,
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  Database,
  Filter,
  KeyRound,
  ListFilter,
  PlayCircle,
  RotateCcw,
  Save,
  Search,
  Settings,
  Shield,
  Upload,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";

const FOOD_CATALOG_PAGE_SIZE = 25;
const ADMIN_ACTIVITY_PAGE_SIZE = 20;

type AdminArea = "overview" | "users" | "activities" | "foods" | "settings";
type UserProfile = "admin" | "professional" | "user";
type LastAccessFilter = "all" | "today" | "7d" | "30d" | "older";
type ActivityPeriod = "today" | "24h" | "7d" | "30d";
type ActivityStatus = "all" | "success" | "warning" | "error";
type ActivityOrigin = "all" | "web" | "whatsapp" | "admin";
type ActivityCategory =
  | "all"
  | "ai"
  | "meal"
  | "whatsapp"
  | "foods"
  | "water"
  | "exercise"
  | "system";

type FoodCatalogItem = {
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

type FoodImportJob = "import_taco" | "import_tbca";

type FoodImportReport = {
  sourceSlug: string;
  sourceVersion: string;
  inserted: number;
  updated: number;
  ignored: number;
  aliasesInserted: number;
  portionsInserted: number;
  possibleDuplicates: Array<{
    sourceFoodCode: string;
    normalizedName: string;
    existingFoodIds: number[];
  }>;
  errors: Array<{ sourceFoodCode?: string; name?: string; reason: string }>;
};

const AREA_LABELS: Record<AdminArea, string> = {
  overview: "Visão geral",
  users: "Usuários",
  activities: "Atividades",
  foods: "Base de alimentos",
  settings: "Configurações",
};

const USER_ROLE_LABELS: Record<UserProfile, string> = {
  admin: "Administrador",
  professional: "Profissional",
  user: "Usuário",
};

const LOG_STATUS_LABELS: Record<string, string> = {
  success: "Concluído",
  warning: "Atenção",
  error: "Não concluído",
};

const LOG_ORIGIN_LABELS: Record<string, string> = {
  web: "Aplicativo web",
  whatsapp: "WhatsApp",
  admin: "Administração",
};

const LOG_EVENT_LABELS: Record<string, string> = {
  "whatsapp.access_token_updated": "Credencial do WhatsApp atualizada",
  "whatsapp.connection_updated": "Vínculo do WhatsApp atualizado",
  "whatsapp.idempotency.duplicate_detected": "Mensagem duplicada identificada",
  "whatsapp.goal_history_unavailable": "Histórico de metas indisponível",
  "quick_edit.token_invalid": "Link de edição rápida inválido",
  "quick_edit.public_error_sanitized": "Falha tratada na edição rápida",
  "meal.inference_fallback": "Análise de refeição concluída por alternativa",
  "ai.inference_call": "Análise por inteligência artificial",
  "foods.import_job_executed": "Importação da base alimentar",
};

const ACTIVITY_PERIOD_LABELS: Record<ActivityPeriod, string> = {
  today: "Hoje",
  "24h": "Últimas 24 horas",
  "7d": "Últimos 7 dias",
  "30d": "Últimos 30 dias",
};

const ACTIVITY_STATUS_OPTIONS: Array<{ value: ActivityStatus; label: string }> =
  [
    { value: "all", label: "Todos" },
    { value: "success", label: "Concluído" },
    { value: "warning", label: "Atenção" },
    { value: "error", label: "Não concluído" },
  ];

const ACTIVITY_ORIGIN_OPTIONS: Array<{ value: ActivityOrigin; label: string }> =
  [
    { value: "all", label: "Todas" },
    { value: "web", label: "Aplicativo web" },
    { value: "whatsapp", label: "WhatsApp" },
    { value: "admin", label: "Administração" },
  ];

const ACTIVITY_CATEGORY_OPTIONS: Array<{
  value: ActivityCategory;
  label: string;
}> = [
  { value: "all", label: "Todos os tipos" },
  { value: "ai", label: "IA" },
  { value: "meal", label: "Refeição" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "foods", label: "Base alimentar" },
  { value: "water", label: "Água" },
  { value: "exercise", label: "Exercício" },
  { value: "system", label: "Sistema" },
];

export default function AdminPage() {
  const utils = trpc.useUtils();
  const [activeArea, setActiveArea] = useState<AdminArea>("overview");
  const [accessToken, setAccessToken] = useState("");
  const [isTokenFormOpen, setIsTokenFormOpen] = useState(false);
  const [foodCatalogQuery, setFoodCatalogQuery] = useState("");
  const [foodCatalogPage, setFoodCatalogPage] = useState(1);
  const [foodImportJob, setFoodImportJob] =
    useState<FoodImportJob>("import_taco");
  const [foodImportFile, setFoodImportFile] = useState<File | null>(null);
  const [foodImportSourceVersion, setFoodImportSourceVersion] = useState("");
  const [foodImportReport, setFoodImportReport] =
    useState<FoodImportReport | null>(null);

  const admin = trpc.nutrition.admin.overview.useQuery(undefined, {
    retry: false,
  });
  const whatsappTokenStatus = trpc.nutrition.admin.whatsappTokenStatus.useQuery(
    undefined,
    { retry: false }
  );
  const [userSearch, setUserSearch] = useState("");
  const [userProfile, setUserProfile] = useState<UserProfile | "all">("all");
  const [lastAccess, setLastAccess] = useState<LastAccessFilter>("all");
  const [activitySearch, setActivitySearch] = useState("");
  const [activityPeriod, setActivityPeriod] = useState<ActivityPeriod>("7d");
  const [activityStatus, setActivityStatus] = useState<ActivityStatus>("all");
  const [activityOrigin, setActivityOrigin] = useState<ActivityOrigin>("all");
  const [activityCategory, setActivityCategory] =
    useState<ActivityCategory>("all");
  const [activityPage, setActivityPage] = useState(1);

  const activityInput = useMemo(
    () => ({
      search: activitySearch,
      period: activityPeriod,
      status: activityStatus,
      origin: activityOrigin,
      eventTypeCategory: activityCategory,
      page: activityPage,
      pageSize: ADMIN_ACTIVITY_PAGE_SIZE,
    }),
    [
      activityCategory,
      activityPage,
      activityOrigin,
      activityPeriod,
      activitySearch,
      activityStatus,
    ]
  );
  const activitiesEndpoint = (
    trpc.nutrition.admin as unknown as {
      activities?: {
        useQuery?: (
          input: typeof activityInput,
          options: { retry: boolean; enabled: boolean }
        ) => any;
      };
    }
  ).activities;
  const activities = activitiesEndpoint?.useQuery
    ? activitiesEndpoint.useQuery(activityInput, {
        retry: false,
        enabled: activeArea === "activities",
      })
    : { data: undefined, isLoading: false, isError: false };

  const foodCatalog = trpc.nutrition.foods.catalogSearch?.useQuery?.(
    {
      query: foodCatalogQuery,
      limit: 500,
      includeInactive: true,
    },
    {
      retry: false,
    }
  ) ?? {
    data: [],
    isLoading: false,
    isError: false,
    error: null,
    refetch: undefined,
  };

  useEffect(() => {
    setAccessToken("");
  }, [whatsappTokenStatus.data?.updatedAt, whatsappTokenStatus.data?.source]);

  useEffect(() => {
    setFoodCatalogPage(1);
  }, [foodCatalogQuery]);

  useEffect(() => {
    setActivityPage(1);
  }, [
    activityCategory,
    activityOrigin,
    activityPeriod,
    activitySearch,
    activityStatus,
  ]);

  const updateWhatsappToken =
    trpc.nutrition.admin.updateWhatsappToken.useMutation({
      onSuccess: async () => {
        toast.success("Credencial do WhatsApp atualizada com sucesso.");
        setAccessToken("");
        setIsTokenFormOpen(false);
        await Promise.all([
          utils.nutrition.admin.overview.invalidate(),
          utils.nutrition.admin.whatsappTokenStatus.invalidate(),
          utils.nutrition.whatsapp.status.invalidate(),
        ]);
      },
      onError: () => {
        toast.error("Não foi possível atualizar a credencial do WhatsApp agora.");
      },
    });

  const runFoodImportJob = trpc.nutrition.admin.runFoodImportJob?.useMutation?.(
    {
      onSuccess: async report => {
        setFoodImportReport(report as FoodImportReport);
        toast.success(
          `Carga concluída: ${formatCountPtBr(report.inserted)} inseridos e ${formatCountPtBr(report.updated)} atualizados.`
        );
        await foodCatalog.refetch?.();
      },
      onError: () => {
        toast.error("Não foi possível executar a carga de alimentos agora.");
      },
    }
  ) ?? {
    isPending: false,
    mutate: () =>
      toast.error("A importação de alimentos não está disponível agora."),
  };

  async function handleRunCsvImport() {
    if (!foodImportFile) {
      toast.error("Selecione um arquivo CSV antes de executar a importação.");
      return;
    }

    const csvContent = await foodImportFile.text();
    runFoodImportJob.mutate({
      job: foodImportJob,
      csvContent,
      fileName: foodImportFile.name,
      sourceVersion: foodImportSourceVersion.trim() || undefined,
    });
  }

  const tokenStatus = whatsappTokenStatus.data ?? admin.data?.whatsappToken;
  const canSaveToken =
    accessToken.trim().length >= 20 && !updateWhatsappToken.isPending;
  const foodCatalogItems = (foodCatalog.data ?? []) as FoodCatalogItem[];
  const globalFoodCount = useMemo(
    () => foodCatalogItems.filter(food => food.scope === "global").length,
    [foodCatalogItems]
  );
  const customFoodCount = useMemo(
    () => foodCatalogItems.filter(food => food.scope === "user").length,
    [foodCatalogItems]
  );
  const inactiveFoodCount = useMemo(
    () => foodCatalogItems.filter(food => food.status !== "active").length,
    [foodCatalogItems]
  );
  const foodCatalogTotalPages = Math.max(
    1,
    Math.ceil(foodCatalogItems.length / FOOD_CATALOG_PAGE_SIZE)
  );
  const foodCatalogPageStart = foodCatalogItems.length
    ? (foodCatalogPage - 1) * FOOD_CATALOG_PAGE_SIZE + 1
    : 0;
  const foodCatalogPageEnd = Math.min(
    foodCatalogPage * FOOD_CATALOG_PAGE_SIZE,
    foodCatalogItems.length
  );
  const paginatedFoodCatalogItems = useMemo(() => {
    const start = (foodCatalogPage - 1) * FOOD_CATALOG_PAGE_SIZE;
    return foodCatalogItems.slice(start, start + FOOD_CATALOG_PAGE_SIZE);
  }, [foodCatalogItems, foodCatalogPage]);

  useEffect(() => {
    setFoodCatalogPage(currentPage =>
      Math.min(Math.max(currentPage, 1), foodCatalogTotalPages)
    );
  }, [foodCatalogTotalPages]);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <PageIntro
          eyebrow="Administração e segurança"
          title="Administração da plataforma"
          description="Acompanhe indicadores, usuários, atividades, base alimentar e configurações administrativas em áreas separadas."
          stats={
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
                supporting={
                  tokenStatus?.source === "database"
                    ? "credencial salva no painel"
                    : tokenStatus?.source === "environment"
                      ? "credencial definida no servidor"
                      : "nenhuma credencial ativa"
                }
              />
              <IntroStat
                label="Eventos operacionais"
                value={formatCountPtBr(admin.data?.usage.logsCount ?? 0)}
                supporting={
                  typeof admin.data?.usage.attentionCountLast24h === "number"
                    ? `${formatCountPtBr(admin.data.usage.attentionCountLast24h)} casos para atenção nas últimas 24 horas`
                    : "atenção/erro indisponível no momento"
                }
              />
            </div>
          }
        />

        <Tabs
          value={activeArea}
          onValueChange={value => setActiveArea(value as AdminArea)}
          className="space-y-6"
        >
          <TabsList
            aria-label="Áreas administrativas"
            className="h-auto w-full flex-wrap justify-start rounded-2xl p-1 sm:w-fit"
          >
            {(Object.keys(AREA_LABELS) as AdminArea[]).map(area => (
              <TabsTrigger
                key={area}
                value={area}
                className="min-h-10 min-w-[132px] rounded-xl px-4 py-2"
              >
                {AREA_LABELS[area]}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="overview">
            <OverviewArea
              admin={admin}
              onOpenActivities={() => setActiveArea("activities")}
            />
          </TabsContent>
          <TabsContent value="users">
            <UsersArea
              admin={admin}
              search={userSearch}
              onSearchChange={setUserSearch}
              profile={userProfile}
              onProfileChange={setUserProfile}
              lastAccess={lastAccess}
              onLastAccessChange={setLastAccess}
            />
          </TabsContent>
          <TabsContent value="activities">
            <ActivitiesArea
              query={activities}
              filters={{
                activitySearch,
                activityPeriod,
                activityStatus,
                activityOrigin,
                activityCategory,
              }}
              actions={{
                setActivitySearch,
                setActivityPeriod,
                setActivityStatus,
                setActivityOrigin,
                setActivityCategory,
                setActivityPage,
              }}
              page={activityPage}
            />
          </TabsContent>
          <TabsContent value="foods">
            <FoodsArea
              foodCatalogItems={foodCatalogItems}
              globalFoodCount={globalFoodCount}
              customFoodCount={customFoodCount}
              inactiveFoodCount={inactiveFoodCount}
              foodImportReport={foodImportReport}
              foodImportJob={foodImportJob}
              foodImportFile={foodImportFile}
              foodImportSourceVersion={foodImportSourceVersion}
              foodCatalogQuery={foodCatalogQuery}
              foodCatalog={foodCatalog}
              paginatedFoodCatalogItems={paginatedFoodCatalogItems}
              foodCatalogPage={foodCatalogPage}
              foodCatalogTotalPages={foodCatalogTotalPages}
              foodCatalogPageStart={foodCatalogPageStart}
              foodCatalogPageEnd={foodCatalogPageEnd}
              runFoodImportJob={runFoodImportJob}
              onFoodImportJobChange={setFoodImportJob}
              onFoodImportFileChange={setFoodImportFile}
              onFoodImportSourceVersionChange={setFoodImportSourceVersion}
              onFoodCatalogQueryChange={setFoodCatalogQuery}
              onFoodCatalogPageChange={setFoodCatalogPage}
              onRunCsvImport={handleRunCsvImport}
            />
          </TabsContent>
          <TabsContent value="settings">
            <SettingsArea
              tokenStatus={tokenStatus}
              accessToken={accessToken}
              isOpen={isTokenFormOpen}
              canSaveToken={canSaveToken}
              isSaving={updateWhatsappToken.isPending}
              onOpen={() => {
                setAccessToken("");
                setIsTokenFormOpen(true);
              }}
              onCancel={() => {
                setAccessToken("");
                setIsTokenFormOpen(false);
              }}
              onAccessTokenChange={setAccessToken}
              onSave={() => updateWhatsappToken.mutate({ accessToken })}
            />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}

function OverviewArea({
  admin,
  onOpenActivities,
}: {
  admin: { data?: any; isLoading: boolean; isError: boolean };
  onOpenActivities: () => void;
}) {
  return (
    <div className="space-y-6">
      <section aria-labelledby="admin-overview-heading">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-primary">Visão geral</p>
            <h2
              id="admin-overview-heading"
              className="text-2xl font-semibold tracking-tight"
            >
              Prioridades operacionais
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Resumo atual sem repetir listas de usuários ou eventos.
            </p>
          </div>
          <Button
            variant="outline"
            className="gap-2"
            onClick={onOpenActivities}
          >
            <Activity className="h-4 w-4" />
            Ver atividades
          </Button>
        </div>
        {admin.isLoading ? (
          <LoadingState text="Carregando pendências operacionais..." />
        ) : admin.isError ? (
          <ErrorState text="Não foi possível carregar o resumo administrativo agora." />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <OperationalItem
              label="Análises pendentes"
              value={formatCountPtBr(admin.data?.usage.pendingInferences ?? 0)}
              supporting="fonte canônica do processamento atual"
              tone={admin.data?.usage.pendingInferences ? "warning" : "success"}
            />
            <OperationalItem
              label="Configuração do WhatsApp"
              value={
                admin.data?.whatsappToken?.configured
                  ? "Configurado"
                  : "Pendente"
              }
              supporting={
                admin.data?.whatsappToken?.source === "database"
                  ? "credencial mantida pelo painel"
                  : admin.data?.whatsappToken?.source === "environment"
                    ? "credencial definida no servidor"
                    : "nenhuma credencial ativa"
              }
              tone={
                admin.data?.whatsappToken?.configured ? "success" : "warning"
              }
            />
            <OperationalItem
              label="Casos para atenção nas últimas 24h"
              value={
                typeof admin.data?.usage.attentionCountLast24h === "number"
                  ? formatCountPtBr(admin.data.usage.attentionCountLast24h)
                  : "Indisponível"
              }
              supporting={
                typeof admin.data?.usage.attentionCountLast24h === "number"
                  ? "avisos e falhas com fonte administrativa"
                  : "a fonte de contagem não respondeu"
              }
              tone={
                typeof admin.data?.usage.attentionCountLast24h !== "number"
                  ? "neutral"
                  : admin.data.usage.attentionCountLast24h > 0
                    ? "warning"
                    : "success"
              }
            />
          </div>
        )}
      </section>
    </div>
  );
}

function UsersArea({
  admin,
  search,
  onSearchChange,
  profile,
  onProfileChange,
  lastAccess,
  onLastAccessChange,
}: {
  admin: { data?: any; isLoading: boolean; isError: boolean };
  search: string;
  onSearchChange: (value: string) => void;
  profile: UserProfile | "all";
  onProfileChange: (value: UserProfile | "all") => void;
  lastAccess: LastAccessFilter;
  onLastAccessChange: (value: LastAccessFilter) => void;
}) {
  const filteredUsers = useMemo(() => {
    const users = admin.data?.users ?? [];
    const normalizedSearch = search.trim().toLocaleLowerCase("pt-BR");
    const now = Date.now();
    const todayStart = new Date(
      new Date(now).getFullYear(),
      new Date(now).getMonth(),
      new Date(now).getDate()
    ).getTime();
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
    return users.filter((user: any) => {
      const userProfile = (user.profile ?? user.role) as UserProfile;
      const name = user.name ?? "";
      const email = user.email ?? user.openId ?? "";
      const matchesSearch =
        !normalizedSearch ||
        `${name} ${email}`
          .toLocaleLowerCase("pt-BR")
          .includes(normalizedSearch);
      const matchesProfile = profile === "all" || userProfile === profile;
      const lastSignedIn = new Date(user.lastSignedIn).getTime();
      let matchesAccess = true;
      if (lastAccess === "today") matchesAccess = lastSignedIn >= todayStart;
      if (lastAccess === "7d")
        matchesAccess =
          lastSignedIn >= sevenDaysAgo && lastSignedIn < todayStart;
      if (lastAccess === "30d")
        matchesAccess =
          lastSignedIn >= thirtyDaysAgo && lastSignedIn < sevenDaysAgo;
      if (lastAccess === "older") matchesAccess = lastSignedIn < thirtyDaysAgo;
      return matchesSearch && matchesProfile && matchesAccess;
    });
  }, [admin.data?.users, lastAccess, profile, search]);

  return (
    <section aria-labelledby="admin-users-heading" className="space-y-4">
      <div>
        <p className="text-sm font-medium text-primary">
          Diretório administrativo
        </p>
        <h2
          id="admin-users-heading"
          className="text-2xl font-semibold tracking-tight"
        >
          Usuários
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Busque e compare perfis sem percorrer cartões altos.
        </p>
      </div>
      <Card className="border-0 shadow-sm">
        <CardContent className="space-y-4 pt-6">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr),180px,210px]">
            <div className="space-y-2">
              <Label htmlFor="admin-user-search">
                Buscar por nome ou e-mail
              </Label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="admin-user-search"
                  className="pl-9"
                  value={search}
                  onChange={event => onSearchChange(event.target.value)}
                  placeholder="Ex.: Maria ou maria@example.com"
                />
              </div>
            </div>
            <FilterSelect
              id="admin-user-profile"
              label="Perfil"
              value={profile}
              onChange={value => onProfileChange(value as UserProfile | "all")}
              options={[
                { value: "all", label: "Todos" },
                { value: "admin", label: "Administrador" },
                { value: "professional", label: "Profissional" },
                { value: "user", label: "Usuário" },
              ]}
            />
            <FilterSelect
              id="admin-user-last-access"
              label="Último acesso"
              value={lastAccess}
              onChange={value => onLastAccessChange(value as LastAccessFilter)}
              options={[
                { value: "all", label: "Todos" },
                { value: "today", label: "Hoje" },
                { value: "7d", label: "Últimos 7 dias" },
                { value: "30d", label: "Últimos 30 dias" },
                { value: "older", label: "Há mais de 30 dias" },
              ]}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4 text-sm">
            <span className="font-medium text-foreground">
              {formatCountPtBr(filteredUsers.length)} usuários encontrados
            </span>
            <span className="text-muted-foreground">
              A busca usa a coleção completa disponibilizada pelo backend.
            </span>
          </div>
          {admin.isLoading ? (
            <LoadingState text="Carregando usuários..." />
          ) : admin.isError ? (
            <ErrorState text="Não foi possível carregar os usuários agora." />
          ) : filteredUsers.length ? (
            <UsersTable users={filteredUsers} />
          ) : (
            <FilteredEmptyState
              text={
                search || profile !== "all" || lastAccess !== "all"
                  ? "Nenhum usuário corresponde aos filtros atuais."
                  : "Ainda não há usuários disponíveis para consulta."
              }
              onClear={
                search || profile !== "all" || lastAccess !== "all"
                  ? () => {
                      onSearchChange("");
                      onProfileChange("all");
                      onLastAccessChange("all");
                    }
                  : undefined
              }
            />
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function UsersTable({ users }: { users: any[] }) {
  return (
    <div className="overflow-hidden rounded-2xl border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nome</TableHead>
            <TableHead>E-mail / identificador</TableHead>
            <TableHead>Perfil</TableHead>
            <TableHead className="text-right">Último acesso</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map(user => {
            const profile = (user.profile ?? user.role) as UserProfile;
            return (
              <TableRow key={user.id}>
                <TableCell className="whitespace-normal font-medium">
                  {user.name || "Usuário sem nome"}
                </TableCell>
                <TableCell className="max-w-[320px] whitespace-normal text-muted-foreground">
                  {user.email || user.openId || "Identificador indisponível"}
                </TableCell>
                <TableCell>
                  <Badge
                    variant={profile === "admin" ? "default" : "secondary"}
                  >
                    {USER_ROLE_LABELS[profile] ?? "Usuário"}
                  </Badge>
                </TableCell>
                <TableCell className="whitespace-nowrap text-right text-sm text-muted-foreground">
                  {new Date(user.lastSignedIn).toLocaleString("pt-BR")}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function ActivitiesArea({
  query,
  filters,
  actions,
  page,
}: {
  query: { data?: any; isLoading: boolean; isError: boolean };
  filters: {
    activitySearch: string;
    activityPeriod: ActivityPeriod;
    activityStatus: ActivityStatus;
    activityOrigin: ActivityOrigin;
    activityCategory: ActivityCategory;
  };
  actions: {
    setActivitySearch: (value: string) => void;
    setActivityPeriod: (value: ActivityPeriod) => void;
    setActivityStatus: (value: ActivityStatus) => void;
    setActivityOrigin: (value: ActivityOrigin) => void;
    setActivityCategory: (value: ActivityCategory) => void;
    setActivityPage: (value: number | ((page: number) => number)) => void;
  };
  page: number;
}) {
  const {
    activitySearch,
    activityPeriod,
    activityStatus,
    activityOrigin,
    activityCategory,
  } = filters;
  const data = query.data;
  const hasFilters = Boolean(
    activitySearch ||
      activityStatus !== "all" ||
      activityOrigin !== "all" ||
      activityCategory !== "all"
  );
  const clearFilters = () => {
    actions.setActivitySearch("");
    actions.setActivityPeriod("7d");
    actions.setActivityStatus("all");
    actions.setActivityOrigin("all");
    actions.setActivityCategory("all");
    actions.setActivityPage(1);
  };
  const currentPage = data?.page ?? page;
  const totalPages = data?.totalPages ?? 1;
  return (
    <section aria-labelledby="admin-activities-heading" className="space-y-4">
      <div>
        <p className="text-sm font-medium text-primary">
          Monitoramento administrativo
        </p>
        <h2
          id="admin-activities-heading"
          className="text-2xl font-semibold tracking-tight"
        >
          Atividades
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Consulte o conjunto persistido do período selecionado, com ordenação
          do evento mais recente para o mais antigo.
        </p>
      </div>
      <Card className="border-0 shadow-sm">
        <CardContent className="space-y-4 pt-6">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <div className="space-y-2 xl:col-span-2">
              <Label htmlFor="admin-activity-search">Buscar atividade</Label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="admin-activity-search"
                  className="pl-9"
                  value={activitySearch}
                  onChange={event =>
                    actions.setActivitySearch(event.target.value)
                  }
                  placeholder="Buscar no resumo administrativo"
                />
              </div>
            </div>
            <FilterSelect
              id="admin-activity-period"
              label="Período"
              value={activityPeriod}
              onChange={value =>
                actions.setActivityPeriod(value as ActivityPeriod)
              }
              options={Object.entries(ACTIVITY_PERIOD_LABELS).map(
                ([value, label]) => ({ value, label })
              )}
            />
            <FilterSelect
              id="admin-activity-status"
              label="Status"
              value={activityStatus}
              onChange={value =>
                actions.setActivityStatus(value as ActivityStatus)
              }
              options={ACTIVITY_STATUS_OPTIONS}
            />
            <FilterSelect
              id="admin-activity-origin"
              label="Origem"
              value={activityOrigin}
              onChange={value =>
                actions.setActivityOrigin(value as ActivityOrigin)
              }
              options={ACTIVITY_ORIGIN_OPTIONS}
            />
          </div>
          <div className="grid gap-3 md:grid-cols-[minmax(0,260px),1fr] md:items-end">
            <FilterSelect
              id="admin-activity-category"
              label="Tipo de evento"
              value={activityCategory}
              onChange={value =>
                actions.setActivityCategory(value as ActivityCategory)
              }
              options={ACTIVITY_CATEGORY_OPTIONS}
            />
            <div
              className="flex flex-wrap items-center gap-2"
              aria-label="Filtros ativos"
            >
              <Badge variant="secondary" className="gap-1">
                <ListFilter className="h-3.5 w-3.5" />
                {ACTIVITY_PERIOD_LABELS[activityPeriod]}
              </Badge>
              {activitySearch ? (
                <Badge variant="outline">Busca: {activitySearch}</Badge>
              ) : null}
              {activityStatus !== "all" ? (
                <Badge variant="outline">
                  Status: {labelFor(ACTIVITY_STATUS_OPTIONS, activityStatus)}
                </Badge>
              ) : null}
              {activityOrigin !== "all" ? (
                <Badge variant="outline">
                  Origem: {labelFor(ACTIVITY_ORIGIN_OPTIONS, activityOrigin)}
                </Badge>
              ) : null}
              {activityCategory !== "all" ? (
                <Badge variant="outline">
                  Tipo: {labelFor(ACTIVITY_CATEGORY_OPTIONS, activityCategory)}
                </Badge>
              ) : null}
              {hasFilters ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="gap-1"
                  onClick={clearFilters}
                >
                  <X className="h-3.5 w-3.5" />
                  Limpar filtros
                </Button>
              ) : null}
            </div>
          </div>
          {query.isLoading ? (
            <LoadingState text="Carregando atividades do período..." />
          ) : query.isError ? (
            <ErrorState text="Não foi possível consultar as atividades agora. Tente novamente em instantes." />
          ) : data?.source === "session" ? (
            <div className="rounded-2xl border border-amber-300/60 bg-amber-50/60 p-4 text-sm text-amber-900">
              <p className="font-medium">Histórico persistido indisponível</p>
              <p className="mt-1">
                A lista abaixo representa somente eventos disponíveis na sessão
                atual; o período não é apresentado como histórico completo.
              </p>
            </div>
          ) : null}
          {!query.isLoading && !query.isError && data && data.total === 0 ? (
            <FilteredEmptyState
              text={
                data.availableTotal > 0
                  ? "Nenhuma atividade corresponde aos filtros atuais."
                  : "Não há atividades registradas no período selecionado."
              }
              onClear={data.availableTotal > 0 ? clearFilters : undefined}
            />
          ) : null}
          {!query.isLoading && !query.isError && data?.items?.length ? (
            <>
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="font-medium text-foreground">
                  {formatCountPtBr(data.total)} registros encontrados
                </span>
                <span className="text-muted-foreground">
                  Escopo: {new Date(data.range.from).toLocaleString("pt-BR")} –{" "}
                  {new Date(data.range.to).toLocaleString("pt-BR")}
                </span>
              </div>
              <div className="divide-y rounded-2xl border">
                {data.items.map((log: any) => (
                  <ActivityRow key={log.id} log={log} />
                ))}
              </div>
              <div className="flex flex-col gap-3 rounded-2xl border bg-muted/20 p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
                <span className="text-muted-foreground">
                  Página {currentPage} de {totalPages}
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    disabled={currentPage <= 1}
                    onClick={() =>
                      actions.setActivityPage(Math.max(1, currentPage - 1))
                    }
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Anterior
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    disabled={currentPage >= totalPages}
                    onClick={() =>
                      actions.setActivityPage(
                        Math.min(totalPages, currentPage + 1)
                      )
                    }
                  >
                    Próxima
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          ) : null}
        </CardContent>
      </Card>
    </section>
  );
}

function ActivityRow({ log }: { log: any }) {
  return (
    <article className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium tracking-tight">
            {logEventLabel(log.eventType)}
          </p>
          <Badge
            className={
              log.status === "error"
                ? "bg-rose-100 text-rose-700 hover:bg-rose-100"
                : log.status === "warning"
                  ? "bg-amber-100 text-amber-700 hover:bg-amber-100"
                  : "bg-emerald-100 text-emerald-700 hover:bg-emerald-100"
            }
          >
            {LOG_STATUS_LABELS[log.status] ?? "Registrado"}
          </Badge>
        </div>
        <LogSummary detail={log.detail} />
        <p className="mt-2 text-xs text-muted-foreground">
          {new Date(log.createdAt).toLocaleString("pt-BR")} ·{" "}
          {LOG_ORIGIN_LABELS[log.origin] ?? "Sistema"}
        </p>
        <LogDetail detail={log.detail} />
      </div>
    </article>
  );
}

function SettingsArea({
  tokenStatus,
  accessToken,
  isOpen,
  canSaveToken,
  isSaving,
  onOpen,
  onCancel,
  onAccessTokenChange,
  onSave,
}: {
  tokenStatus?: {
    configured: boolean;
    source: string;
    maskedValue: string | null;
  };
  accessToken: string;
  isOpen: boolean;
  canSaveToken: boolean;
  isSaving: boolean;
  onOpen: () => void;
  onCancel: () => void;
  onAccessTokenChange: (value: string) => void;
  onSave: () => void;
}) {
  return (
    <section aria-labelledby="admin-settings-heading" className="space-y-4">
      <div>
        <p className="text-sm font-medium text-primary">
          Segurança e integrações
        </p>
        <h2
          id="admin-settings-heading"
          className="text-2xl font-semibold tracking-tight"
        >
          Configurações
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Altere a credencial somente quando necessário; o valor atual nunca é
          carregado no formulário.
        </p>
      </div>
      <Card className="max-w-4xl border-0 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-primary" />
            Credencial do WhatsApp
          </CardTitle>
          <CardDescription>
            O segredo permanece protegido no backend e aparece apenas de forma
            mascarada nesta tela.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <StatusPill
              label="Configuração"
              value={tokenStatus?.configured ? "Configurado" : "Pendente"}
              tone={tokenStatus?.configured ? "success" : "warning"}
            />
            <StatusPill
              label="Origem"
              value={
                tokenStatus?.source === "database"
                  ? "Painel administrativo"
                  : tokenStatus?.source === "environment"
                    ? "Configuração do servidor"
                    : "Não configurada"
              }
              tone={
                tokenStatus?.source === "database"
                  ? "success"
                  : tokenStatus?.source === "environment"
                    ? "neutral"
                    : "warning"
              }
            />
            <StatusPill
              label="Valor mascarado"
              value={tokenStatus?.maskedValue || "Ainda não salva"}
              tone="neutral"
              mono
            />
          </div>
          {!isOpen ? (
            <div className="flex flex-col gap-3 rounded-2xl border bg-muted/20 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-medium text-foreground">
                  Substituição recolhida
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Abra o formulário apenas para informar uma nova credencial.
                </p>
              </div>
              <Button className="gap-2" onClick={onOpen}>
                <KeyRound className="h-4 w-4" />
                Substituir credencial
              </Button>
            </div>
          ) : (
            <div className="space-y-4 rounded-2xl border border-primary/20 bg-primary/[0.03] p-4">
              <div className="space-y-2">
                <Label htmlFor="admin-whatsapp-access-token">
                  Nova chave de acesso do WhatsApp
                </Label>
                <Input
                  id="admin-whatsapp-access-token"
                  type="password"
                  autoComplete="new-password"
                  value={accessToken}
                  onChange={event => onAccessTokenChange(event.target.value)}
                  placeholder="Cole aqui a nova chave de acesso"
                />
                <p className="text-sm leading-6 text-muted-foreground">
                  O valor fica protegido no campo e não é exibido em mensagens
                  ou textos de confirmação.
                </p>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <Button type="button" variant="ghost" onClick={onCancel}>
                  Cancelar
                </Button>
                <Button
                  type="button"
                  className="gap-2"
                  disabled={!canSaveToken}
                  onClick={onSave}
                >
                  <Save className="h-4 w-4" />
                  {isSaving ? "Salvando..." : "Salvar credencial"}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function FoodsArea({
  foodCatalogItems,
  globalFoodCount,
  customFoodCount,
  inactiveFoodCount,
  foodImportReport,
  foodImportJob,
  foodImportFile,
  foodImportSourceVersion,
  foodCatalogQuery,
  foodCatalog,
  paginatedFoodCatalogItems,
  foodCatalogPage,
  foodCatalogTotalPages,
  foodCatalogPageStart,
  foodCatalogPageEnd,
  runFoodImportJob,
  onFoodImportJobChange,
  onFoodImportFileChange,
  onFoodImportSourceVersionChange,
  onFoodCatalogQueryChange,
  onFoodCatalogPageChange,
  onRunCsvImport,
}: any) {
  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-medium text-primary">Catálogo e revisão</p>
        <h2 className="text-2xl font-semibold tracking-tight">
          Base de alimentos
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Importação, revisão, busca e paginação permanecem disponíveis nesta
          área.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <IntroStat
          label="Itens carregados"
          value={formatCountPtBr(foodCatalogItems.length)}
          supporting="resultado atual da consulta"
        />
        <IntroStat
          label="Compartilhados"
          value={formatCountPtBr(globalFoodCount)}
          supporting="itens disponíveis para todos os usuários"
        />
        <IntroStat
          label="Personalizados / indisponíveis"
          value={`${formatCountPtBr(customFoodCount)} / ${formatCountPtBr(inactiveFoodCount)}`}
          supporting="itens do usuário / itens não disponíveis"
        />
      </div>
      <Card className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5 text-primary" />
            Atualização da base alimentar
          </CardTitle>
          <CardDescription>
            Carregue a base inicial ou importe arquivos CSV das fontes TACO e
            TBCA. A mesma fonte, versão e código podem ser processados novamente
            sem duplicar os registros.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,0.8fr),minmax(0,1.2fr)]">
            <div className="space-y-3 rounded-2xl border bg-muted/20 p-4">
              <div className="space-y-1">
                <p className="font-medium tracking-tight">
                  Base inicial do Brasil
                </p>
                <p className="text-sm leading-6 text-muted-foreground">
                  Carrega o conjunto inicial de alimentos brasileiros mantido
                  pelo sistema.
                </p>
              </div>
              <Button
                className="gap-2"
                disabled={runFoodImportJob.isPending}
                onClick={() =>
                  runFoodImportJob.mutate({ job: "seed_common_br" })
                }
              >
                <PlayCircle className="h-4 w-4" />
                {runFoodImportJob.isPending
                  ? "Carregando..."
                  : "Carregar base inicial"}
              </Button>
            </div>
            <div className="space-y-4 rounded-2xl border bg-muted/20 p-4">
              <div className="grid gap-3 lg:grid-cols-[180px,1fr,220px]">
                <div className="space-y-2">
                  <Label htmlFor="admin-food-import-job">Fonte</Label>
                  <select
                    id="admin-food-import-job"
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={foodImportJob}
                    onChange={event =>
                      onFoodImportJobChange(event.target.value as FoodImportJob)
                    }
                  >
                    <option value="import_taco">TACO</option>
                    <option value="import_tbca">TBCA</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="admin-food-import-file">Arquivo CSV</Label>
                  <Input
                    id="admin-food-import-file"
                    type="file"
                    accept=".csv,text/csv"
                    onChange={event =>
                      onFoodImportFileChange(event.target.files?.[0] ?? null)
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="admin-food-import-version">
                    Versão da fonte
                  </Label>
                  <Input
                    id="admin-food-import-version"
                    value={foodImportSourceVersion}
                    onChange={event =>
                      onFoodImportSourceVersionChange(event.target.value)
                    }
                    placeholder="ex.: 2026-07"
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">
                  {foodImportFile
                    ? `Selecionado: ${foodImportFile.name}`
                    : "Escolha o arquivo que deseja importar."}
                </p>
                <Button
                  variant="outline"
                  className="gap-2"
                  disabled={runFoodImportJob.isPending || !foodImportFile}
                  onClick={onRunCsvImport}
                >
                  <Upload className="h-4 w-4" />
                  {runFoodImportJob.isPending
                    ? "Importando..."
                    : "Importar arquivo"}
                </Button>
              </div>
            </div>
          </div>
          {foodImportReport ? (
            <FoodImportReportSummary report={foodImportReport} />
          ) : null}
        </CardContent>
      </Card>
      <NutritionLabelCandidateReview />
      <Card className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5 text-primary" />
            Base de alimentos usada pelo sistema
          </CardTitle>
          <CardDescription>
            Consulte alimentos compartilhados, personalizados e indisponíveis
            usados nas buscas nutricionais. A consulta carrega até 500 itens e
            exibe 25 por página.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              value={foodCatalogQuery}
              onChange={event => onFoodCatalogQueryChange(event.target.value)}
              placeholder="Buscar na base: arroz, requeijão, catupiry..."
            />
          </div>
          {foodCatalog.isLoading ? (
            <LoadingState text="Carregando base de alimentos..." />
          ) : foodCatalog.isError ? (
            <ErrorState text="Não foi possível consultar a base de alimentos agora." />
          ) : foodCatalogItems.length ? (
            <div className="space-y-4">
              <FoodCatalogTable foods={paginatedFoodCatalogItems} />
              <div className="flex flex-col gap-3 rounded-2xl border bg-muted/20 p-4 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                <p>
                  Exibindo {formatCountPtBr(foodCatalogPageStart)}-
                  {formatCountPtBr(foodCatalogPageEnd)} de{" "}
                  {formatCountPtBr(foodCatalogItems.length)} itens carregados.
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    disabled={foodCatalogPage <= 1}
                    onClick={() =>
                      onFoodCatalogPageChange(Math.max(1, foodCatalogPage - 1))
                    }
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Anterior
                  </Button>
                  <span className="min-w-[120px] text-center font-medium text-foreground">
                    Página {foodCatalogPage} de {foodCatalogTotalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    disabled={foodCatalogPage >= foodCatalogTotalPages}
                    onClick={() =>
                      onFoodCatalogPageChange(
                        Math.min(foodCatalogTotalPages, foodCatalogPage + 1)
                      )
                    }
                  >
                    Próxima
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <FilteredEmptyState text="Nenhum alimento encontrado nesta consulta." />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function NutritionLabelCandidateReview() {
  const candidateEndpoint = (
    trpc.nutrition.admin as unknown as {
      nutritionLabelCandidates?: { useQuery?: unknown };
    }
  ).nutritionLabelCandidates;
  if (!candidateEndpoint?.useQuery) return null;
  const utils = trpc.useUtils();
  const candidates = trpc.nutrition.admin.nutritionLabelCandidates.useQuery(
    undefined,
    { retry: false }
  );
  const refresh = async () =>
    Promise.all([
      utils.nutrition.admin.nutritionLabelCandidates.invalidate(),
      utils.nutrition.foods.catalogSearch.invalidate(),
    ]);
  const publish =
    trpc.nutrition.admin.publishNutritionLabelCandidate.useMutation({
      onSuccess: async () => {
        toast.success("Candidato publicado no catálogo global.");
        await refresh();
      },
      onError: () => toast.error("Não foi possível publicar o candidato agora."),
    });
  const reject = trpc.nutrition.admin.rejectNutritionLabelCandidate.useMutation(
    {
      onSuccess: async () => {
        toast.success("Candidato rejeitado.");
        await refresh();
      },
      onError: () => toast.error("Não foi possível rejeitar o candidato agora."),
    }
  );
  const requestPhoto =
    trpc.nutrition.admin.requestNutritionLabelCandidatePhoto.useMutation({
      onSuccess: async () => {
        toast.success("Pedido de nova foto enviado pelo WhatsApp.");
        await refresh();
      },
      onError: () => toast.error("Não foi possível solicitar uma nova foto agora."),
    });
  const rollback =
    trpc.nutrition.admin.rollbackNutritionLabelCandidate.useMutation({
      onSuccess: async () => {
        toast.success("Publicação desativada por rollback.");
        await refresh();
      },
      onError: () => toast.error("Não foi possível reverter a publicação agora."),
    });
  const busy =
    publish.isPending ||
    reject.isPending ||
    requestPhoto.isPending ||
    rollback.isPending;
  return (
    <Card className="border-0 shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-primary" />
          Revisão de rótulos nutricionais
        </CardTitle>
        <CardDescription>
          Valores extraídos de rótulos entram como candidatos. Publique apenas
          após revisar identidade, porção, macros e evidência.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {candidates.isLoading ? (
          <LoadingState text="Carregando candidatos..." />
        ) : candidates.data?.length ? (
          <div className="space-y-3">
            {candidates.data.map((candidate: any) => (
              <div
                key={candidate.id}
                className="rounded-2xl border bg-background p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{candidate.foodName}</p>
                      <Badge
                        variant={
                          candidate.status === "published"
                            ? "default"
                            : "outline"
                        }
                      >
                        {nutritionLabelCandidateStatusLabel(candidate.status)}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {candidate.brand || "sem marca"}
                      {candidate.productVariant
                        ? ` · ${candidate.productVariant}`
                        : ""}{" "}
                      · {candidate.servingLabel}
                    </p>
                    <p className="mt-1 text-sm">
                      {formatNutritionValue(candidate.calories)} kcal · P{" "}
                      {formatNutritionValue(candidate.protein)}g · C{" "}
                      {formatNutritionValue(candidate.carbs)}g · G{" "}
                      {formatNutritionValue(candidate.fat)}g
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {candidate.sourceEvidence}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {candidate.status !== "published" &&
                    candidate.status !== "rejected" &&
                    candidate.status !== "rolled_back" ? (
                      <>
                        <Button
                          size="sm"
                          className="gap-1"
                          disabled={busy}
                          onClick={() =>
                            publish.mutate({ candidateId: candidate.id })
                          }
                        >
                          <Check className="h-3 w-3" />
                          Publicar
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1"
                          disabled={busy}
                          onClick={() =>
                            requestPhoto.mutate({ candidateId: candidate.id })
                          }
                        >
                          <Camera className="h-3 w-3" />
                          Nova foto
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1"
                          disabled={busy}
                          onClick={() =>
                            reject.mutate({ candidateId: candidate.id })
                          }
                        >
                          <X className="h-3 w-3" />
                          Rejeitar
                        </Button>
                      </>
                    ) : null}
                    {candidate.status === "published" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1"
                        disabled={busy}
                        onClick={() =>
                          rollback.mutate({ candidateId: candidate.id })
                        }
                      >
                        <RotateCcw className="h-3 w-3" />
                        Rollback
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Nenhum candidato de rótulo na fila.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function FilterSelect({
  id,
  label,
  value,
  onChange,
  options,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        value={value}
        onChange={event => onChange(event.target.value)}
      >
        {options.map(option => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function labelFor(
  options: Array<{ value: string; label: string }>,
  value: string
) {
  return options.find(option => option.value === value)?.label ?? value;
}

function LoadingState({ text }: { text: string }) {
  return (
    <div
      role="status"
      className="rounded-2xl border border-dashed bg-muted/20 p-6 text-sm text-muted-foreground"
    >
      {text}
    </div>
  );
}

function ErrorState({ text }: { text: string }) {
  return (
    <div
      role="alert"
      className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6 text-sm text-destructive"
    >
      {text}
    </div>
  );
}

function FilteredEmptyState({
  text,
  onClear,
}: {
  text: string;
  onClear?: () => void;
}) {
  return (
    <div className="rounded-2xl border border-dashed bg-muted/20 p-6 text-sm text-muted-foreground">
      <p>{text}</p>
      {onClear ? (
        <Button
          variant="outline"
          size="sm"
          className="mt-3 gap-2"
          onClick={onClear}
        >
          <Filter className="h-3.5 w-3.5" />
          Limpar filtros
        </Button>
      ) : null}
    </div>
  );
}

function OperationalItem({
  label,
  value,
  supporting,
  tone,
}: {
  label: string;
  value: string;
  supporting: string;
  tone: "success" | "warning" | "neutral";
}) {
  const icon =
    tone === "warning" ? (
      <AlertTriangle className="h-4 w-4" />
    ) : tone === "success" ? (
      <Check className="h-4 w-4" />
    ) : (
      <Settings className="h-4 w-4" />
    );
  return (
    <div className="rounded-2xl border bg-background p-4">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        {icon}
        {label}
      </div>
      <p className="mt-3 text-xl font-semibold tracking-tight">{value}</p>
      <p className="mt-1 text-sm text-muted-foreground">{supporting}</p>
    </div>
  );
}

function IntroStat({
  label,
  value,
  supporting,
}: {
  label: string;
  value: string;
  supporting: string;
}) {
  return (
    <div className="rounded-2xl border border-border/70 bg-background px-4 py-3">
      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-2 text-xl font-semibold tracking-tight text-foreground">
        {value}
      </p>
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
      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </p>
      <p
        className={`mt-2 inline-flex max-w-full rounded-full px-3 py-1 text-sm font-medium ${toneClassName} ${mono ? "break-all font-mono text-xs sm:text-sm" : ""}`}
      >
        {value}
      </p>
    </div>
  );
}

function FoodImportReportSummary({ report }: { report: FoodImportReport }) {
  return (
    <div className="rounded-2xl border bg-background p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-medium tracking-tight">
            Fonte {report.sourceSlug.toUpperCase()} · versão{" "}
            {report.sourceVersion}
          </p>
          <p className="text-sm text-muted-foreground">
            {formatCountPtBr(report.inserted)} inseridos ·{" "}
            {formatCountPtBr(report.updated)} atualizados ·{" "}
            {formatCountPtBr(report.ignored)} ignorados ·{" "}
            {formatCountPtBr(report.aliasesInserted)} nomes alternativos ·{" "}
            {formatCountPtBr(report.portionsInserted)} porções
          </p>
        </div>
        <Badge variant={report.errors.length ? "secondary" : "outline"}>
          {report.errors.length ? "Com alertas" : "Concluído"}
        </Badge>
      </div>
      {report.possibleDuplicates.length ? (
        <p className="mt-3 text-sm text-amber-700">
          {formatCountPtBr(report.possibleDuplicates.length)} possíveis
          duplicidades encontradas para revisão.
        </p>
      ) : null}
      {report.errors.length ? (
        <div className="mt-3 rounded-xl bg-destructive/5 p-3 text-sm text-destructive">
          <p className="font-medium">Erros ou itens ignorados</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {report.errors.slice(0, 5).map((error, index) => (
              <li
                key={`${error.sourceFoodCode ?? error.name ?? "erro"}-${index}`}
              >
                {error.sourceFoodCode || error.name || "Item"}: {error.reason}
              </li>
            ))}
          </ul>
          {report.errors.length > 5 ? (
            <p className="mt-2">
              Há mais erros no relatório completo do processamento.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function FoodCatalogTable({ foods }: { foods: FoodCatalogItem[] }) {
  return (
    <div className="overflow-x-auto rounded-2xl border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-[260px]">Alimento</TableHead>
            <TableHead>Origem</TableHead>
            <TableHead>Situação</TableHead>
            <TableHead>Nutrientes / 100g</TableHead>
            <TableHead>Uso</TableHead>
            <TableHead className="text-right">ID</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {foods.map(food => (
            <TableRow key={food.id}>
              <TableCell className="whitespace-normal align-top">
                <div className="space-y-2">
                  <p className="font-medium leading-snug text-foreground">
                    {food.name}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {food.brandName ? (
                      <Badge variant="secondary">{food.brandName}</Badge>
                    ) : null}
                    {food.category ? (
                      <Badge variant="outline">{food.category}</Badge>
                    ) : null}
                  </div>
                </div>
              </TableCell>
              <TableCell className="max-w-[240px] whitespace-normal align-top text-sm text-muted-foreground">
                <p className="font-medium text-foreground">
                  {food.source?.name || food.source?.slug || "Cadastro manual"}
                </p>
                {food.source?.foodCode ? (
                  <p className="text-xs">Código: {food.source.foodCode}</p>
                ) : null}
                {food.source?.version ? (
                  <p className="text-xs">Versão: {food.source.version}</p>
                ) : null}
              </TableCell>
              <TableCell className="align-top">
                <div className="flex flex-wrap gap-1.5">
                  <Badge
                    variant={food.scope === "global" ? "default" : "secondary"}
                  >
                    {food.scope === "global"
                      ? "Compartilhado"
                      : "Personalizado"}
                  </Badge>
                  <Badge
                    variant={food.status === "active" ? "outline" : "secondary"}
                  >
                    {formatFoodStatus(food.status)}
                  </Badge>
                </div>
              </TableCell>
              <TableCell className="align-top text-sm">
                <p>
                  {formatNutritionValue(food.nutrientsPer100g.caloriesKcal)}{" "}
                  kcal
                </p>
                <p className="text-xs text-muted-foreground">
                  P {formatNutritionValue(food.nutrientsPer100g.proteinGrams)}g
                  · C {formatNutritionValue(food.nutrientsPer100g.carbsGrams)}g
                  · G {formatNutritionValue(food.nutrientsPer100g.fatGrams)}g
                </p>
                <p className="text-xs text-muted-foreground">
                  Fibra{" "}
                  {formatNullableNutritionValue(
                    food.nutrientsPer100g.fiberGrams
                  )}
                  g · Sódio{" "}
                  {formatNullableNutritionValue(food.nutrientsPer100g.sodiumMg)}
                  mg
                </p>
              </TableCell>
              <TableCell className="align-top text-sm text-muted-foreground">
                <p>
                  {food.userSignals.usageCount
                    ? `${formatCountPtBr(food.userSignals.usageCount)} usos`
                    : "Sem uso recente"}
                </p>
                {food.userSignals.favorite ? (
                  <p className="text-xs text-foreground">Favorito</p>
                ) : null}
                {food.userSignals.lastUsedAt ? (
                  <p className="text-xs">
                    Último uso:{" "}
                    {new Date(food.userSignals.lastUsedAt).toLocaleDateString(
                      "pt-BR"
                    )}
                  </p>
                ) : null}
              </TableCell>
              <TableCell className="text-right align-top font-mono text-xs text-muted-foreground">
                #{food.id}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function LogDetail({ detail }: { detail: string }) {
  const trimmed = detail.trim();
  const isTechnicalPayload = trimmed.startsWith("{") || trimmed.startsWith("[");
  if (!isTechnicalPayload) return null;
  return (
    <details className="mt-2 text-sm text-muted-foreground">
      <summary className="w-fit cursor-pointer font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        Ver detalhes técnicos
      </summary>
      <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-muted/40 p-3 text-xs">
        {detail}
      </pre>
    </details>
  );
}

function LogSummary({ detail }: { detail: string }) {
  const trimmed = detail.trim();
  const isTechnicalPayload = trimmed.startsWith("{") || trimmed.startsWith("[");
  return isTechnicalPayload ? (
    <p className="mt-1 text-sm text-muted-foreground">
      Detalhes técnicos disponíveis para expansão.
    </p>
  ) : (
    <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
  );
}

function roleLabel(role: string) {
  return USER_ROLE_LABELS[role as UserProfile] ?? "Usuário";
}

function logEventLabel(eventType: string) {
  const exact = LOG_EVENT_LABELS[eventType];
  if (exact) return exact;
  if (eventType.startsWith("whatsapp.")) return "Evento do WhatsApp";
  if (eventType.startsWith("quick_edit.")) return "Edição rápida";
  if (eventType.startsWith("ai.") || eventType.includes("inference"))
    return "Análise por inteligência artificial";
  if (eventType.startsWith("meal.")) return "Registro de refeição";
  if (eventType.startsWith("water.")) return "Registro de água";
  if (eventType.startsWith("exercise.")) return "Registro de exercício";
  if (eventType.startsWith("foods.")) return "Base alimentar";
  return "Evento do sistema";
}

function nutritionLabelCandidateStatusLabel(status: string) {
  return (
    (
      {
        pending_review: "Pendente de revisão",
        photo_requested: "Foto solicitada",
        published: "Publicado",
        rejected: "Rejeitado",
        rolled_back: "Em rollback",
      } as Record<string, string>
    )[status] ?? status
  );
}

function formatFoodStatus(status: FoodCatalogItem["status"]) {
  if (status === "active") return "Disponível";
  if (status === "deprecated") return "Indisponível";
  return "Mesclado";
}

function formatNutritionValue(value: number) {
  return Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 1 });
}

function formatNullableNutritionValue(value: number | null) {
  return value == null ? "-" : formatNutritionValue(value);
}
