import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import ProfessionalAreaPage from "../../client/src/pages/ProfessionalAreaPage";
import "../professional-home/visual.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false },
    mutations: { retry: false },
  },
});

function writeVisualDiagnostics() {
  const root = document.documentElement;
  const horizontalOverflow =
    root.scrollWidth > window.innerWidth ||
    document.body.scrollWidth > window.innerWidth;
  root.dataset.visualHorizontalOverflow = String(horizontalOverflow);

  const patientSubnav = document.querySelector<HTMLElement>(
    'nav[aria-label="Áreas do paciente"]'
  );
  if (patientSubnav) {
    const rect = patientSubnav.getBoundingClientRect();
    root.dataset.visualPatientSubnavContained = String(
      rect.left >= 0 && rect.right <= window.innerWidth
    );
    root.dataset.visualPatientSubnavScrollable = String(
      patientSubnav.scrollWidth >= patientSubnav.clientWidth
    );
  }

  const workspaceTitle = Array.from(document.querySelectorAll<HTMLElement>("h1"))
    .find(element => element.textContent?.includes("Mariana de Almeida"));
  if (workspaceTitle) {
    const rect = workspaceTitle.getBoundingClientRect();
    root.dataset.visualPatientHeaderVisible = String(
      rect.top >= 0 && rect.top < window.innerHeight && rect.right <= window.innerWidth
    );
  }
}

function VisualProfessionalPatientWorkspace() {
  useLayoutEffect(() => {
    const timer = window.setTimeout(writeVisualDiagnostics, 800);
    window.addEventListener("resize", writeVisualDiagnostics);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("resize", writeVisualDiagnostics);
    };
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <ProfessionalAreaPage />
    </QueryClientProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <VisualProfessionalPatientWorkspace />
);
