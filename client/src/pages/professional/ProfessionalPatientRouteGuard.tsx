import { useProfessionalWorkspace } from "@/components/ProfessionalLayout";
import { ProfessionalAsyncState } from "@/components/professional/ProfessionalUi";
import { parseProfessionalPatientRoute } from "@/lib/professionalRoutes";
import React from "react";
import { useLocation } from "wouter";
import ProfessionalPatientWorkspace from "./ProfessionalPatientWorkspace";

export default function ProfessionalPatientRouteGuard() {
  const { selectedPatient } = useProfessionalWorkspace();
  const [location] = useLocation();
  const route = parseProfessionalPatientRoute(location);

  if (!selectedPatient || route.kind !== "patient") {
    return (
      <ProfessionalAsyncState
        icon="empty"
        title="Selecione um paciente"
        description="Abra um paciente autorizado pela carteira para acessar o acompanhamento."
      />
    );
  }

  const pathname = location.split(/[?#]/, 1)[0].replace(/\/+$/, "") || "/";
  return <ProfessionalPatientWorkspace key={pathname} />;
}
