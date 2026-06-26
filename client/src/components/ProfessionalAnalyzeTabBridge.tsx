import React, { Suspense, lazy, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "wouter";

const ReportsExperience = lazy(() => import("@/features/reports/ReportsExperience"));

const ANALYSIS_TAB_LABEL = "Análise por pessoa acompanhada";
const ANALYSIS_TITLE = "Análise da pessoa acompanhada";
const ANALYSIS_DESCRIPTION = "Escolha uma pessoa autorizada para revisar relatórios, metas, sugestões, IA e comentários. O período dos relatórios fica na aba Relatórios.";
const ANALYZE_BUTTON_LABEL = "Analisar";
const GOAL_SUGGESTION_TITLE = "Sugerir ajuste de meta";
const PERIOD_FILTER_LABELS = ["Dia", "Semana", "Mês", "Período"];
const PERIOD_DETAIL_LABELS = ["Dia ativo", "Semana de referência", "Mês ativo", "Início"];
const SHARED_REPORTS_MOUNT_ATTR = "data-shared-reports-experience";
const GOAL_MACRO_MODE_ATTR = "data-professional-goal-macro-mode";

type ReportsPortalState = {
  mount: HTMLElement | null;
  patientId: number | null;
};

type MacroDefinition = {
  key: "protein" | "carbs" | "fat";
  label: string;
  gramLabel: string;
  caloriesPerGram: number;
};

const EMPTY_PORTAL_STATE: ReportsPortalState = { mount: null, patientId: null };
const MACRO_DEFINITIONS: MacroDefinition[] = [
  { key: "protein", label: "Proteínas", gramLabel: "Proteína (g)", caloriesPerGram: 4 },
  { key: "carbs", label: "Carboidratos", gramLabel: "Carboidratos (g)", caloriesPerGram: 4 },
  { key: "fat", label: "Gorduras", gramLabel: "Gorduras (g)", caloriesPerGram: 9 },
];

function elementText(element: Element) {
  return element.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

function isSamePortalState(first: ReportsPortalState, second: ReportsPortalState) {
  return first.mount === second.mount && first.patientId === second.patientId;
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
    if (element.dataset.legacyReportsHidden === "true" && element.style.display === "none") return;
    element.dataset.legacyReportsHidden = "true";
    element.style.display = "none";
  });
}

function ensureSharedReportsMount() {
  const reportsPanel = findReportsTabPanel();
  if (!reportsPanel) return EMPTY_PORTAL_STATE;

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

function findGoalSuggestionBox() {
  const title = Array.from(document.querySelectorAll<HTMLElement>("p, h2, h3, div")).find(element =>
    elementText(element) === GOAL_SUGGESTION_TITLE,
  );
  let current = title?.parentElement ?? null;
  while (current) {
    const text = elementText(current);
    if (text.includes("Justificativa") && text.includes("Enviar sugestão")) return current;
    current = current.parentElement;
  }
  return null;
}

function findLabelInput(container: HTMLElement, labelText: string) {
  return Array.from(container.querySelectorAll<HTMLLabelElement>("label")).find(label =>
    elementText(label).includes(labelText) && label.querySelector("input"),
  ) ?? null;
}

function setNativeInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function roundToOneDecimal(value: number) {
  return Math.round(value * 10) / 10;
}

function readInputNumber(input: HTMLInputElement | null) {
  const value = Number(input?.value ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function calculateMacroPercent(grams: number, calories: number, caloriesPerGram: number) {
  if (calories <= 0) return 0;
  return roundToOneDecimal(((grams * caloriesPerGram) / calories) * 100);
}

function calculateMacroGrams(percent: number, calories: number, caloriesPerGram: number) {
  if (calories <= 0 || percent <= 0) return 0;
  return Math.round((calories * (percent / 100)) / caloriesPerGram);
}

function createModeButton(label: string, mode: "grams" | "percent") {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.goalMacroModeButton = mode;
  button.className = "rounded-xl px-3 py-1.5 text-sm font-medium transition";
  button.textContent = label;
  return button;
}

function getDirectInput(label: HTMLElement) {
  return Array.from(label.children).find((child): child is HTMLInputElement => child instanceof HTMLInputElement) ??
    label.querySelector<HTMLInputElement>("input");
}

function setLabelChildrenVisibility(label: HTMLElement, visible: boolean, percentInput: HTMLInputElement, percentLabel: HTMLElement) {
  Array.from(label.children).forEach(child => {
    if (child === percentInput || child === percentLabel) return;
    (child as HTMLElement).style.display = visible ? "" : "none";
  });
}

function ensurePercentField(label: HTMLElement, macro: MacroDefinition) {
  let percentLabel = label.querySelector<HTMLElement>(`[data-goal-percent-label='${macro.key}']`);
  let percentInput = label.querySelector<HTMLInputElement>(`[data-goal-percent-input='${macro.key}']`);

  if (!percentLabel) {
    percentLabel = document.createElement("span");
    percentLabel.dataset.goalPercentLabel = macro.key;
    percentLabel.className = "text-sm font-medium leading-none";
    percentLabel.textContent = `${macro.label} (%)`;
    label.append(percentLabel);
  }

  if (!percentInput) {
    percentInput = document.createElement("input");
    percentInput.type = "number";
    percentInput.min = "0";
    percentInput.max = "100";
    percentInput.step = "0.1";
    percentInput.dataset.goalPercentInput = macro.key;
    percentInput.className = "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2";
    label.append(percentInput);
  }

  return { percentInput, percentLabel };
}

function enhanceGoalSuggestionMacroMode() {
  const box = findGoalSuggestionBox();
  if (!box) return;

  const caloriesLabel = findLabelInput(box, "Calorias");
  const caloriesInput = caloriesLabel?.querySelector<HTMLInputElement>("input") ?? null;
  const macroFields = MACRO_DEFINITIONS.map(macro => {
    const labelElement = findLabelInput(box, macro.gramLabel);
    return labelElement ? {
      ...macro,
      labelElement,
      gramInput: getDirectInput(labelElement),
      ...ensurePercentField(labelElement, macro),
    } : null;
  });
  if (!caloriesInput || macroFields.some(field => !field?.gramInput)) return;

  const firstMacroLabel = macroFields[0]?.labelElement;
  const macroGrid = firstMacroLabel?.parentElement ?? null;
  if (!macroGrid) return;

  let modePanel = box.querySelector<HTMLElement>(`[${GOAL_MACRO_MODE_ATTR}]`);
  if (!modePanel) {
    modePanel = document.createElement("div");
    modePanel.setAttribute(GOAL_MACRO_MODE_ATTR, "true");
    modePanel.dataset.mode = "grams";
    modePanel.className = "flex items-center rounded-2xl border bg-muted/20 p-3";

    const buttonGroup = document.createElement("div");
    buttonGroup.className = "flex rounded-2xl border bg-background p-1";
    const gramsButton = createModeButton("Gramas", "grams");
    const percentButton = createModeButton("Percentual", "percent");
    buttonGroup.append(gramsButton, percentButton);

    modePanel.append(buttonGroup);
    macroGrid.parentElement?.insertBefore(modePanel, macroGrid);
  }

  const gramsButton = modePanel.querySelector<HTMLButtonElement>("[data-goal-macro-mode-button='grams']");
  const percentButton = modePanel.querySelector<HTMLButtonElement>("[data-goal-macro-mode-button='percent']");
  const percentInputs = macroFields.filter((field): field is NonNullable<typeof field> => Boolean(field));

  const syncPercentInputsFromGrams = () => {
    const calories = readInputNumber(caloriesInput);
    percentInputs.forEach(field => {
      field.percentInput.value = String(calculateMacroPercent(readInputNumber(field.gramInput), calories, field.caloriesPerGram));
    });
  };

  const syncGramInputsFromPercent = () => {
    const calories = readInputNumber(caloriesInput);
    percentInputs.forEach(field => {
      setNativeInputValue(field.gramInput, String(calculateMacroGrams(readInputNumber(field.percentInput), calories, field.caloriesPerGram)));
    });
  };

  const applyMode = (mode: "grams" | "percent") => {
    const previousMode = modePanel.dataset.mode;
    modePanel.dataset.mode = mode;
    if (mode === "percent" && previousMode !== "percent") syncPercentInputsFromGrams();
    percentInputs.forEach(field => {
      setLabelChildrenVisibility(field.labelElement, mode === "grams", field.percentInput, field.percentLabel);
      field.percentInput.hidden = mode !== "percent";
      field.percentLabel.hidden = mode !== "percent";
    });
    gramsButton?.classList.toggle("bg-primary", mode === "grams");
    gramsButton?.classList.toggle("text-primary-foreground", mode === "grams");
    percentButton?.classList.toggle("bg-primary", mode === "percent");
    percentButton?.classList.toggle("text-primary-foreground", mode === "percent");
  };

  if (modePanel.dataset.listenersAttached !== "true") {
    gramsButton?.addEventListener("click", () => applyMode("grams"));
    percentButton?.addEventListener("click", () => {
      applyMode("percent");
      syncGramInputsFromPercent();
    });
    caloriesInput.addEventListener("input", () => {
      if (modePanel?.dataset.mode === "percent") syncGramInputsFromPercent();
    });
    percentInputs.forEach(field => field.percentInput.addEventListener("input", syncGramInputsFromPercent));
    modePanel.dataset.listenersAttached = "true";
  }

  applyMode(modePanel.dataset.mode === "percent" ? "percent" : "grams");
}

function refreshAnalysisLayout() {
  alignPatientSelectorAndCopy();
  movePeriodFilterIntoReportsTab();
  enhanceGoalSuggestionMacroMode();
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
  const [portalState, setPortalState] = useState<ReportsPortalState>(EMPTY_PORTAL_STATE);
  const refreshScheduled = useRef(false);

  useEffect(() => {
    if (!location.startsWith("/professional")) {
      setPortalState(previous => isSamePortalState(previous, EMPTY_PORTAL_STATE) ? previous : EMPTY_PORTAL_STATE);
      return;
    }

    const applyPortalState = (next: ReportsPortalState) => {
      setPortalState(previous => isSamePortalState(previous, next) ? previous : next);
    };
    const scheduleLayoutRefresh = () => {
      if (refreshScheduled.current) return;
      refreshScheduled.current = true;
      window.requestAnimationFrame(() => {
        refreshScheduled.current = false;
        applyPortalState(refreshAnalysisLayout());
      });
    };
    const handleClick = (event: MouseEvent) => {
      if (!findAnalyzeButton(event.target)) return;
      openAnalysisTab(applyPortalState);
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
      refreshScheduled.current = false;
      setPortalState(previous => isSamePortalState(previous, EMPTY_PORTAL_STATE) ? previous : EMPTY_PORTAL_STATE);
    };
  }, [location]);

  if (!location.startsWith("/professional") || !portalState.mount) return null;

  return createPortal(
    <Suspense fallback={null}>
      <ReportsExperience context="professional" subjectUserId={portalState.patientId} />
    </Suspense>,
    portalState.mount,
  );
}
