import { MAX_REPORT_RANGE_DAYS } from "@/features/reports/reportDataAdapter";
import { countDaysInRange } from "@/lib/dateRanges";
import { trpc } from "@/lib/trpc";
import React from "react";
import {
  ProfessionalAsyncState,
  ProfessionalLoadingState,
} from "./ProfessionalUi";

type ReportRange = {
  start: string;
  end: string;
};

export type ProfessionalReportRecoveryState = {
  ready: boolean;
  feedback: React.ReactNode | null;
};

const DISABLED_RANGE: ReportRange = {
  start: "1970-01-01",
  end: "1970-01-01",
};

export default function ProfessionalReportRecoveryGate({
  children,
  patientId,
  range,
  suspended = false,
}: {
  children: (state: ProfessionalReportRecoveryState) => React.ReactNode;
  patientId: number;
  range: ReportRange | null;
  suspended?: boolean;
}) {
  const rangeWithinLimit = Boolean(
    range && countDaysInRange(range) <= MAX_REPORT_RANGE_DAYS
  );
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
        startDate: range?.start ?? DISABLED_RANGE.start,
        endDate: range?.end ?? DISABLED_RANGE.end,
      },
      {
        enabled:
          patientTimeZone.isSuccess &&
          Boolean(range) &&
          rangeWithinLimit &&
          !suspended,
        retry: false,
        refetchOnWindowFocus: true,
      }
    );

  let feedback: React.ReactNode | null = null;
  let ready = false;

  if (patientTimeZone.isError) {
    feedback = (
      <ProfessionalAsyncState
        variant="panel"
        title="Não foi possível carregar o fuso horário do paciente"
        description="O relatório permanece protegido. Tente novamente para confirmar o calendário do dono dos dados."
        onRetry={() => void patientTimeZone.refetch()}
      />
    );
  } else if (!patientTimeZone.isSuccess) {
    feedback = (
      <ProfessionalLoadingState label="Confirmando o calendário do paciente..." />
    );
  } else if (!range || suspended) {
    feedback = (
      <ProfessionalLoadingState label="Atualizando o período do relatório..." />
    );
  } else if (!rangeWithinLimit) {
    feedback = (
      <ProfessionalAsyncState
        variant="panel"
        icon="empty"
        title="Período fora do limite"
        description={`Escolha um período de até ${MAX_REPORT_RANGE_DAYS} dias para liberar alertas e assistência.`}
      />
    );
  } else if (reportBundle.isError) {
    feedback = (
      <ProfessionalAsyncState
        variant="panel"
        title="Não foi possível carregar os relatórios autorizados"
        description="Nenhum dado contextual foi exibido. Tente novamente para recarregar o período selecionado."
        onRetry={() => void reportBundle.refetch()}
      />
    );
  } else if (!reportBundle.isSuccess) {
    feedback = (
      <ProfessionalLoadingState label="Carregando o período autorizado..." />
    );
  } else {
    ready = true;
  }

  return <>{children({ ready, feedback })}</>;
}
