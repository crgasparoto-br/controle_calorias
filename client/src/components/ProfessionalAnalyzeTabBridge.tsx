import { useEffect } from "react";
import { useLocation } from "wouter";

const ANALYSIS_TAB_LABEL = "Análise por pessoa acompanhada";
const ANALYZE_BUTTON_LABEL = "Analisar";
const REPORTS_TAB_LABEL = "Relatórios";
const PERIOD_FILTER_LABELS = ["Dia", "Semana", "Mês", "Período"];

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
      return text.includes(REPORTS_TAB_LABEL) && text.includes("Consumo total") && text.includes("Macros realizados");
    })
    .sort((a, b) => elementText(a).length - elementText(b).length)[0] ?? null;
}

function findPeriodFilter() {
  const firstButton = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(button =>
    elementText(button) === PERIOD_FILTER_LABELS[0],
  );
  let current = firstButton?.parentElement ?? null;

  while (current) {
    if (PERIOD_FILTER_LABELS.every(label => hasButtonLabel(current!, label))) {
      return current;
    }
    current = current.parentElement;
  }

  return null;
}

function movePeriodFilterIntoReportsTab() {
  const reportsPanel = findReportsTabPanel();
  const periodFilter = findPeriodFilter();

  if (!reportsPanel || !periodFilter || reportsPanel.contains(periodFilter)) return;

  periodFilter.classList.add("w-full");
  reportsPanel.insertBefore(periodFilter, reportsPanel.firstChild);
}

function findAnalyzeButton(target: EventTarget | null) {
  if (!(target instanceof Element)) return null;
  const button = target.closest<HTMLButtonElement>("button");
  if (!button) return null;
  return elementText(button) === ANALYZE_BUTTON_LABEL ? button : null;
}

function openAnalysisTab() {
  const attempts = [0, 50, 150, 300];
  attempts.forEach(delay => {
    window.setTimeout(() => {
      const tab = findAnalysisTab();
      tab?.click();
      tab?.focus({ preventScroll: true });
      findAnalysisPanel()?.scrollIntoView({ block: "start", behavior: "smooth" });
      movePeriodFilterIntoReportsTab();
    }, delay);
  });
}

export default function ProfessionalAnalyzeTabBridge() {
  const [location] = useLocation();

  useEffect(() => {
    if (!location.startsWith("/professional")) return;

    const handleClick = (event: MouseEvent) => {
      if (!findAnalyzeButton(event.target)) return;
      openAnalysisTab();
    };

    const schedulePeriodFilterMove = () => window.setTimeout(movePeriodFilterIntoReportsTab, 0);
    const observer = new MutationObserver(schedulePeriodFilterMove);

    schedulePeriodFilterMove();
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("click", handleClick, true);
    document.addEventListener("click", schedulePeriodFilterMove, true);
    document.addEventListener("change", schedulePeriodFilterMove, true);

    return () => {
      observer.disconnect();
      document.removeEventListener("click", handleClick, true);
      document.removeEventListener("click", schedulePeriodFilterMove, true);
      document.removeEventListener("change", schedulePeriodFilterMove, true);
    };
  }, [location]);

  return null;
}
