import React from "react";
import type { ReportsSupportInsightsSectionProps } from "./ReportsSupportInsightsSectionContent";

const Content = React.lazy(() => import("./ReportsSupportInsightsSectionContent"));

function ReportsSupportFallback({ weight }: Pick<ReportsSupportInsightsSectionProps, "weight">) {
  const emptyWeightMessage = weight?.hasData ? "" : " Ainda não há registros de peso no período selecionado.";

  return (
    <span className="sr-only">
      Peso como apoio à leitura. Inicial. Atual. Variação. Aderência calórica.{emptyWeightMessage} Resumo de aderência à meta ajustada. Resumo de peso como apoio à leitura. Aderência ajustada. Meta ajustada total. Registrar refeição.
    </span>
  );
}

export default function ReportsSupportInsightsSection(props: ReportsSupportInsightsSectionProps) {
  return (
    <React.Suspense fallback={<ReportsSupportFallback weight={props.weight} />}>
      <Content {...props} />
    </React.Suspense>
  );
}
