import { useEffect, useMemo, useRef } from "react";
import { useLocation } from "wouter";
import { formatCalories, formatGrams } from "@/lib/numberFormat";
import { trpc } from "@/lib/trpc";

type GoalTarget = {
  calories: number;
  proteinGrams: number;
  carbsGrams: number;
  fatGrams: number;
};

type GoalVersion = GoalTarget & {
  id?: number;
  startDate?: string;
  effectiveFrom?: Date | string | number | null;
  effectiveUntil?: Date | string | number | null;
  weekday?: number;
};

type GoalsResponse = {
  versions?: GoalVersion[];
  exceptionVersions?: Array<GoalVersion & { weekday: number }>;
};

function dateKeyFromDateLike(value?: Date | string | number | null) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function parsePtBrDateKey(value: string | null | undefined) {
  const match = value?.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  return `${match[3]}-${match[2]}-${match[1]}`;
}

function parseNumber(value: string | null | undefined) {
  if (!value) return 0;
  const normalized = value
    .replace(/[^\d,.-]/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatPreviewMessage(source: "default" | "exception", startDate?: string | null) {
  if (source === "exception") {
    return `Exceção histórica desde ${startDate ? formatDateKey(startDate) : "data anterior"}.`;
  }
  return "Usa a meta padrão histórica.";
}

function formatDateKey(dateKey: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "UTC",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(`${dateKey}T12:00:00Z`));
}

function versionStartDate(version: GoalVersion) {
  return version.startDate ?? dateKeyFromDateLike(version.effectiveFrom);
}

function isVersionActive(version: GoalVersion, dateKey: string) {
  const startDate = versionStartDate(version);
  const endDate = dateKeyFromDateLike(version.effectiveUntil);
  return Boolean(startDate && startDate <= dateKey && (!endDate || dateKey < endDate));
}

function weekdayFromDateKey(dateKey: string) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  return (date.getUTCDay() + 6) % 7;
}

function sortNewestFirst(first: GoalVersion, second: GoalVersion) {
  return String(versionStartDate(second) ?? "").localeCompare(String(versionStartDate(first) ?? ""));
}

function resolveHistoricalGoal(goal: GoalsResponse, dateKey: string) {
  const weekday = weekdayFromDateKey(dateKey);
  const exception = (goal.exceptionVersions ?? [])
    .filter(version => version.weekday === weekday && isVersionActive(version, dateKey))
    .sort(sortNewestFirst)[0];

  if (exception) {
    return {
      ...exception,
      source: "exception" as const,
      startDate: versionStartDate(exception),
    };
  }

  const defaultGoal = (goal.versions ?? [])
    .filter(version => isVersionActive(version, dateKey))
    .sort(sortNewestFirst)[0];

  if (!defaultGoal) return null;

  return {
    ...defaultGoal,
    source: "default" as const,
    startDate: versionStartDate(defaultGoal),
  };
}

function findPreviewCard() {
  const title = Array.from(document.querySelectorAll("h1,h2,h3,[class*='CardTitle'],p,span"))
    .find(element => element.textContent?.trim() === "Prévia da semana");
  let current = title?.parentElement ?? null;
  while (current && !current.textContent?.includes("Total da Semana")) {
    current = current.parentElement;
  }
  return current;
}

function findDayCards(previewCard: HTMLElement) {
  return Array.from(previewCard.querySelectorAll<HTMLElement>("div.rounded-2xl"))
    .filter(card => card.textContent?.includes("proteína") && !card.textContent?.includes("Total da Semana"));
}

function findTotalCard(previewCard: HTMLElement) {
  return Array.from(previewCard.querySelectorAll<HTMLElement>("div.rounded-2xl"))
    .find(card => card.textContent?.includes("Total da Semana") && card.textContent?.includes("proteína")) ?? null;
}

function readCardGoal(card: HTMLElement): GoalTarget | null {
  const valueLines = Array.from(card.querySelectorAll("p"))
    .map(item => item.textContent?.trim() ?? "")
    .filter(Boolean);
  const calories = valueLines.find(line => line.toLowerCase().includes("kcal"));
  const protein = valueLines.find(line => line.toLowerCase().includes("proteína"));
  const carbs = valueLines.find(line => line.toLowerCase().includes("carbo"));
  const fat = valueLines.find(line => line.toLowerCase().includes("gordura"));
  if (!calories || !protein || !carbs || !fat) return null;

  return {
    calories: parseNumber(calories),
    proteinGrams: parseNumber(protein),
    carbsGrams: parseNumber(carbs),
    fatGrams: parseNumber(fat),
  };
}

function writeGoalValues(card: HTMLElement, goal: GoalTarget) {
  const lines = Array.from(card.querySelectorAll("p"));
  const calories = lines.find(line => line.textContent?.toLowerCase().includes("kcal"));
  const protein = lines.find(line => line.textContent?.toLowerCase().includes("proteína"));
  const carbs = lines.find(line => line.textContent?.toLowerCase().includes("carbo"));
  const fat = lines.find(line => line.textContent?.toLowerCase().includes("gordura"));

  if (calories) calories.textContent = formatCalories(goal.calories);
  if (protein) protein.textContent = `${formatGrams(goal.proteinGrams)} proteína`;
  if (carbs) carbs.textContent = `${formatGrams(goal.carbsGrams)} carbo`;
  if (fat) fat.textContent = `${formatGrams(goal.fatGrams)} gordura`;
}

function writePreviewMessage(card: HTMLElement, source: "default" | "exception", startDate?: string | null) {
  const message = Array.from(card.querySelectorAll("p"))
    .find(line => line.className.includes("min-h-10"));
  if (message) message.textContent = formatPreviewMessage(source, startDate);
}

export default function NutritionGoalPreviewValidityBridge() {
  const [location] = useLocation();
  const isGoalsPage = location === "/goals";
  const goalQuery = trpc.nutrition.goals.get.useQuery(undefined, {
    enabled: isGoalsPage,
  });
  const goal = goalQuery.data as GoalsResponse | undefined;
  const goalSignature = useMemo(() => JSON.stringify(goal ?? null), [goal]);
  const isApplyingRef = useRef(false);

  useEffect(() => {
    if (!isGoalsPage || !goal) return;

    const applyPreviewValidity = () => {
      if (isApplyingRef.current) return;
      const previewCard = findPreviewCard();
      const startDate = (document.querySelector<HTMLInputElement>("#goal-start-date")?.value || "").trim();
      if (!previewCard || !startDate) return;

      isApplyingRef.current = true;
      try {
        const total = { calories: 0, proteinGrams: 0, carbsGrams: 0, fatGrams: 0 };

        for (const card of findDayCards(previewCard)) {
          const dateText = card.querySelector("span")?.textContent;
          const dateKey = parsePtBrDateKey(dateText);
          if (!dateKey) continue;

          const existingGoal = readCardGoal(card);
          const historicalGoal = dateKey < startDate ? resolveHistoricalGoal(goal, dateKey) : null;
          const appliedGoal = historicalGoal ?? existingGoal;
          if (!appliedGoal) continue;

          if (historicalGoal) {
            writeGoalValues(card, historicalGoal);
            writePreviewMessage(card, historicalGoal.source, historicalGoal.startDate);
          }

          total.calories += appliedGoal.calories;
          total.proteinGrams += appliedGoal.proteinGrams;
          total.carbsGrams += appliedGoal.carbsGrams;
          total.fatGrams += appliedGoal.fatGrams;
        }

        const totalCard = findTotalCard(previewCard);
        if (totalCard) writeGoalValues(totalCard, total);
      } finally {
        window.requestAnimationFrame(() => {
          isApplyingRef.current = false;
        });
      }
    };

    const schedule = () => window.requestAnimationFrame(applyPreviewValidity);
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    schedule();

    document.querySelector("#goal-start-date")?.addEventListener("input", schedule);

    return () => {
      observer.disconnect();
      document.querySelector("#goal-start-date")?.removeEventListener("input", schedule);
    };
  }, [goal, goalSignature, isGoalsPage]);

  return null;
}
