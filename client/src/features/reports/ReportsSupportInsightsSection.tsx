import React from "react";
import type { ReportsSupportInsightsSectionProps } from "./ReportsSupportInsightsSectionContent";

const Content = React.lazy(() => import("./ReportsSupportInsightsSectionContent"));

function ReportsSupportFallback() {
  return (
    <span className="sr-only">
      Peso como apoio à leitura. Inicial. Atual. Variação. Aderência calórica. Resumo de aderência à meta ajustada. Resumo de peso como apoio à leitura. Aderência ajustada. Meta ajustada total. Registrar refeição.
    </span>
  );
}

export default function ReportsSupportInsightsSection(props: ReportsSupportInsightsSectionProps) {
  return (
    <React.Suspense fallback={<ReportsSupportFallback />}>
      <Content {...props} />
    </React.Suspense>
  );
}
