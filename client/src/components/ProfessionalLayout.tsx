import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import {
  parseProfessionalPatientRoute,
  professionalPatientResourceForRoute,
} from "@/lib/professionalRoutes";
import { trpc } from "@/lib/trpc";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  BarChart3,
  BriefcaseMedical,
  ChevronLeft,
  LayoutDashboard,
  MessageSquareText,
  RefreshCw,
  Settings,
  UsersRound,
} from "lucide-react";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation } from "wouter";
import { DashboardLayoutSkeleton } from "./DashboardLayoutSkeleton";

export type ProfessionalPatientContext = {
  patientId: number;
  displayName: string;
  trackingStatus: "not_started" | "active" | "paused" | "ended";
};

type ProfessionalWorkspaceContextValue = {
  selectedPatient: ProfessionalPatientContext | null;
  clearPatient: () => void;
};

const ProfessionalWorkspaceContext =
  createContext<ProfessionalWorkspaceContextValue | null>(null);

export function useProfessionalWorkspace() {
  const context = useContext(ProfessionalWorkspaceContext);
  if (!context) {
    throw new Error(
      "useProfessionalWorkspace must be used inside ProfessionalLayout"
    );
  }
  return context;
}

const professionalNavigation = [
  { label: "Início", path: "/professional", icon: LayoutDashboard },
  { label: "Pacientes", path: "/professional/patients", icon: UsersRound },
  {
    label: "Mensagens",
    path: "/professional/messages",
    icon: MessageSquareText,
  },
  { label: "Relatórios", path: "/professional/reports", icon: BarChart3 },
  { label: "Configurações", path: "/professional/settings", icon: Settings },
];

const professionalPatientQueryPaths = new Set([
  "nutrition.professionals.patientTimeZone",
  "nutrition.professionals.patientDashboard",
  "nutrition.professionals.patientPeriodBundle",
  "professionalRecord.context",
  "professionalRecord.get",
  "professionalRecord.messages.list",
  "professionalRecord.operationalAlerts.list",
  "professionalRecord.ai.priorities",
  "professionalRecord.officialGoal.professionalState",
]);

export function isProfessionalPatientQueryKey(queryKey: readonly unknown[]) {
  const path = queryKey[0];
  return (
    Array.isArray(path) &&
    path.every(item => typeof item === "string") &&
    professionalPatientQueryPaths.has(path.join("."))
  );
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return "";
}

export function isProfessionalPatientAccessUnavailableError(error: unknown) {
  const message = errorMessage(error).toLocaleLowerCase("pt-BR");
  return [
    "o acesso a este paciente não está mais disponível",
    "acesso profissional não autorizado",
    "não autorizado pela pessoa acompanhada",
    "autorização do paciente foi revogada",
    "patient access unavailable",
  ].some(fragment => message.includes(fragment));
}

function pathnameFromLocation(location: string) {
  return location.split(/[?#]/, 1)[0].replace(/\/+$/, "") || "/";
}

function isActiveRoute(location: string, path: string) {
  const pathname = pathnameFromLocation(location);
  if (path === "/professional") return pathname === path;
  return pathname === path || pathname.startsWith(`${path}/`);
}

function routeTitle(location: string) {
  const patientRoute = parseProfessionalPatientRoute(location);
  if (patientRoute.kind === "patient") {
    const titles = {
      record: "Prontuário",
      assessment: "Avaliação",
      goals: "Metas",
      guidance: "Orientações",
      notes: "Anotações",
      history: "Histórico",
      reports: "Relatórios",
      messages: "Mensagens",
    } as const;
    return titles[patientRoute.section];
  }

  return (
    professionalNavigation.find(item => isActiveRoute(location, item.path))
      ?.label ?? "Área Profissional"
  );
}

function ProtectedState({
  description,
  onRetry,
  title,
}: {
  description: string;
  onRetry?: () => void;
  title: string;
}) {
  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center p-6">
      <div
        role="alert"
        className="w-full max-w-lg rounded-3xl border bg-card p-8 text-center shadow-sm"
      >
        <AlertTriangle className="mx-auto h-10 w-10 text-destructive" />
        <h1 className="mt-4 text-xl font-semibold">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {description}
        </p>
        {onRetry ? (
          <Button className="mt-6" onClick={onRetry}>
            <RefreshCw className="h-4 w-4" />
            Tentar novamente
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export default function ProfessionalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { loading: authLoading, refresh: refreshAuth, user } = useAuth();
  const [location, setLocation] = useLocation();
  const utils = trpc.useUtils();
  const queryClient = useQueryClient();
  const mainRef = useRef<HTMLElement | null>(null);
  const previousPatientIdRef = useRef<number | null>(null);
  const transitionGenerationRef = useRef(0);
  const revocationInProgressRef = useRef(false);
  const [readyPatientId, setReadyPatientId] = useState<number | null>(null);

  const patientRoute = useMemo(
    () => parseProfessionalPatientRoute(location),
    [location]
  );
  const routePatientId =
    patientRoute.kind === "patient" ? patientRoute.patientId : null;
  const patientResource = professionalPatientResourceForRoute(patientRoute);

  const profile = trpc.nutrition.professionals.profile.useQuery(undefined, {
    enabled: Boolean(user),
    retry: false,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
  });
  const hasActiveProfile = Boolean(
    user?.professionalProfileActive && profile.data?.active
  );
  const contextInput = routePatientId && patientResource
    ? { patientId: routePatientId, resource: patientResource }
    : { patientId: 1, resource: "professional_record" as const };
  const patientContext = trpc.professionalRecord.context.useQuery(contextInput, {
    enabled: Boolean(hasActiveProfile && routePatientId && patientResource),
    retry: false,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
  });

  const profileValidated = Boolean(
    profile.isSuccess && profile.isFetchedAfterMount && !profile.isFetching
  );
  const patientContextValidated = Boolean(
    routePatientId &&
      patientContext.isSuccess &&
      patientContext.isFetchedAfterMount &&
      !patientContext.isFetching &&
      patientContext.data?.patientId === routePatientId
  );

  const selectedPatient = useMemo<ProfessionalPatientContext | null>(() => {
    if (
      !hasActiveProfile ||
      !routePatientId ||
      !patientContextValidated ||
      readyPatientId !== routePatientId ||
      !patientContext.data
    ) {
      return null;
    }
    return {
      patientId: patientContext.data.patientId,
      displayName: patientContext.data.displayName,
      trackingStatus: patientContext.data.trackingStatus,
    };
  }, [
    hasActiveProfile,
    patientContext.data,
    patientContextValidated,
    readyPatientId,
    routePatientId,
  ]);

  const clearPatientQueries = useCallback(async () => {
    await Promise.all([
      utils.nutrition.professionals.patientTimeZone.cancel(),
      utils.nutrition.professionals.patientDashboard.cancel(),
      utils.nutrition.professionals.patientPeriodBundle.cancel(),
      utils.professionalRecord.context.cancel(),
      utils.professionalRecord.get.cancel(),
      utils.professionalRecord.messages.list.cancel(),
      utils.professionalRecord.operationalAlerts.list.cancel(),
      utils.professionalRecord.ai.priorities.cancel(),
      utils.professionalRecord.officialGoal.professionalState.cancel(),
    ]);
    queryClient.removeQueries({
      predicate: query => isProfessionalPatientQueryKey(query.queryKey),
    });
  }, [queryClient, utils]);

  const invalidatePatientContext = useCallback(() => {
    transitionGenerationRef.current += 1;
    setReadyPatientId(null);
  }, []);

  const revokePatientContext = useCallback(() => {
    if (revocationInProgressRef.current) return;
    revocationInProgressRef.current = true;
    invalidatePatientContext();
    void clearPatientQueries().finally(() => {
      previousPatientIdRef.current = null;
      setLocation("/professional/patients?notice=patient-access-unavailable");
      revocationInProgressRef.current = false;
    });
  }, [clearPatientQueries, invalidatePatientContext, setLocation]);

  const clearPatient = useCallback(() => {
    invalidatePatientContext();
    if (routePatientId ?? previousPatientIdRef.current) {
      void clearPatientQueries();
    }
    if (patientRoute.kind !== "none") {
      setLocation("/professional/patients");
    }
  }, [
    clearPatientQueries,
    invalidatePatientContext,
    patientRoute.kind,
    routePatientId,
    setLocation,
  ]);

  useEffect(() => {
    if (!routePatientId) return;
    const handleError = (error: unknown) => {
      if (isProfessionalPatientAccessUnavailableError(error)) {
        revokePatientContext();
      }
    };
    const unsubscribeQueries = queryClient.getQueryCache().subscribe(event => {
      if (event.type === "updated") handleError(event.query.state.error);
    });
    const unsubscribeMutations = queryClient
      .getMutationCache()
      .subscribe(event => {
        if (event.type === "updated") handleError(event.mutation.state.error);
      });
    return () => {
      unsubscribeQueries();
      unsubscribeMutations();
    };
  }, [queryClient, revokePatientContext, routePatientId]);

  useEffect(() => {
    const refreshAccess = () => {
      invalidatePatientContext();
      void Promise.all([
        refreshAuth(),
        profile.refetch(),
        routePatientId && hasActiveProfile
          ? patientContext.refetch()
          : Promise.resolve(),
      ]);
    };
    window.addEventListener("focus", refreshAccess);
    return () => window.removeEventListener("focus", refreshAccess);
  }, [
    hasActiveProfile,
    invalidatePatientContext,
    patientContext,
    profile,
    refreshAuth,
    routePatientId,
  ]);

  useEffect(() => {
    const generation = transitionGenerationRef.current + 1;
    transitionGenerationRef.current = generation;
    const previousPatientId = previousPatientIdRef.current;
    previousPatientIdRef.current = routePatientId;
    setReadyPatientId(null);

    if (!routePatientId) {
      if (previousPatientId) void clearPatientQueries();
      return;
    }

    const preparePatientContext = async () => {
      if (previousPatientId && previousPatientId !== routePatientId) {
        await clearPatientQueries();
      }
      if (
        patientContextValidated &&
        transitionGenerationRef.current === generation &&
        previousPatientIdRef.current === routePatientId
      ) {
        setReadyPatientId(routePatientId);
      }
    };

    void preparePatientContext();
  }, [
    clearPatientQueries,
    patientContextValidated,
    patientResource,
    routePatientId,
  ]);

  useEffect(() => {
    if (
      routePatientId &&
      patientContext.isError &&
      isProfessionalPatientAccessUnavailableError(patientContext.error)
    ) {
      revokePatientContext();
    }
  }, [
    patientContext.error,
    patientContext.isError,
    revokePatientContext,
    routePatientId,
  ]);

  useEffect(() => {
    if (routePatientId && profileValidated && !hasActiveProfile) {
      invalidatePatientContext();
      void clearPatientQueries();
    }
  }, [
    clearPatientQueries,
    hasActiveProfile,
    invalidatePatientContext,
    profileValidated,
    routePatientId,
  ]);

  useEffect(() => {
    document.title = `${routeTitle(location)} | Área Profissional`;
    mainRef.current?.focus({ preventScroll: true });
  }, [location]);

  useEffect(
    () => () => {
      transitionGenerationRef.current += 1;
      if (previousPatientIdRef.current) void clearPatientQueries();
      previousPatientIdRef.current = null;
    },
    [clearPatientQueries]
  );

  const contextValue = useMemo(
    () => ({ selectedPatient, clearPatient }),
    [clearPatient, selectedPatient]
  );

  if (authLoading || (user && !profileValidated && !profile.isError)) {
    return <DashboardLayoutSkeleton />;
  }

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="max-w-md rounded-3xl border bg-card p-8 text-center shadow-sm">
          <h1 className="text-xl font-semibold">Sessão necessária</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Entre novamente para acessar a Área Profissional.
          </p>
        </div>
      </div>
    );
  }

  if (profile.isError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div
          role="alert"
          className="max-w-lg rounded-3xl border bg-card p-8 text-center shadow-sm"
        >
          <AlertTriangle className="mx-auto h-10 w-10 text-destructive" />
          <h1 className="mt-4 text-xl font-semibold">
            Não foi possível confirmar seu acesso
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Verifique sua conexão e tente novamente. Nenhum dado profissional foi
            exibido.
          </p>
          <Button className="mt-6" onClick={() => void profile.refetch()}>
            <RefreshCw className="h-4 w-4" />
            Tentar novamente
          </Button>
        </div>
      </div>
    );
  }

  if (!hasActiveProfile) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="max-w-lg rounded-3xl border bg-card p-8 text-center shadow-sm">
          <BriefcaseMedical className="mx-auto h-10 w-10 text-muted-foreground" />
          <h1 className="mt-4 text-xl font-semibold">
            Área Profissional indisponível
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Ative e salve seu perfil profissional em Configurações antes de
            acessar este ambiente.
          </p>
          <Button
            className="mt-6"
            onClick={() => setLocation("/settings?tab=profissional")}
          >
            Ir para Configurações
          </Button>
        </div>
      </div>
    );
  }

  const revokedPatientAccess = Boolean(
    routePatientId &&
      patientContext.isError &&
      isProfessionalPatientAccessUnavailableError(patientContext.error)
  );
  const patientAccessUnavailable = Boolean(
    routePatientId && patientContext.isError && !revokedPatientAccess
  );
  const patientContextLoading = Boolean(
    routePatientId &&
      !patientAccessUnavailable &&
      !revokedPatientAccess &&
      (!profileValidated ||
        !patientContextValidated ||
        readyPatientId !== routePatientId)
  );
  const invalidPatientRoute = patientRoute.kind === "invalid";
  const accessNotice = new URLSearchParams(location.split("?")[1] ?? "").get(
    "notice"
  );

  return (
    <ProfessionalWorkspaceContext.Provider value={contextValue}>
      <SidebarProvider>
        <Sidebar
          collapsible="icon"
          className="border-r border-sidebar-border/70 bg-sidebar"
        >
          <SidebarHeader className="border-b border-sidebar-border/70 px-4 py-5">
            <button
              type="button"
              className="flex w-full items-center gap-3 rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => setLocation("/professional")}
              aria-label="Ir para o início da Área Profissional"
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
                <BriefcaseMedical className="h-5 w-5" />
              </div>
              <div className="min-w-0 group-data-[collapsible=icon]:hidden">
                <p className="truncate text-sm font-semibold">
                  Área Profissional
                </p>
                <p className="truncate text-xs text-sidebar-foreground/70">
                  Gestão de pacientes
                </p>
              </div>
            </button>
          </SidebarHeader>

          <SidebarContent className="px-2 py-4">
            <nav aria-label="Navegação da Área Profissional">
              <SidebarMenu>
                {professionalNavigation.map(item => {
                  const active = isActiveRoute(location, item.path);
                  return (
                    <SidebarMenuItem key={item.path}>
                      <SidebarMenuButton
                        isActive={active}
                        tooltip={item.label}
                        onClick={() => setLocation(item.path)}
                        aria-current={active ? "page" : undefined}
                      >
                        <item.icon />
                        <span>{item.label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </nav>
          </SidebarContent>

          <SidebarFooter className="border-t border-sidebar-border/70 p-3">
            <Button
              type="button"
              variant="ghost"
              className="w-full justify-start group-data-[collapsible=icon]:justify-center"
              onClick={() => {
                invalidatePatientContext();
                if (routePatientId) void clearPatientQueries();
                setLocation("/today");
              }}
            >
              <ChevronLeft className="h-4 w-4" />
              <span className="group-data-[collapsible=icon]:hidden">
                Minha alimentação
              </span>
            </Button>
          </SidebarFooter>
        </Sidebar>

        <SidebarInset>
          <header className="sticky top-0 z-20 border-b bg-background/90 backdrop-blur">
            <div className="flex min-h-16 items-center justify-between gap-3 px-4 py-3 sm:px-6">
              <div className="flex min-w-0 items-center gap-3">
                <SidebarTrigger
                  className="h-9 w-9 shrink-0 rounded-xl border bg-background shadow-sm"
                  aria-label="Abrir ou recolher navegação profissional"
                />
                <div className="min-w-0" aria-live="polite">
                  <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                    Contexto profissional
                  </p>
                  <p className="truncate text-sm font-semibold">
                    {selectedPatient
                      ? `Paciente: ${selectedPatient.displayName}`
                      : "Nenhum paciente selecionado"}
                  </p>
                </div>
              </div>
            </div>
          </header>

          <main
            ref={mainRef}
            tabIndex={-1}
            aria-label={routeTitle(location)}
            className="min-h-[calc(100vh-4rem)] bg-gradient-to-b from-background to-muted/20 p-4 outline-none sm:p-6"
          >
            {accessNotice === "patient-access-unavailable" ? (
              <div
                role="status"
                className="mb-4 rounded-2xl border bg-card p-4 text-sm"
              >
                O acesso a esse paciente não está mais disponível. A carteira foi
                atualizada e nenhum dado anterior permaneceu visível.
              </div>
            ) : null}

            {invalidPatientRoute ? (
              <div className="space-y-4">
                <ProtectedState
                  title="Endereço de paciente inválido"
                  description="O identificador informado não é válido. Nenhuma consulta de paciente foi realizada."
                />
                <div className="flex justify-center">
                  <Button
                    variant="outline"
                    onClick={() => setLocation("/professional/patients")}
                  >
                    Voltar à carteira
                  </Button>
                </div>
              </div>
            ) : patientContextLoading ? (
              <div
                role="status"
                className="rounded-2xl border bg-card p-6 text-sm text-muted-foreground"
              >
                Preparando o contexto seguro do paciente...
              </div>
            ) : patientAccessUnavailable ? (
              <ProtectedState
                title="Não foi possível confirmar a autorização do paciente"
                description="O contexto foi protegido. Tente novamente antes de continuar o acompanhamento."
                onRetry={() => void patientContext.refetch()}
              />
            ) : routePatientId && !selectedPatient ? (
              <div
                role="status"
                className="rounded-2xl border bg-card p-6 text-sm text-muted-foreground"
              >
                Removendo o contexto indisponível...
              </div>
            ) : (
              children
            )}
          </main>
        </SidebarInset>
      </SidebarProvider>
    </ProfessionalWorkspaceContext.Provider>
  );
}
