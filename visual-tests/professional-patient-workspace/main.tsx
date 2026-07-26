import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { useEffect, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import ProfessionalAreaPage from "../../client/src/pages/ProfessionalAreaPage";
import "../professional-home/visual.css";

const draftHistoryScenario = new URLSearchParams(window.location.search).get(
  "draft-history"
);
if (draftHistoryScenario) {
  const requestedUrl = `${window.location.pathname}${window.location.search}`;
  window.history.replaceState(
    { visualDraftHistory: "previous" },
    "",
    "/professional/patients/1"
  );
  window.history.pushState(
    { visualDraftHistory: "current" },
    "",
    requestedUrl
  );
}

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
  useEffect(() => {
    if (!draftHistoryScenario) return;

    const run = window.setTimeout(() => {
      const draft = document.querySelector<HTMLTextAreaElement>("textarea");
      if (!draft) {
        document.documentElement.dataset.visualDraftHistoryError =
          "draft-field-not-found";
        return;
      }

      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value"
      )?.set;
      valueSetter?.call(draft, "Rascunho preservado no histórico");
      draft.dispatchEvent(new Event("input", { bubbles: true }));

      let confirmations = 0;
      window.confirm = () => {
        confirmations += 1;
        return draftHistoryScenario === "accept";
      };
      window.history.back();

      window.setTimeout(() => {
        const currentDraft = document.querySelector<HTMLTextAreaElement>(
          "textarea"
        );
        document.documentElement.dataset.visualDraftHistoryScenario =
          draftHistoryScenario;
        document.documentElement.dataset.visualDraftHistoryConfirmations =
          String(confirmations);
        document.documentElement.dataset.visualDraftHistoryPath =
          window.location.pathname;
        document.documentElement.dataset.visualDraftHistoryPreserved = String(
          currentDraft?.value === "Rascunho preservado no histórico"
        );
      }, 800);
    }, 600);

    return () => window.clearTimeout(run);
  }, []);

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
