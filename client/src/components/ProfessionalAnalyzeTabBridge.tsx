import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import ReportsExperience from "@/features/reports/ReportsExperience";
import { useLocation } from "wouter";

const ANALYSIS_TAB_LABEL = "Análise por pessoa acompanhada";
const ANALYSIS_TITLE = "Análise da pessoa acompanhada";
const ANALYSIS_DESCRIPTION = "Escolha uma pessoa autorizada para revisar relatórios, metas, sugestões, IA e comentários. O período dos relatórios fica na aba Relatórios.";
const ANALYZE_BUTTON_LABEL = "Analisar";
const PERIOD_FILTER_LABELS = ["Dia", "Semana", "Mês", "Período"];
const PERIOD_DETAIL_LABELS = ["Dia ativo", "Semana de referência", "Mês ativo", "Início"];
const SHARED_REPORTS_MOUNT_ATTR = "data-shared-reports-experience";

type ReportsPortalState = {
  mount: HTMLElement | null;
  patientId: number | null;
};

function elementText(element: Element) {
  return element.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

function hasButtonLabel(container: Element, label: string) {
  return Array.from(container.querySelectorAll("button")).some(button => elementText(button) === label);
}

function findAnalysisTab() {
  const candidates = Array.from(document.querySelectorAll<HTMLElement>("[role='tab'], [data-value='analise'], button"));
  return candidates.find(element =>
    element.getAttribute("data-value") === "analise" || elementText(element).includes(ANALYSIS_TAB_LABEL),
  ) ?? null;
}

function findAnalysisPanel() {
  return document.querySelector<HTMLElement>("[role='tabpanel'][data-state='active']") ??
    Array.from(document.querySelectorAll<HTMLElement>("section, div, article")).find(element =>
      elementText(element).includes("Escolha uma pessoa autorizada para revisar relatórios"),
    ) ?? null;
}

function findReportsTabPanel() {
  const candidates = Array.from(document.querySelectorAll<HTMLElement>("[role='tabpanel'], [data-state], section, div"));
  return candidates
    .filter(element => {
      const text = elementText(element);
      return text.includes("Consumo total") && text.includes("Macros realizados") && text.includes("Aderência");
    })
    .sort((a, b) => elementText(a).length - elementText(b).length)[0] ?? null;
}

function findPeriodFilter() {
  const firstButton = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(button =>
    elementText(button) === PERIOD_FILTER_LABELS[0],
  );
  const buttonGroup = firstButton?.parentElement ?? null;
  if (!buttonGroup || !PERIOD_FILTER_LABELS.every(label => hasButtonLabel(buttonGroup, label))) return null;

  let current = buttonGroup.parentElement;
  while (current) {
    const text = elementText(current);
    if (PERIOD_DETAIL_LABELS.some(label => text.includes(label))) {
      return current;
    }
    current = current.parentElement;
  }

  return buttonGroup;
}

function movePeriodFilterIntoReportsTab() {
  const reportsPanel = findReportsTabPanel();
  const periodFilter = findPeriodFilter();

  if (!reportsPanel || !periodFilter || reportsPanel.contains(periodFilter)) return;

  periodFilter.classList.add("w-full");
  reportsPanel.insertBefore(periodFilter, reportsPanel.firstChild);
}

function findSelectedPatientId() {
  const patientLabel = Array.from(document.querySelectorAll<HTMLElement>("label")).find(element =>
    elementText(element).includes("Pessoa acompanhada") && element.querySelector("select"),
  );
  const value = patientLabel?.querySelector<HTMLSelectElement>("select")?.value;
  const patientId = Number(value ?? 0);
  return Number.isFinite(patientId) && patientId > 0 ? patientId : null;
}

function hideLegacyReportsChildren(reportsPanel: HTMLElement, mount: HTMLElement) {
  Array.from(reportsPanel.children).forEach(child => {
    if (child === mount) return;
    const element = child as HTMLElement;
    element.dataset.legacyReportsHidden = "true";
    element.style.display = "none";
  });
}

function ensureSharedReportsMount() {
  const reportsPanel = findReportsTabPanel();
  if (!reportsPanel) return { mount: null, patientId: null };

  let mount = reportsPanel.querySelector<HTMLElement>(`[${SHARED_REPORTS_MOUNT_ATTR}]`);
  if (!mount) {
    mount = document.createElement("div");
    mount.setAttribute(SHARED_REPORTS_MOUNT_ATTR, "true");
    mount.className = "space-y-6";
    reportsPanel.insertBefore(mount, reportsPanel.firstChild);
  }

  hideLegacyReportsChildren(reportsPanel, mount);
  return { mount, patientId: findSelectedPatientId() };
}

function alignPatientSelectorAndCopy() {
  const title = Array.from(document.querySelectorAll<HTMLElement>("h1, h2, h3, div")).find(element =>
    elementText(element) === ANALYSIS_TAB_LABEL,
  );

  if (title) {
    title.textContent = ANALYSIS_TITLE;
    const description = title.parentElement?.querySelector<HTMLElement>("p");
    if (description) description.textContent = ANALYSIS_DESCRIPTION;
  }

  const patientLabel = Array.from(document.querySelectorAll<HTMLElement>("label")).find(element =>
    elementText(element).includes("Pessoa acompanhada") && element.querySelector("select"),
  );
  const selectorRow = patientLabel?.parentElement;
  if (!selectorRow) return;

  selectorRow.classList.remove("sm:justify-end");
  selectorRow.classList.add("sm:justify-start");
}

function refreshAnalysisLayout() {
  alignPatientSelectorAndCopy();
  movePeriodFilterIntoReportsTab();
  return ensureSharedReportsMount();
}

function findAnalyzeButton(target: EventTarget | null) {
  if (!(target instanceof Element)) return null;
  const button = target.closest<HTMLButtonElement>("button");
  if (!button) return null;
  return elementText(button) === ANALYZE_BUTTON_LABEL ? button : null;
}

function openAnalysisTab(onRefresh: (state: ReportsPortalState) => void) {
  const attempts = [0, 50, 150, 300];
  attempts.forEach(delay => {
    window.setTimeout(() => {
      const tab = findAnalysisTab();
      tab?.click();
      tab?.focus({ preventScroll: true });
      findAnalysisPanel()?.scrollIntoView({ block: "start", behavior: "smooth" });
      onRefresh(refreshAnalysisLayout());
    }, delay);
  });
}

export default function ProfessionalAnalyzeTabBridge() {
  const [location] = useLocation();
  const [portalState, setPortalState] = useState<ReportsPortalState>({ mount: null, patientId: null });

  useEffect(() => {
    if (!location.startsWith("/professional")) {
      setPortalState({ mount: null, patientId: null });
      return;
    }

    const scheduleLayoutRefresh = () => window.setTimeout(() => setPortalState(refreshAnalysisLayout()), 0);
    const handleClick = (event: MouseEvent) => {
      if (!findAnalyzeButton(event.target)) return;
      openAnalysisTab(setPortalState);
    };
    const observer = new MutationObserver(scheduleLayoutRefresh);

    scheduleLayoutRefresh();
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("click", handleClick, true);
    document.addEventListener("click", scheduleLayoutRefresh, true);
    document.addEventListener("change", scheduleLayoutRefresh, true);

    return () => {
      observer.disconnect();
      document.removeEventListener("click", handleClick, true);
      document.removeEventListener("click", scheduleLayoutRefresh, true);
      document.removeEventListener("change", scheduleLayoutRefresh, true);
      setPortalState({ mount: null, patientId: null });
    };
  }, [location]);

  if (!location.startsWith("/professional") || !portalState.mount) return null;

  return createPortal(
    <ReportsExperience context="professional" subjectUserId={portalState.patientId} />,
    portalState.mount,
  );
}
