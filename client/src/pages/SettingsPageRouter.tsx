import DashboardLayout from "@/components/DashboardLayout";
import PageIntro from "@/components/PageIntro";
import ProfessionalProfileSettings, {
  PatientAccessRequestsCard,
} from "@/components/ProfessionalProfileSettings";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { ArrowRight, BadgeCheck, Stethoscope } from "lucide-react";
import React from "react";
import { useLocation } from "wouter";
import OnboardingPage from "./OnboardingPage";

function ProfessionalPersonalSettings() {
  const [, setLocation] = useLocation();
  const profile = trpc.nutrition.professionals.profile.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: true,
  });
  const active = Boolean(profile.data?.active);

  return (
    <DashboardLayout>
      <main className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <PageIntro
          eyebrow="Configurações pessoais"
          title="Perfil profissional"
          description="Ative a Área Profissional e defina a identificação básica exibida às pessoas acompanhadas. Preferências operacionais ficam dentro da própria Área Profissional."
          actions={
            active ? (
              <Button onClick={() => setLocation("/professional/settings")}>
                Abrir configurações profissionais
                <ArrowRight className="h-4 w-4" />
              </Button>
            ) : undefined
          }
        />

        {active ? (
          <Card className="border-emerald-500/30 bg-emerald-500/5">
            <CardContent className="flex flex-col gap-3 py-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-start gap-3">
                <BadgeCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
                <div className="min-w-0">
                  <p className="font-semibold">Área Profissional ativa</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Sua carteira, prontuários, mensagens e relatórios profissionais estão disponíveis.
                  </p>
                </div>
              </div>
              <Button variant="outline" onClick={() => setLocation("/professional")}>
                <Stethoscope className="h-4 w-4" />
                Abrir Área Profissional
              </Button>
            </CardContent>
          </Card>
        ) : null}

        <ProfessionalProfileSettings />

        <section aria-labelledby="personal-access-requests-title" className="space-y-3">
          <div>
            <h2 id="personal-access-requests-title" className="text-lg font-semibold">
              Solicitações recebidas como paciente
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Estes pedidos pertencem à sua área pessoal e não são pacientes da sua carteira profissional.
            </p>
          </div>
          <PatientAccessRequestsCard embedded />
        </section>
      </main>
    </DashboardLayout>
  );
}

export default function SettingsPageRouter() {
  const [location] = useLocation();
  const query = location.includes("?") ? location.slice(location.indexOf("?") + 1) : "";
  const tab = new URLSearchParams(query).get("tab");

  return tab === "profissional" ? <ProfessionalPersonalSettings /> : <OnboardingPage />;
}
