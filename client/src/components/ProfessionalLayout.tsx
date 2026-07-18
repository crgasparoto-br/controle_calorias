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
  BarChart3,
  BriefcaseMedical,
  ChevronLeft,
  FileClock,
  LayoutDashboard,
  MessageSquareText,
  Settings,
  UsersRound,
} from "lucide-react";
import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
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

export default function ProfessionalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { loading, refresh, user } = useAuth();
  const [location, setLocation] = useLocation();
  const [selectedPatient, setSelectedPatient] =
    useState<ProfessionalPatientContext | null>(null);

  useEffect(() => {
    const refreshAccess = () => {
      void refresh();
    };
    const intervalId = window.setInterval(refreshAccess, 30_000);
    window.addEventListener("focus", refreshAccess);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refreshAccess);
    };
  }, [refresh]);

  const contextValue = useMemo(
    () => ({ selectedPatient, selectPatient: setSelectedPatient }),
    [selectedPatient]
  );

  if (loading) return <DashboardLayoutSkeleton />;

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

  if (!user.professionalProfileActive) {
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
            <SidebarMenu>
              {professionalNavigation.map(item => (
                <SidebarMenuItem key={item.path}>
                  <SidebarMenuButton
                    isActive={isActiveRoute(location, item.path)}
                    tooltip={item.label}
                    onClick={() => setLocation(item.path)}
                  >
                    <item.icon />
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarContent>

          <SidebarFooter className="border-t border-sidebar-border/70 p-3">
            <Button
              type="button"
              variant="ghost"
              className="w-full justify-start group-data-[collapsible=icon]:justify-center"
              onClick={() => setLocation("/today")}
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
              <div className="flex items-center gap-3">
                <SidebarTrigger className="h-9 w-9 rounded-xl border bg-background shadow-sm" />
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                    Contexto profissional
                  </p>
                  <p className="text-sm font-semibold">
                    {selectedPatient
                      ? `Paciente: ${selectedPatient.displayName}`
                      : "Nenhum paciente selecionado"}
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                onClick={() => setLocation("/professional/legacy")}
              >
                Experiência legada
              </Button>
            </div>
          </header>
          <main className="min-h-[calc(100vh-4rem)] bg-gradient-to-b from-background to-muted/20 p-4 sm:p-6">
            {children}
          </main>
        </SidebarInset>
      </SidebarProvider>
    </ProfessionalWorkspaceContext.Provider>
  );
}
