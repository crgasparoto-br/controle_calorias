import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { useEffect, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import ProfessionalAreaPage from "../../client/src/pages/ProfessionalAreaPage";
import { VISUAL_PROFESSIONAL_STATE_EVENT } from "./trpcMock";
import "../professional-home/visual.css";

const searchParams = new URLSearchParams(window.location.search);
const draftHistoryScenario = searchParams.get("draft-history");
const goalTransitionScenario = searchParams.get("goal-transition");

async function prepareDraftHistoryScenario() {
  if (!draftHistoryScenario) return;

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

  if (!draftHistoryScenario.startsWith("forward-")) return;

  window.history.pushState(
    { visualDraftHistory: "next" },
    "",
    "/professional/patients/1/notes"
  );
  await new Promise<void>(resolve => {
    const finish = () => {
      window.removeEventListener("popstate", finish);
      resolve();
    };
    window.addEventListener("popstate", finish, { once: true });
    window.history.back();
  });
}

class VisualRuntimeBoundary extends React.Component<
  React.PropsWithChildren,
  { error: string | null }
> {
  state = { error: null as string | null };

  static getDerivedStateFromError(error: unknown) {
    return {
      error: error instanceof Error ? error.message : String(error),
    };
  }

  componentDidCatch(error: unknown) {
    document.documentElement.dataset.visualRuntimeError =
      error instanceof Error ? error.message : String(error);
  }

  render() {
    if (this.state.error) {
      return (
        <pre data-visual-runtime-error className="p-4 whitespace-pre-wrap">
          {this.state.error}
        </pre>
      );
    }
    return this.props.children;
  }
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false },
    mutations: { retry: false },
  },
});

function findButton(text: string, root: ParentNode = document) {
  return Array.from(root.querySelectorAll<HTMLButtonElement>("button")).find(
    button => button.textContent?.includes(text)
  );
}

function goalCard() {
  const title = Array.from(
    document.querySelectorAll<HTMLElement>('[data-slot="card-title"]')
  ).find(element => element.textContent?.includes("Meta profissional oficial"));
  return title?.closest<HTMLElement>('[data-slot="card"]') ?? null;
}

function writeGoalDiagnostics(root: HTMLElement) {
  const card = goalCard();
  if (!card) return;

  const controls = Array.from(
    card.querySelectorAll<
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement
    >("input, select, textarea, button")
  );
  const fields = Array.from(
    card.querySelectorAll<
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    >("input, select, textarea")
  );
  const cardRect = card.getBoundingClientRect();
  root.dataset.visualGoalsCardContained = String(
    cardRect.left >= 0 && cardRect.right <= window.innerWidth
  );
  root.dataset.visualGoalsControlsContained = String(
    controls.every(control => {
      const rect = control.getBoundingClientRect();
      return rect.left >= 0 && rect.right <= window.innerWidth;
    })
  );
  root.dataset.visualGoalsFieldsLabeled = String(
    fields.every(field => {
      const hasAriaLabel = Boolean(field.getAttribute("aria-label")?.trim());
      const label = field.closest("label");
      return hasAriaLabel || Boolean(label?.textContent?.trim());
    })
  );
  root.dataset.visualGoalsExceptionVisible = String(
    Boolean(card.querySelector('[aria-label="Dia da exceção 1"]')) &&
      Boolean(card.querySelector('[aria-label="Duração da exceção 1"]')) &&
      Boolean(card.querySelector('[aria-label="Remover exceção 1"]'))
  );
  root.dataset.visualGoalsPrimaryActionDisabled = String(
    Boolean(findButton("Ativar nova versão", card)?.disabled)
  );
  root.dataset.visualGoalsAllMutationsDisabled = String(
    controls.length > 0 && controls.every(control => control.disabled)
  );
  root.dataset.visualGoalsTrackingState = new URLSearchParams(
    window.location.search
  ).get("state") ?? "active";
}

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

  const reportTitle = Array.from(document.querySelectorAll<HTMLElement>("h1")).find(
    element => element.textContent?.trim() === "Diagnóstico nutricional do período"
  );
  const periodSelector = document.querySelector<HTMLElement>(
    "[data-period-scope-selector]"
  );
  const reportIntro = reportTitle?.closest<HTMLElement>("section") ?? null;
  if (reportTitle && periodSelector && reportIntro) {
    const titleRect = reportTitle.getBoundingClientRect();
    const selectorRect = periodSelector.getBoundingClientRect();
    const introRect = reportIntro.getBoundingClientRect();
    const intersects = !(
      titleRect.right <= selectorRect.left ||
      selectorRect.right <= titleRect.left ||
      titleRect.bottom <= selectorRect.top ||
      selectorRect.bottom <= titleRect.top
    );
    root.dataset.visualReportTitleContained = String(
      titleRect.left >= introRect.left &&
        titleRect.right <= introRect.right &&
        titleRect.top >= introRect.top &&
        titleRect.bottom <= introRect.bottom
    );
    root.dataset.visualReportTitleNotOverlapped = String(!intersects);
    root.dataset.visualReportSelectorContained = String(
      selectorRect.left >= introRect.left && selectorRect.right <= introRect.right
    );
  }

  writeGoalDiagnostics(root);
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
        return draftHistoryScenario.endsWith("accept");
      };
      if (draftHistoryScenario.startsWith("forward-")) {
        window.history.forward();
      } else {
        window.history.back();
      }

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

  useEffect(() => {
    if (!window.location.pathname.endsWith("/goals")) return;

    const run = window.setTimeout(() => {
      const card = goalCard();
      if (!card) {
        document.documentElement.dataset.visualGoalsError = "goal-card-not-found";
        return;
      }

      const justification = card.querySelector<HTMLTextAreaElement>("textarea");
      if (justification && !justification.disabled) {
        const valueSetter = Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          "value"
        )?.set;
        valueSetter?.call(
          justification,
          "Revisão visual da vigência e das exceções por dia."
        );
        justification.dispatchEvent(new Event("input", { bubbles: true }));
      }

      const addException = findButton("Adicionar exceção", card);
      if (addException && !addException.disabled) addException.click();

      window.setTimeout(() => {
        if (goalTransitionScenario === "paused") {
          const nextUrl = `${window.location.pathname}?state=paused&goal-seeded=1`;
          window.history.replaceState({ visualGoalState: "paused" }, "", nextUrl);
          window.dispatchEvent(new Event(VISUAL_PROFESSIONAL_STATE_EVENT));
        }
        window.setTimeout(writeVisualDiagnostics, 600);
      }, 250);
    }, 700);

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

void prepareDraftHistoryScenario().then(() => {
  createRoot(document.getElementById("root")!).render(
    <VisualRuntimeBoundary>
      <VisualProfessionalPatientWorkspace />
    </VisualRuntimeBoundary>
  );
});
