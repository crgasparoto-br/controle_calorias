import { useEffect } from "react";
import { useLocation } from "wouter";

const ANALYSIS_TAB_LABEL = "Análise por pessoa acompanhada";
const ANALYZE_BUTTON_LABEL = "Analisar";

function elementText(element: Element) {
  return element.textContent?.replace(/\s+/g, " ").trim() ?? "";
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

    document.addEventListener("click", handleClick, true);
    return () => document.removeEventListener("click", handleClick, true);
  }, [location]);

  return null;
}
