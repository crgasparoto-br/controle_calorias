import React from "react";

const Content = React.lazy(() => import("./FoodQualityUnclassifiedDiagnosticsContent"));

export default function FoodQualityUnclassifiedDiagnostics(props: any) {
  if (!props.items?.length) return null;
  return (
    <React.Suspense fallback={null}>
      <Content {...props} />
    </React.Suspense>
  );
}
