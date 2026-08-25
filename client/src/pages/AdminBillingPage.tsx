import BillingAdminPanel from "@/components/admin/BillingAdminPanel";
import BillingAdminStatusOverview from "@/components/admin/BillingAdminStatusOverview";
import BillingCampaignAdminPanel from "@/components/admin/BillingCampaignAdminPanel";
import BillingCatalogAdminPanel from "@/components/admin/BillingCatalogAdminPanel";
import BillingGovernanceAdminPanel from "@/components/admin/BillingGovernanceAdminPanel";
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
          title="Billing, catálogo e governança"
          description="Pesquise usuários, consulte a origem efetiva do acesso, administre catálogo, cupons, campanhas e liberações auditáveis e acompanhe economia, retenção e governança de uso. Nenhuma ação desta tela cria cobrança ou assinatura fictícia fora dos fluxos financeiros autoritativos."
          actions={
            <Button variant="outline" onClick={() => setLocation("/admin")}>
              <Settings className="h-4 w-4" />
              Operação da plataforma
            </Button>
          }
        />
        <BillingAdminStatusOverview />
        <BillingAdminPanel />
        <BillingCatalogAdminPanel />
        <BillingCampaignAdminPanel />
        <BillingGovernanceAdminPanel />
      </div>
    </DashboardLayout>
  );
}
