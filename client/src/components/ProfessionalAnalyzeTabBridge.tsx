import { useEffect } from "react";
import { useLocation } from "wouter";

const ANALYSIS_TAB_LABEL = "Análise por pessoa acompanhada";
const ANALYZE_BUTTON_LABEL = "Analisar";

function buttonText(element: Element) {
  return element.textContent?.trim() ?? "";
}

function findAnalysisTab() {
  return Array.from(document.querySelectorAll<HTMLButtonElement>("button[role='tab'], button")).find(button =>
    buttonText(button) === ANALYSIS_TAB_LABEL,
  ) ?? null;
}

function isAnalyzeButton(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  const button = target.closest("button");
  return Boolean(button && buttonText(button) === ANALYZE_BUTTON_LABEL);
}

export default function ProfessionalAnalyzeTabBridge() {
  const [location] = useLocation();

  useEffect(() => {
    if (location !== "/professional") return;

    const handleClick = (event: MouseEvent) => {
      if (!isAnalyzeButton(event.target)) return;

      window.setTimeout(() => {
        findAnalysisTab()?.click();
      }, 0);
    };

    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [location]);

  return null;
}
