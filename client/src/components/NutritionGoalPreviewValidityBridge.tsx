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

type DatedGoal = GoalTarget & {
  date: string;
  source: "default" | "exception";
  startDate?: string | null;
};

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

function setTextIfChanged(element: Element | undefined, value: string) {
  if (element && element.textContent !== value) {
    element.textContent = value;
  }
}

function formatDateKey(dateKey: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "UTC",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(`${dateKey}T12:00:00Z`));
}

function dateKeyToLogicalUtcDate(dateKey: string) {
  return new Date(`${dateKey}T12:00:00Z`);
}

function getUtcWeekdayIndex(date: Date) {
  return (date.getUTCDay() + 6) % 7;
}

function startOfPreviewWeekDateKey(dateKey: string) {
  const value = dateKeyToLogicalUtcDate(dateKey);
  value.setUTCDate(value.getUTCDate() - getUtcWeekdayIndex(value));
  return value.toISOString().slice(0, 10);
}

function addDaysToDateKey(dateKey: string, days: number) {
  const value = dateKeyToLogicalUtcDate(dateKey);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function buildWeekDates(startDate: string) {
  const previewStart = startOfPreviewWeekDateKey(startDate);
  return Array.from({ length: 7 }, (_, index) => addDaysToDateKey(previewStart, index));
}

function formatPreviewMessage(goal: DatedGoal, versionStartDate: string) {
  if (goal.date >= versionStartDate) {
    return goal.source === "exception" ? `Exceção desde ${goal.startDate ? formatDateKey(goal.startDate) : formatDateKey(goal.date)}.` : "Usa a meta padrão.";
  }

  if (goal.source === "exception") {
    return `Exceção vigente em ${formatDateKey(goal.date)}.`;
  }
  return `Meta vigente em ${formatDateKey(goal.date)}.`;
}

function findPreviewCard() {
  const title = Array.from(document.querySelectorAll("h1,h2,h3,p,span"))
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

  setTextIfChanged(calories, formatCalories(goal.calories));
  setTextIfChanged(protein, `${formatGrams(goal.proteinGrams)} proteína`);
  setTextIfChanged(carbs, `${formatGrams(goal.carbsGrams)} carbo`);
  setTextIfChanged(fat, `${formatGrams(goal.fatGrams)} gordura`);
}

function writePreviewMessage(card: HTMLElement, messageText: string) {
  const message = Array.from(card.querySelectorAll("p"))
    .find(line => line.className.includes("min-h-10"));
  setTextIfChanged(message, messageText);
}

function getPreviewDatesFromDom() {
  const previewCard = findPreviewCard();
  if (!previewCard) return [];

  return findDayCards(previewCard)
    .map(card => parsePtBrDateKey(card.querySelector("span")?.textContent))
    .filter((dateKey): dateKey is string => Boolean(dateKey));
}

function buildDatedGoal(date: string, data: any): DatedGoal | null {
  const todayGoal = data?.today?.goal;
  const goalDay = data?.goal?.today;
  const sourceGoal = goalDay ?? todayGoal;
  if (!sourceGoal) return null;

  return {
    date,
    source: goalDay?.source === "exception" ? "exception" : "default",
    startDate: goalDay?.effectiveFrom ? new Date(goalDay.effectiveFrom).toISOString().slice(0, 10) : null,
    calories: Number(sourceGoal.calories ?? 0),
    proteinGrams: Number(sourceGoal.proteinGrams ?? sourceGoal.protein ?? 0),
    carbsGrams: Number(sourceGoal.carbsGrams ?? sourceGoal.carbs ?? 0),
    fatGrams: Number(sourceGoal.fatGrams ?? sourceGoal.fat ?? 0),
  };
}

export default function NutritionGoalPreviewValidityBridge() {
  const [location] = useLocation();
  const isGoalsPage = location === "/goals";
  const [versionStartDate, setVersionStartDate] = useMemo(() => [null, null] as never, []);
  const isApplyingRef = useRef(false);

  const startDateInput = typeof document !== "undefined"
    ? document.querySelector<HTMLInputElement>("#goal-start-date")?.value ?? ""
    : "";
  const previewDates = startDateInput ? buildWeekDates(startDateInput) : [];

  const day1 = trpc.nutrition.dashboard.today.useQuery({ date: previewDates[0] ?? "1970-01-01" }, { enabled: isGoalsPage && Boolean(previewDates[0]) });
  const day2 = trpc.nutrition.dashboard.today.useQuery({ date: previewDates[1] ?? "1970-01-01" }, { enabled: isGoalsPage && Boolean(previewDates[1]) });
  const day3 = trpc.nutrition.dashboard.today.useQuery({ date: previewDates[2] ?? "1970-01-01" }, { enabled: isGoalsPage && Boolean(previewDates[2]) });
  const day4 = trpc.nutrition.dashboard.today.useQuery({ date: previewDates[3] ?? "1970-01-01" }, { enabled: isGoalsPage && Boolean(previewDates[3]) });
  const day5 = trpc.nutrition.dashboard.today.useQuery({ date: previewDates[4] ?? "1970-01-01" }, { enabled: isGoalsPage && Boolean(previewDates[4]) });
  const day6 = trpc.nutrition.dashboard.today.useQuery({ date: previewDates[5] ?? "1970-01-01" }, { enabled: isGoalsPage && Boolean(previewDates[5]) });
  const day7 = trpc.nutrition.dashboard.today.useQuery({ date: previewDates[6] ?? "1970-01-01" }, { enabled: isGoalsPage && Boolean(previewDates[6]) });

  const datedGoals = useMemo(() => [day1, day2, day3, day4, day5, day6, day7]
    .map((query, index) => buildDatedGoal(previewDates[index], query.data))
    .filter((goal): goal is DatedGoal => Boolean(goal)), [day1.data, day2.data, day3.data, day4.data, day5.data, day6.data, day7.data, previewDates.join("|")]);

  useEffect(() => {
    if (!isGoalsPage) return;

    const applyPreviewValidity = () => {
      if (isApplyingRef.current) return;
      const previewCard = findPreviewCard();
      const startDate = (document.querySelector<HTMLInputElement>("#goal-start-date")?.value || "").trim();
      if (!previewCard || !startDate) return;

      const goalsByDate = new Map(datedGoals.map(goal => [goal.date, goal]));
      isApplyingRef.current = true;
      try {
        const total = { calories: 0, proteinGrams: 0, carbsGrams: 0, fatGrams: 0 };

        for (const card of findDayCards(previewCard)) {
          const dateKey = parsePtBrDateKey(card.querySelector("span")?.textContent);
          if (!dateKey) continue;

          const existingGoal = readCardGoal(card);
          const datedGoal = goalsByDate.get(dateKey);
          const appliedGoal = dateKey < startDate && datedGoal ? datedGoal : existingGoal;
          if (!appliedGoal) continue;

          if (dateKey < startDate && datedGoal) {
            writeGoalValues(card, datedGoal);
            writePreviewMessage(card, formatPreviewMessage(datedGoal, startDate));
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
  }, [datedGoals, isGoalsPage]);

  return null;
}
