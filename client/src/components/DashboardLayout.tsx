import { useAuth } from "@/_core/hooks/useAuth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { getLoginUrl } from "@/const";
import { useIsMobile } from "@/hooks/useMobile";
import {
  Activity,
  BarChart3,
  Goal,
  LayoutDashboard,
  LogOut,
  MessageCircleMore,
  MessageSquareMore,
  Shield,
} from "lucide-react";
import { useMemo } from "react";
import { useLocation } from "wouter";
import { DashboardLayoutSkeleton } from "./DashboardLayoutSkeleton";
import { Button } from "./ui/button";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { loading, user } = useAuth();

  if (loading) {
    return <DashboardLayoutSkeleton />;
  }

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6">
        <div className="w-full max-w-md rounded-3xl border bg-card p-8 text-card-foreground shadow-sm">
          <div className="space-y-3 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Activity className="h-7 w-7" />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">Entre para acessar sua jornada nutricional</h1>
            <p className="text-sm leading-6 text-muted-foreground">
              Faça login para registrar refeições, acompanhar metas calóricas, revisar inferências da IA e visualizar seus relatórios.
            </p>
          </div>
          <Button
            className="mt-8 h-11 w-full"
            onClick={() => {
              window.location.href = getLoginUrl();
            }}
          >
            Fazer login
          </Button>
        </div>
      </div>
    );
  }

  return (
    <SidebarProvider>
      <DashboardLayoutContent>{children}</DashboardLayoutContent>
    </SidebarProvider>
  );
}

function DashboardLayoutContent({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const [location, setLocation] = useLocation();
  const isMobile = useIsMobile();

  const menuItems = useMemo(() => {
    const baseItems = [
      { icon: LayoutDashboard, label: "Dashboard", path: "/" },
      { icon: MessageSquareMore, label: "Registrar refeição", path: "/log-meal" },
      { icon: Goal, label: "Metas nutricionais", path: "/goals" },
      { icon: BarChart3, label: "Relatórios", path: "/reports" },
      { icon: MessageCircleMore, label: "Canais", path: "/channels" },
    ];

    if (user?.role === "admin") {
      baseItems.push({ icon: Shield, label: "Administração", path: "/admin" });
    }

    return baseItems;
  }, [user?.role]);

  const activeItem = menuItems.find(item => item.path === location);

  return (
    <>
      <Sidebar collapsible="icon" className="border-r border-sidebar-border/70 bg-sidebar">
        <SidebarHeader className="border-b border-sidebar-border/70 px-4 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-sidebar-primary/12 text-sidebar-primary">
              <Activity className="h-5 w-5" />
            </div>
            <div className="min-w-0 group-data-[collapsible=icon]:hidden">
              <p className="truncate text-sm font-medium text-sidebar-foreground/70">Controle de Calorias</p>
              <h1 className="truncate text-base font-semibold tracking-tight text-sidebar-foreground">Nutrição inteligente</h1>
            </div>
          </div>
        </SidebarHeader>

        <SidebarContent className="px-3 py-4">
          <SidebarMenu>
            {menuItems.map(item => {
              const isActive = item.path === location;
              return (
                <SidebarMenuItem key={item.path}>
                  <SidebarMenuButton
                    isActive={isActive}
                    tooltip={item.label}
                    className="h-11 rounded-xl"
                    onClick={() => setLocation(item.path)}
                  >
                    <item.icon className="h-4 w-4" />
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarContent>

        <SidebarFooter className="border-t border-sidebar-border/70 p-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring">
                <Avatar className="h-10 w-10 border border-sidebar-border bg-background">
                  <AvatarFallback>{(user?.name || "U").charAt(0).toUpperCase()}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
                  <p className="truncate text-sm font-medium text-sidebar-foreground">{user?.name || "Usuário"}</p>
                  <p className="truncate text-xs text-sidebar-foreground/70">{user?.role === "admin" ? "Administrador" : "Conta pessoal"}</p>
                </div>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={logout} className="cursor-pointer text-destructive focus:text-destructive">
                <LogOut className="mr-2 h-4 w-4" />
                <span>Sair</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset>
        <div className="sticky top-0 z-20 border-b bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/70">
          <div className="flex h-16 items-center justify-between px-4 sm:px-6">
            <div className="flex items-center gap-3">
              <SidebarTrigger className="h-9 w-9 rounded-xl border bg-background shadow-sm" />
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Plataforma</p>
                <h2 className="text-sm font-semibold tracking-tight text-foreground">
                  {activeItem?.label || "Painel nutricional"}
                </h2>
              </div>
            </div>
            {isMobile ? null : (
              <div className="rounded-full border bg-card px-4 py-2 text-xs text-muted-foreground shadow-sm">
                IA multimodal, metas diárias e acompanhamento em tempo real
              </div>
            )}
          </div>
        </div>
        <main className="min-h-[calc(100vh-4rem)] bg-gradient-to-b from-background via-background to-muted/20 p-4 sm:p-6">
          {children}
        </main>
      </SidebarInset>
    </>
  );
}
