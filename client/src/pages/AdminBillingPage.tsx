import BillingAdminPanel from "@/components/admin/BillingAdminPanel";
import BillingAdminStatusOverview from "@/components/admin/BillingAdminStatusOverview";
import BillingCampaignAdminPanel from "@/components/admin/BillingCampaignAdminPanel";
import BillingCatalogAdminPanel from "@/components/admin/BillingCatalogAdminPanel";
import BillingEconomicIdentityPanel from "@/components/admin/BillingEconomicIdentityPanel";
import BillingGovernanceAdminPanel from "@/components/admin/BillingGovernanceAdminPanel";
import BillingRolloutAdminPanel from "@/components/admin/BillingRolloutAdminPanel";
import DashboardLayout from "@/components/DashboardLayout";
import PageIntro from "@/components/PageIntro";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import { Settings } from "lucide-react";
import React, { useState } from "react";
import { useLocation } from "wouter";

type BillingAdminArea = "overview" | "access" | "commercial" | "governance" | "rollout";

const AREA_TABS: Array<{ value: BillingAdminArea; label: string }> = [
  { value: "overview", label: "Visão geral" },
  { value: "access", label: "Acessos" },
  { value: "commercial", label: "Comercial" },
  { value: "governance", label: "Governança" },
  { value: "rollout", label: "Rollout" },
];

function formatMetric(value: number | undefined, state: { isLoading: boolean; isError: boolean }) {
  if (state.isLoading) return "…";
  if (state.isError || value === undefined) return "—";
  return value.toLocaleString("pt-BR");
}

function BillingAdminKpis() {
  const analytics = trpc.billing.adminAnalytics.useQuery(undefined, { retry: false });
  const state = { isLoading: analytics.isLoading, isError: analytics.isError };

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Kpi
        label="Assinaturas ativas"
        value={formatMetric(analytics.data?.subscriptionStatusTotals.active, state)}
        supporting="contratos atualmente ativos"
      />
      <Kpi
        label="Inadimplentes"
        value={formatMetric(analytics.data?.subscriptionStatusTotals.past_due, state)}
        supporting="assinaturas com pagamento pendente"
      />
      <Kpi
        label="Sem origem comercial válida"
        value={formatMetric(analytics.data?.usersWithoutCommercialAccess, state)}
        supporting="usuários sem acesso comercial vigente"
      />
      <Kpi
        label="Liberações administrativas ativas"
        value={formatMetric(analytics.data?.activeOverrides, state)}
        supporting="exceções administrativas vigentes"
      />
    </div>
  );
}

function Kpi({ label, value, supporting }: { label: string; value: string; supporting: string }) {
  return (
    <div className="rounded-2xl border bg-background p-4 shadow-sm">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{supporting}</p>
    </div>
  );
}

export default function AdminBillingPage() {
  const [, setLocation] = useLocation();
  const [activeArea, setActiveArea] = useState<BillingAdminArea>("overview");

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-7xl space-y-6">
        <PageIntro
          eyebrow="Administração comercial"
          title="Planos, assinaturas e acesso"
          description="Acompanhe a situação comercial, gerencie acessos, catálogo, campanhas e controles de rollout. Liberações administrativas não criam cobrança nem assinatura."
          actions={
            <Button variant="outline" onClick={() => setLocation("/admin")}>
              <Settings className="h-4 w-4" />
              Operação da plataforma
            </Button>
          }
          stats={<BillingAdminKpis />}
        />

        <Tabs
          value={activeArea}
          onValueChange={value => setActiveArea(value as BillingAdminArea)}
          className="space-y-6"
        >
          <div className="max-w-full overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <TabsList
              aria-label="Áreas da administração comercial"
              className="h-auto w-max min-w-full justify-start gap-1 rounded-2xl p-1 sm:min-w-0"
            >
              {AREA_TABS.map(area => (
                <TabsTrigger
                  key={area.value}
                  value={area.value}
                  className="shrink-0 rounded-xl px-4 py-2.5"
                >
                  {area.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          <TabsContent value="overview" className="mt-0 space-y-6">
            {activeArea === "overview" ? <BillingAdminStatusOverview /> : null}
          </TabsContent>
          <TabsContent value="access" className="mt-0 space-y-6">
            {activeArea === "access" ? <BillingAdminPanel /> : null}
          </TabsContent>
          <TabsContent value="commercial" className="mt-0 space-y-6">
            {activeArea === "commercial" ? (
              <>
                <BillingCatalogAdminPanel />
                <BillingCampaignAdminPanel />
              </>
            ) : null}
          </TabsContent>
          <TabsContent value="governance" className="mt-0 space-y-6">
            {activeArea === "governance" ? (
              <>
                <BillingGovernanceAdminPanel />
                <BillingEconomicIdentityPanel />
              </>
            ) : null}
          </TabsContent>
          <TabsContent value="rollout" className="mt-0 space-y-6">
            {activeArea === "rollout" ? <BillingRolloutAdminPanel /> : null}
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
