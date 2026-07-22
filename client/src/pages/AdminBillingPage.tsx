import BillingAdminPanel from "@/components/admin/BillingAdminPanel";
import DashboardLayout from "@/components/DashboardLayout";
import PageIntro from "@/components/PageIntro";
import { Button } from "@/components/ui/button";
import { Settings } from "lucide-react";
import React from "react";
import { useLocation } from "wouter";

export default function AdminBillingPage() {
  const [, setLocation] = useLocation();

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-7xl space-y-6">
        <PageIntro
          eyebrow="Administração comercial"
          title="Billing e elegibilidade"
          description="Pesquise usuários, consulte a origem efetiva do acesso, administre liberações auditáveis e acompanhe indicadores provider-neutral. Nenhuma ação desta tela cria cobrança ou assinatura fictícia."
          actions={
            <Button variant="outline" onClick={() => setLocation("/admin")}>
              <Settings className="h-4 w-4" />
              Operação da plataforma
            </Button>
          }
        />
        <BillingAdminPanel />
      </div>
    </DashboardLayout>
  );
}
