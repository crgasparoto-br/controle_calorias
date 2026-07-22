import { useProfessionalWorkspace } from "@/components/ProfessionalLayout";
import {
  ProfessionalAsyncState,
  ProfessionalLoadingState,
} from "@/components/professional/ProfessionalUi";
import {
  parseProfessionalPatientRoute,
  professionalPatientPath,
} from "@/lib/professionalRoutes";
import { trpc } from "@/lib/trpc";
import React, { useEffect } from "react";
import { useLocation } from "wouter";
import ProfessionalPatientWorkspace from "./ProfessionalPatientWorkspace";

export default function ProfessionalPatientRouteGuard() {
  const { selectedPatient } = useProfessionalWorkspace();
  const [location, setLocation] = useLocation();
  const route = parseProfessionalPatientRoute(location);
  const patientId = selectedPatient?.patientId ?? 0;
  const record = trpc.professionalRecord.get.useQuery(
    { patientId, page: 1, pageSize: 20 },
    {
      enabled: patientId > 0,
      retry: false,
      refetchOnWindowFocus: true,
      staleTime: 10_000,
    }
  );
  const endedOutsideHistory = Boolean(
    route.kind === "patient" &&
      route.section !== "history" &&
      record.data?.patient.trackingStatus === "ended"
  );

  useEffect(() => {
    if (!endedOutsideHistory || !selectedPatient) return;
    setLocation(professionalPatientPath(selectedPatient.patientId, "history"));
  }, [endedOutsideHistory, selectedPatient, setLocation]);

  if (!selectedPatient) {
    return (
      <ProfessionalAsyncState
        icon="empty"
        title="Selecione um paciente"
        description="Abra um paciente autorizado pela carteira para acessar o acompanhamento."
      />
    );
  }
  if (record.isLoading) {
    return <ProfessionalLoadingState label="Confirmando situação do acompanhamento..." />;
  }
  if (record.isError) {
    return (
      <ProfessionalAsyncState
        title="Não foi possível confirmar a situação do acompanhamento"
        description="O contexto permanece protegido. Tente novamente antes de continuar."
        onRetry={() => void record.refetch()}
      />
    );
  }
  if (endedOutsideHistory) {
    return (
      <ProfessionalLoadingState label="Abrindo o histórico do acompanhamento encerrado..." />
    );
  }

  return <ProfessionalPatientWorkspace />;
}
