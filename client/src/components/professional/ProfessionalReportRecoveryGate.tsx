import {
  MAX_REPORT_RANGE_DAYS,
} from "@/features/reports/reportDataAdapter";
import { countDaysInRange } from "@/lib/dateRanges";
import { trpc } from "@/lib/trpc";
import React from "react";
import { ProfessionalAsyncState } from "./ProfessionalUi";

type ReportRange = {
  start: string;
  end: string;
};

export default function ProfessionalReportRecoveryGate({
  children,
  patientId,
  range,
}: {
  children: React.ReactNode;
  patientId: number;
  range: ReportRange;
}) {
  const rangeWithinLimit =
    countDaysInRange(range) <= MAX_REPORT_RANGE_DAYS;
  const patientTimeZone =
    trpc.nutrition.professionals.patientTimeZone.useQuery(
      { patientId },
      {
        retry: false,
        refetchOnWindowFocus: true,
      }
    );
  const reportBundle =
    trpc.nutrition.professionals.patientPeriodBundle.useQuery(
      {
        patientId,
        startDate: range.start,
        endDate: range.end,
      },
      {
        enabled: patientTimeZone.isSuccess && rangeWithinLimit,
        retry: false,
        refetchOnWindowFocus: true,
      }
    );

  if (patientTimeZone.isError) {
    return (
      <ProfessionalAsyncState
        variant="panel"
        title="Não foi possível carregar o fuso horário do paciente"
        description="O relatório permanece protegido. Tente novamente para confirmar o calendário do dono dos dados."
        onRetry={() => void patientTimeZone.refetch()}
      />
    );
  }

  if (rangeWithinLimit && reportBundle.isError) {
    return (
      <ProfessionalAsyncState
        variant="panel"
        title="Não foi possível carregar os relatórios autorizados"
        description="Nenhum dado parcial foi exibido. Tente novamente para recarregar o período selecionado."
        onRetry={() => void reportBundle.refetch()}
      />
    );
  }

  return <>{children}</>;
}
