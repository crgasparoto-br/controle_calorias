import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarRange } from "lucide-react";
import { useLocation } from "wouter";
import { formatCalories, formatGrams } from "@/lib/numberFormat";
import { trpc } from "@/lib/trpc";

type GoalTarget = {
  calories: number;
  proteinGrams: number;
  carbsGrams: number;
  fatGrams: number;
};

type PreviewDay = GoalTarget & {
  date: string;
  label: string;
  message: string;
};

type DatedGoal = GoalTarget & {
  date: string;
  source: "default" | "exception";
  startDate?: string | null;
};

type PeriodGoalDay = {
  date?: string;
  goalCalories?: number;
  goalProtein?: number;
  goalCarbs?: number;
  goalFat?: number;
};

type PeriodBundleSnapshot = {
  daily?: PeriodGoalDay[];
};

const WEEKDAY_LABELS = [
  "Segunda-feira",
  "Terça-feira",
  "Quarta-feira",
  "Quinta-feira",
  "Sexta-feira",
  "Sábado",
  "Domingo",
];

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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return [];
  const previewStart = startOfPreviewWeekDateKey(startDate);
  return Array.from({ length: 7 }, (_, index) => addDaysToDateKey(previewStart, index));
}

function previewMessageFromDatedGoal(goal: DatedGoal) {
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
  return current as HTMLElement | null;
}

function findDayCards(previewCard: HTMLElement) {
  return Array.from(previewCard.querySelectorAll<HTMLElement>("div.rounded-2xl"))
    .filter(card => card.textContent?.includes("proteína") && !card.textContent?.includes("Total da Semana"));
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

function readOriginalPreviewDays(previewCard: HTMLElement): PreviewDay[] {
  return findDayCards(previewCard).map(card => {
    const date = parsePtBrDateKey(card.querySelector("span")?.textContent);
    const goal = readCardGoal(card);
    const label = card.querySelector("p")?.textContent?.trim() ?? "Dia";
    const message = Array.from(card.querySelectorAll("p"))
      .find(line => line.className.includes("min-h-10"))
      ?.textContent?.trim() ?? "Usa a meta padrão.";

    if (!date || !goal) return null;
    return { date, label, message, ...goal };
  }).filter((day): day is PreviewDay => Boolean(day));
}

function buildDatedGoal(date: string | undefined, data: any): DatedGoal | null {
  if (!date) return null;
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

function buildPeriodGoal(date: string, day: PeriodGoalDay | undefined): DatedGoal | null {
  if (!day) return null;
  return {
    date,
    source: "default",
    startDate: null,
    calories: Number(day.goalCalories ?? 0),
    proteinGrams: Number(day.goalProtein ?? 0),
    carbsGrams: Number(day.goalCarbs ?? 0),
    fatGrams: Number(day.goalFat ?? 0),
  };
}

function totalGoals(days: PreviewDay[]) {
  return days.reduce(
    (acc, day) => ({
      calories: acc.calories + day.calories,
      proteinGrams: acc.proteinGrams + day.proteinGrams,
      carbsGrams: acc.carbsGrams + day.carbsGrams,
      fatGrams: acc.fatGrams + day.fatGrams,
    }),
    { calories: 0, proteinGrams: 0, carbsGrams: 0, fatGrams: 0 },
  );
}

function DayPreviewCard({ day }: { day: PreviewDay }) {
  return (
    <div className="min-w-0 rounded-2xl border border-l-4 border-l-emerald-500 bg-background p-3">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate font-medium tracking-tight">{day.label}</p>
          <span className="rounded-full bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">{formatDateKey(day.date)}</span>
        </div>
        <p className="min-h-10 text-sm leading-5 text-foreground">{day.message}</p>
      </div>
      <div className="mt-3 space-y-1 text-sm text-foreground">
        <p>{formatCalories(day.calories)}</p>
        <p>{formatGrams(day.proteinGrams)} proteína</p>
        <p>{formatGrams(day.carbsGrams)} carbo</p>
        <p>{formatGrams(day.fatGrams)} gordura</p>
      </div>
    </div>
  );
}

function TotalPreviewCard({ goal }: { goal: GoalTarget }) {
  return (
    <div className="min-w-0 rounded-2xl border border-l-4 border-l-emerald-500 bg-background p-3">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate font-medium tracking-tight">Total da Semana</p>
          <span className="rounded-full bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">sem.</span>
        </div>
        <p className="min-h-10 text-sm leading-5 text-foreground">Soma das metas simuladas para a semana de referência.</p>
      </div>
      <div className="mt-3 space-y-1 text-sm text-foreground">
        <p>{formatCalories(goal.calories)}</p>
        <p>{formatGrams(goal.proteinGrams)} proteína</p>
        <p>{formatGrams(goal.carbsGrams)} carbo</p>
        <p>{formatGrams(goal.fatGrams)} gordura</p>
      </div>
    </div>
  );
}

function ReplacementPreview({ days, startDate, endDate }: { days: PreviewDay[]; startDate: string; endDate: string }) {
  const totals = totalGoals(days);

  return (
    <div className="space-y-6">
      <div className="rounded-lg border bg-card text-card-foreground shadow-sm border-0 shadow-sm">
        <div className="flex flex-col space-y-1.5 p-6">
          <h3 className="flex items-center gap-2 text-2xl font-semibold leading-none tracking-tight">
            <CalendarRange className="h-5 w-5 text-primary" />
            Prévia da semana
          </h3>
          <p className="text-sm text-muted-foreground">
            Simulação de {formatDateKey(startDate)} a {formatDateKey(endDate)}. Cada dia respeita a meta vigente pela data de validade.
          </p>
        </div>
        <div className="space-y-4 p-6 pt-0">
          <div className="grid auto-cols-[minmax(10rem,1fr)] grid-flow-col gap-3 overflow-x-auto pb-2 xl:grid-flow-row xl:grid-cols-3 xl:overflow-visible xl:pb-0">
            {days.map(day => <DayPreviewCard key={day.date} day={day} />)}
            <TotalPreviewCard goal={totals} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function NutritionGoalPreviewValidityBridge() {
  const [location] = useLocation();
  const isGoalsPage = location === "/goals";
  const [startDateInput, setStartDateInput] = useState("");
  const [portalHost, setPortalHost] = useState<HTMLElement | null>(null);
  const [originalDays, setOriginalDays] = useState<PreviewDay[]>([]);
  const hiddenCardRef = useRef<HTMLElement | null>(null);
  const previewDates = useMemo(() => buildWeekDates(startDateInput), [startDateInput]);
  const periodStartDate = previewDates[0] ?? "1970-01-01";
  const periodEndDate = previewDates[6] ?? "1970-01-01";
  const periodBundle = trpc.nutrition.reports.periodBundle.useQuery(
    { startDate: periodStartDate, endDate: periodEndDate },
    { enabled: isGoalsPage && Boolean(previewDates[0] && previewDates[6]) },
  );

  useEffect(() => {
    if (!isGoalsPage) return;

    const syncPreviewShell = () => {
      const originalCard = findPreviewCard();
      const nextStartDate = (document.querySelector<HTMLInputElement>("#goal-start-date")?.value || "").trim();
      setStartDateInput(current => current === nextStartDate ? current : nextStartDate);

      if (!originalCard) return;
      setOriginalDays(readOriginalPreviewDays(originalCard));

      if (hiddenCardRef.current !== originalCard) {
        if (hiddenCardRef.current) hiddenCardRef.current.style.display = "";
        hiddenCardRef.current = originalCard;
        originalCard.style.display = "none";
      }

      let host = originalCard.nextElementSibling as HTMLElement | null;
      if (!host?.dataset.nutritionGoalPreviewValidityBridge) {
        host = document.createElement("div");
        host.dataset.nutritionGoalPreviewValidityBridge = "true";
        originalCard.insertAdjacentElement("afterend", host);
      }
      setPortalHost(current => current === host ? current : host);
    };

    const observer = new MutationObserver(syncPreviewShell);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    syncPreviewShell();

    document.querySelector("#goal-start-date")?.addEventListener("input", syncPreviewShell);

    return () => {
      observer.disconnect();
      document.querySelector("#goal-start-date")?.removeEventListener("input", syncPreviewShell);
      if (hiddenCardRef.current) hiddenCardRef.current.style.display = "";
      hiddenCardRef.current = null;
      setPortalHost(null);
    };
  }, [isGoalsPage]);

  const day1 = trpc.nutrition.dashboard.today.useQuery({ date: previewDates[0] ?? "1970-01-01" }, { enabled: isGoalsPage && Boolean(previewDates[0]) });
  const day2 = trpc.nutrition.dashboard.today.useQuery({ date: previewDates[1] ?? "1970-01-01" }, { enabled: isGoalsPage && Boolean(previewDates[1]) });
  const day3 = trpc.nutrition.dashboard.today.useQuery({ date: previewDates[2] ?? "1970-01-01" }, { enabled: isGoalsPage && Boolean(previewDates[2]) });
  const day4 = trpc.nutrition.dashboard.today.useQuery({ date: previewDates[3] ?? "1970-01-01" }, { enabled: isGoalsPage && Boolean(previewDates[3]) });
  const day5 = trpc.nutrition.dashboard.today.useQuery({ date: previewDates[4] ?? "1970-01-01" }, { enabled: isGoalsPage && Boolean(previewDates[4]) });
  const day6 = trpc.nutrition.dashboard.today.useQuery({ date: previewDates[5] ?? "1970-01-01" }, { enabled: isGoalsPage && Boolean(previewDates[5]) });
  const day7 = trpc.nutrition.dashboard.today.useQuery({ date: previewDates[6] ?? "1970-01-01" }, { enabled: isGoalsPage && Boolean(previewDates[6]) });

  const datedGoals = useMemo(() => [day1, day2, day3, day4, day5, day6, day7]
    .map((query, index) => buildDatedGoal(previewDates[index], query.data))
    .filter((goal): goal is DatedGoal => Boolean(goal)), [day1.data, day2.data, day3.data, day4.data, day5.data, day6.data, day7.data, previewDates]);

  const periodGoals = useMemo(() => {
    const daily = (periodBundle.data as PeriodBundleSnapshot | undefined)?.daily ?? [];
    const dailyByDate = new Map(daily.map(day => [day.date, day]));
    return previewDates
      .map(date => buildPeriodGoal(date, dailyByDate.get(date)))
      .filter((goal): goal is DatedGoal => Boolean(goal));
  }, [periodBundle.data, previewDates]);

  const previewDays = useMemo(() => {
    const originalByDate = new Map(originalDays.map(day => [day.date, day]));
    const datedByDate = new Map(datedGoals.map(goal => [goal.date, goal]));
    const periodByDate = new Map(periodGoals.map(goal => [goal.date, goal]));

    return previewDates.map((date, index) => {
      const originalDay = originalByDate.get(date);
      const datedGoal = datedByDate.get(date);
      const periodGoal = periodByDate.get(date);
      const validityGoal = periodGoal ?? datedGoal;

      if (validityGoal) {
        return {
          date,
          label: originalDay?.label ?? WEEKDAY_LABELS[index] ?? "Dia",
          message: previewMessageFromDatedGoal(validityGoal),
          calories: validityGoal.calories,
          proteinGrams: validityGoal.proteinGrams,
          carbsGrams: validityGoal.carbsGrams,
          fatGrams: validityGoal.fatGrams,
        };
      }

      return originalDay ?? null;
    }).filter((day): day is PreviewDay => Boolean(day));
  }, [datedGoals, originalDays, periodGoals, previewDates]);

  if (!isGoalsPage || !portalHost || !previewDays.length || !previewDates[0] || !previewDates[6]) return null;

  return createPortal(
    <ReplacementPreview days={previewDays} startDate={previewDates[0]} endDate={previewDates[6]} />,
    portalHost,
  );
}
