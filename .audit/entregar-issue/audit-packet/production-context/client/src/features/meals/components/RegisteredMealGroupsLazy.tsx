import React from "react";

const RegisteredMealGroupsContent = React.lazy(() =>
  import("./RegisteredMealGroups").then(module => ({
    default: module.RegisteredMealGroups,
  }))
);

function capitalizeMealLabel(value: string) {
  const trimmed = value.trim();
  return trimmed
    ? `${trimmed.charAt(0).toLocaleUpperCase("pt-BR")}${trimmed.slice(1)}`
    : trimmed;
}

export function RegisteredMealGroups(
  props: React.ComponentProps<typeof RegisteredMealGroupsContent>
) {
  const mealLabels = props.groups
    .map(group => capitalizeMealLabel(group.mealLabel))
    .filter(Boolean)
    .join(", ");

  return (
    <section
      aria-label={
        mealLabels
          ? `Refeições registradas: ${mealLabels}`
          : "Refeições registradas"
      }
    >
      <React.Suspense fallback={null}>
        <RegisteredMealGroupsContent {...props} />
      </React.Suspense>
    </section>
  );
}
