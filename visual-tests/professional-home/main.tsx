import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import ProfessionalAreaPage from "../../client/src/pages/ProfessionalAreaPage";
import "./visual.css";

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

  const patientCards = Array.from(
    document.querySelectorAll<HTMLElement>("[data-professional-patient-card]")
  );
  const cardsContained = patientCards.every(card => {
    const rect = card.getBoundingClientRect();
    return rect.left >= 0 && rect.right <= window.innerWidth;
  });
  root.dataset.visualPatientCardsContained = String(cardsContained);

  const primaryAction = Array.from(
    document.querySelectorAll<HTMLButtonElement>("[data-patient-action]")
  ).find(button => button.textContent?.trim() === "Abrir paciente");
  if (primaryAction) {
    const rect = primaryAction.getBoundingClientRect();
    root.dataset.visualPrimaryActionVisible = String(
      rect.left >= 0 &&
        rect.right <= window.innerWidth &&
        rect.top >= 0 &&
        rect.top < window.innerHeight
    );
  }
}

function VisualProfessionalArea() {
  useLayoutEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("sidebar") === "collapsed") {
      document.documentElement.classList.add("visual-no-motion");
      document
        .querySelector<HTMLButtonElement>('[data-slot="sidebar-trigger"]')
        ?.click();
    }

    const timer = window.setTimeout(writeVisualDiagnostics, 600);
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

createRoot(document.getElementById("root")!).render(<VisualProfessionalArea />);
