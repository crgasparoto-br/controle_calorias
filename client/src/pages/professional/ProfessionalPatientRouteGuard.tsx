import { useProfessionalWorkspace } from "@/components/ProfessionalLayout";
import { ProfessionalAsyncState } from "@/components/professional/ProfessionalUi";
import {
  parseProfessionalPatientRoute,
  professionalPatientPath,
} from "@/lib/professionalRoutes";
import React, { useEffect } from "react";
import { useLocation } from "wouter";
import ProfessionalPatientWorkspace from "./ProfessionalPatientWorkspace";

export default function ProfessionalPatientRouteGuard() {
  const { selectedPatient } = useProfessionalWorkspace();
  const [location, setLocation] = useLocation();
  const route = parseProfessionalPatientRoute(location);
  const endedOutsideReadOnlySections = Boolean(
    selectedPatient?.trackingStatus === "ended" &&
      route.kind === "patient" &&
      route.section !== "messages" &&
      route.section !== "history"
  );

  useEffect(() => {
    if (!endedOutsideReadOnlySections || !selectedPatient) return;
    setLocation(professionalPatientPath(selectedPatient.patientId, "history"));
  }, [endedOutsideReadOnlySections, selectedPatient, setLocation]);

  if (!selectedPatient || route.kind !== "patient") {
    return (
      <ProfessionalAsyncState
        icon="empty"
        title="Selecione um paciente"
        description="Abra um paciente autorizado pela carteira para acessar o acompanhamento."
      />
    );
  }

  if (endedOutsideReadOnlySections) {
    return (
      <ProfessionalAsyncState
        icon="empty"
        title="Acompanhamento encerrado"
        description="Somente as mensagens anteriores e o histórico profissional permanecem disponíveis para consulta."
      />
    );
  }

  const workspaceKey = selectedPatient.authorizationId
    ? `${selectedPatient.patientId}:${selectedPatient.authorizationId}`
    : `${selectedPatient.patientId}:${selectedPatient.trackingStatus}`;
  return <ProfessionalPatientWorkspace key={workspaceKey} />;
}
