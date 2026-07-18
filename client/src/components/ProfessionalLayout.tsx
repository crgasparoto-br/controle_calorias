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
import { trpc } from "@/lib/trpc";
import {
  AlertTriangle,
  BarChart3,
  BriefcaseMedical,
  ChevronLeft,
  FileClock,
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
};

type ProfessionalWorkspaceContextValue = {
  selectedPatient: ProfessionalPatientContext | null;
  selectPatient: (patient: ProfessionalPatientContext | null) => void;
  clearPatient: () => void;
};

type PatientAccess = {
  patientUserId: number;
  status: string;
  patient?: { name?: string | null; email?: string | null } | null;
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
  { label: "Acompanhamento", path: "/professional/follow-up", icon: FileClock },
  {
    label: "Mensagens",
    path: "/professional/messages",
    icon: MessageSquareText,
  },
  { label: "Relatórios", path: "/professional/reports", icon: BarChart3 },
  { label: "Configurações", path: "/professional/settings", icon: Settings },
];

function isActiveRoute(location: string, path: string) {
  if (path === "/professional") return location === path;
  return location === path || location.startsWith(`${path}/`);
}

function routeTitle(location: string) {
  return (
    professionalNavigation.find(item => isActiveRoute(location, item.path))
      ?.label ?? "Área Profissional"
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
  const mainRef = useRef<HTMLElement | null>(null);
  const selectedPatientRef = useRef<ProfessionalPatientContext | null>(null);
  const [selectedPatient, setSelectedPatient] =
    useState<ProfessionalPatientContext | null>(null);

  const profile = trpc.nutrition.professionals.profile.useQuery(undefined, {
    enabled: Boolean(user),
    retry: false,
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
  });
  const hasActiveProfile = Boolean(
    user?.professionalProfileActive && profile.data?.active
  );
  const accesses = trpc.nutrition.professionals.myAccesses.useQuery(undefined, {
    enabled: hasActiveProfile,
    retry: false,
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
  });

  const invalidatePatientData = useCallback(
    async (patientId: number) => {
      await Promise.all([
        utils.nutrition.professionals.patientTimeZone.invalidate({ patientId }),
        utils.nutrition.professionals.patientDashboard.invalidate({ patientId }),
        utils.nutrition.professionals.patientPeriodBundle.invalidate(),
      ]);
    },
    [utils]
  );

  const clearPatient = useCallback(() => {
    const current = selectedPatientRef.current;
    selectedPatientRef.current = null;
    setSelectedPatient(null);
    if (current) void invalidatePatientData(current.patientId);
  }, [invalidatePatientData]);

  const selectPatient = useCallback(
    (patient: ProfessionalPatientContext | null) => {
      const previous = selectedPatientRef.current;
      if (previous && previous.patientId !== patient?.patientId) {
        void invalidatePatientData(previous.patientId);
      }
      selectedPatientRef.current = patient;
      setSelectedPatient(patient);
    },
    [invalidatePatientData]
  );

  useEffect(() => {
    const refreshAccess = () => {
      void Promise.all([
        refreshAuth(),
        profile.refetch(),
        hasActiveProfile ? accesses.refetch() : Promise.resolve(),
      ]);
    };
    window.addEventListener("focus", refreshAccess);
    return () => window.removeEventListener("focus", refreshAccess);
  }, [accesses, hasActiveProfile, profile, refreshAuth]);

  useEffect(() => {
    if (!profile.isSuccess || !hasActiveProfile) {
      if (selectedPatient) clearPatient();
      return;
    }
    if (accesses.isError) {
      if (selectedPatient) clearPatient();
      return;
    }
    if (!accesses.isSuccess || !selectedPatient) return;

    const approvedIds = new Set(
      ((accesses.data ?? []) as PatientAccess[])
        .filter(access => access.status === "approved")
        .map(access => access.patientUserId)
    );
    if (!approvedIds.has(selectedPatient.patientId)) clearPatient();
  }, [
    accesses.data,
    accesses.isError,
    accesses.isSuccess,
    clearPatient,
    hasActiveProfile,
    profile.isSuccess,
    selectedPatient,
  ]);

  useEffect(() => {
    selectedPatientRef.current = selectedPatient;
  }, [selectedPatient]);

  useEffect(() => {
    document.title = `${routeTitle(location)} | Área Profissional`;
    mainRef.current?.focus();
  }, [location]);

  useEffect(
    () => () => {
      const current = selectedPatientRef.current;
      if (current) void invalidatePatientData(current.patientId);
      selectedPatientRef.current = null;
    },
    [invalidatePatientData]
  );

  const contextValue = useMemo(
    () => ({ selectedPatient, selectPatient, clearPatient }),
    [clearPatient, selectPatient, selectedPatient]
  );

  if (authLoading || (user && profile.isLoading)) {
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
            Verifique sua conexão e tente novamente. Nenhum dado profissional foi exibido.
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
          <Button className="mt-6" onClick={() => setLocation("/settings")}>
            Ir para Configurações
          </Button>
        </div>
      </div>
    );
  }

  const patientAccessUnavailable = accesses.isError;

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
                <p className="truncate text-sm font-semibold">Área Profissional</p>
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
                clearPatient();
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
              <Button
                variant="outline"
                className="shrink-0"
                onClick={() => {
                  clearPatient();
                  setLocation("/professional/legacy");
                }}
              >
                Experiência legada
              </Button>
            </div>
          </header>
          <main
            ref={mainRef}
            tabIndex={-1}
            aria-label={routeTitle(location)}
            className="min-h-[calc(100vh-4rem)] bg-gradient-to-b from-background to-muted/20 p-4 outline-none sm:p-6"
          >
            {accesses.isLoading && selectedPatient ? (
              <div
                role="status"
                className="rounded-2xl border bg-card p-6 text-sm text-muted-foreground"
              >
                Confirmando autorização do paciente...
              </div>
            ) : patientAccessUnavailable ? (
              <div role="alert" className="rounded-2xl border bg-card p-6">
                <h1 className="font-semibold">
                  Não foi possível confirmar a autorização do paciente
                </h1>
                <p className="mt-2 text-sm text-muted-foreground">
                  O contexto foi protegido. Tente novamente antes de continuar o acompanhamento.
                </p>
                <Button
                  className="mt-4"
                  variant="outline"
                  onClick={() => void accesses.refetch()}
                >
                  Tentar novamente
                </Button>
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
