import ProfessionalLayout from "@/components/ProfessionalLayout";
import ProfessionalMessagesPanel from "@/components/ProfessionalMessagesPanel";
import ProfessionalReportsWorkspace from "@/components/ProfessionalReportsWorkspace";
import { ProfessionalPage } from "@/components/professional/ProfessionalUi";
import { parseProfessionalPatientRoute } from "@/lib/professionalRoutes";
import React from "react";
import { useLocation } from "wouter";
import ProfessionalHome from "./professional/ProfessionalHome";
import ProfessionalPatientWorkspace from "./professional/ProfessionalPatientWorkspace";
import ProfessionalPatients from "./professional/ProfessionalPatients";

export default function ProfessionalAreaPage() {
  const [location] = useLocation();
  const pathname = location.split(/[?#]/, 1)[0].replace(/\/+$/, "") || "/";
  const patientRoute = parseProfessionalPatientRoute(location);

  let content: React.ReactNode;
  if (patientRoute.kind === "patient") {
    content = <ProfessionalPatientWorkspace />;
  } else if (pathname === "/professional/patients") {
    content = <ProfessionalPatients />;
  } else if (pathname === "/professional/reports") {
    content = (
      <ProfessionalPage>
        <ProfessionalReportsWorkspace />
      </ProfessionalPage>
    );
  } else if (pathname === "/professional/messages") {
    content = (
      <ProfessionalPage>
        <ProfessionalMessagesPanel />
      </ProfessionalPage>
    );
  } else {
    content = <ProfessionalHome />;
  }

  return <ProfessionalLayout>{content}</ProfessionalLayout>;
}
