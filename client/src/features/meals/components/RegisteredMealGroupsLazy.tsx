import React from "react";

const RegisteredMealGroupsContent = React.lazy(() =>
  import("./RegisteredMealGroups").then(module => ({ default: module.RegisteredMealGroups })),
);

export function RegisteredMealGroups(props: React.ComponentProps<typeof RegisteredMealGroupsContent>) {
  return (
    <React.Suspense fallback={null}>
      <RegisteredMealGroupsContent {...props} />
    </React.Suspense>
  );
}
