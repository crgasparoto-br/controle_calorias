import React from "react";
import DashboardLayout from "@/components/DashboardLayout";
import ReportsGoalInsightsPanel from "@/components/ReportsGoalInsightsPanel";
import ReportsExperience from "@/features/reports/ReportsExperience";

export default function ReportsPage() {
  return (
    <DashboardLayout>
      <ReportsExperience context="self" />
      <ReportsGoalInsightsPanel />
    </DashboardLayout>
  );
}
