import { useEffect } from "react";
import { useLocation } from "wouter";

const ANALYSIS_TAB_LABEL = "Análise por pessoa acompanhada";
const ANALYZE_BUTTON_LABEL = "Analisar";

function elementText(element: Element) {
  return element.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

function findAnalysisTab() {
  return Array.from(document.querySelectorAll<HTMLElement>("[role='tab'], button")).find(element =>
    elementText(element).includes(ANALYSIS_TAB_LABEL),
  ) ?? null;
}

function findAnalyzeButton(target: EventTarget | null) {
  if (!(target instanceof Element)) return null;
  const button = target.closest<HTMLButtonElement>("button");
  if (!button) return null;
  return elementText(button).includes(ANALYZE_BUTTON_LABEL) ? button : null;
}

function openAnalysisTab() {
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      findAnalysisTab()?.click();
    });
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
