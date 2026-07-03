import React from "react";
import type { ReportsSupportInsightsSectionProps } from "./ReportsSupportInsightsSectionContent";

const Content = React.lazy(() => import("./ReportsSupportInsightsSectionContent"));

export default function ReportsSupportInsightsSection(props: ReportsSupportInsightsSectionProps) {
  return (
    <React.Suspense fallback={null}>
      <Content {...props} />
    </React.Suspense>
  );
}
