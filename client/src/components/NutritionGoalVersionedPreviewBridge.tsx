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

type GoalVersion = GoalTarget & {
  weekday?: number;
  startDate?: string | null;
  effectiveFrom?: Date | string | number | null;
  effectiveUntil?: Date | string | number | null;
};

type PreviewDay = GoalTarget & {
  date: string;
  label: string;
  source: "default" | "exception";
  startDate?: string | null;
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

function dateKey(value: Date | string | number | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function dateAtNoon(date: string) {
  return new Date(`${date}T12:00:00Z`);
}

function dateStart(date: string) {
  return new Date(`${date}T00:00:00Z`).getTime();
}

function formatDate(date: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "UTC",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(dateAtNoon(date));
}

function weekdayIndex(date: string) {
  return (dateAtNoon(date).getUTCDay() + 6) % 7;
}

function addDays(date: string, amount: number) {
  const value = dateAtNoon(date);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

function startOfWeek(date: string) {
  return addDays(date, -weekdayIndex(date));
}

function versionStart(version: GoalVersion) {
  return version.startDate ?? dateKey(version.effectiveFrom);
}

function versionMatchesDate(version: GoalVersion, date: string) {
  const start = versionStart(version);
  if (!start) return false;

  const dayStart = dateStart(date);
  const dayEnd = dayStart + 86_400_000;
  const versionEndDate = dateKey(version.effectiveUntil);
  const versionEnd = versionEndDate ? dateStart(versionEndDate) : Number.POSITIVE_INFINITY;

  return dateStart(start) < dayEnd && versionEnd > dayStart;
}

function latestVersion(versions: GoalVersion[], date: string, weekday?: number) {
  return versions
    .filter(version => (weekday === undefined || version.weekday === weekday) && versionMatchesDate(version, date))
    .sort((a, b) => dateStart(versionStart(b) ?? "1970-01-01") - dateStart(versionStart(a) ?? "1970-01-01"))[0];
}

function parsePtBrDate(value: string | null | undefined) {
  const match = value?.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : null;
}

function parseNumber(value: string | null | undefined) {
  if (!value) return 0;
  const parsed = Number(value.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function findPreviewCard() {
  const title = Array.from(document.querySelectorAll("[data-slot='card-title'],h1,h2,h3,p,span"))
    .filter(element => !element.closest("[data-nutrition-goal-versioned-preview='true']"))
    .find(element => element.textContent?.trim() === "Prévia da semana");
  let current = title?.parentElement ?? null;
  while (current && !current.textContent?.includes("Total da Semana")) {
    current = current.parentElement;
  }
  return current as HTMLElement | null;
}

function readOriginalDays(card: HTMLElement): PreviewDay[] {
  const dayCards = Array.from(card.querySelectorAll<HTMLElement>("div.rounded-2xl"))
    .filter(item => item.textContent?.includes("proteína") && !item.textContent?.includes("Total da Semana"));

  return dayCards.map(item => {
    const date = parsePtBrDate(item.querySelector("span")?.textContent);
    const lines = Array.from(item.querySelectorAll("p")).map(line => line.textContent?.trim() ?? "");
    if (!date) return null;
    return {
      date,
      label: lines[0] || WEEKDAY_LABELS[weekdayIndex(date)] || "Dia",
      source: "default" as const,
      calories: parseNumber(lines.find(line => line.toLowerCase().includes("kcal"))),
      proteinGrams: parseNumber(lines.find(line => line.toLowerCase().includes("proteína"))),
      carbsGrams: parseNumber(lines.find(line => line.toLowerCase().includes("carbo"))),
      fatGrams: parseNumber(lines.find(line => line.toLowerCase().includes("gordura"))),
    };
  }).filter((item): item is PreviewDay => Boolean(item));
}

function buildPreviewDays(startDate: string, data: any, originalDays: PreviewDay[]) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return originalDays;

  const weekStart = startOfWeek(startDate);
  const originalsByDate = new Map(originalDays.map(day => [day.date, day]));
  const versions = (data?.versions ?? []) as GoalVersion[];
  const exceptionVersions = (data?.exceptionVersions ?? []) as GoalVersion[];

  return Array.from({ length: 7 }, (_, index) => {
    const date = addDays(weekStart, index);
    const weekday = weekdayIndex(date);
    const exception = latestVersion(exceptionVersions, date, weekday);
    const base = latestVersion(versions, date);
    const version = exception ?? base;
    const original = originalsByDate.get(date);

    if (!version) {
      return original ?? null;
    }

    return {
      date,
      label: original?.label ?? WEEKDAY_LABELS[index] ?? "Dia",
      source: exception ? "exception" : "default",
      startDate: versionStart(version),
      calories: Number(version.calories ?? 0),
      proteinGrams: Number(version.proteinGrams ?? 0),
      carbsGrams: Number(version.carbsGrams ?? 0),
      fatGrams: Number(version.fatGrams ?? 0),
    };
  }).filter((day): day is PreviewDay => Boolean(day));
}

function totals(days: PreviewDay[]) {
  return days.reduce((acc, day) => ({
    calories: acc.calories + day.calories,
    proteinGrams: acc.proteinGrams + day.proteinGrams,
    carbsGrams: acc.carbsGrams + day.carbsGrams,
    fatGrams: acc.fatGrams + day.fatGrams,
  }), { calories: 0, proteinGrams: 0, carbsGrams: 0, fatGrams: 0 });
}

function PreviewCard({ day }: { day: PreviewDay }) {
  return (
    <div className="min-w-0 rounded-2xl border border-l-4 border-l-emerald-500 bg-background p-3">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate font-medium tracking-tight">{day.label}</p>
          <span className="rounded-full bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">{formatDate(day.date)}</span>
        </div>
        <p className="min-h-10 text-sm leading-5 text-foreground">
          {day.source === "exception" ? `Exceção vigente em ${formatDate(day.date)}.` : `Meta vigente em ${formatDate(day.date)}.`}
        </p>
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

function VersionedPreview({ days }: { days: PreviewDay[] }) {
  const total = totals(days);
  const start = days[0]?.date ?? "1970-01-01";
  const end = days[6]?.date ?? start;

  return (
    <div className="space-y-6" data-nutrition-goal-versioned-preview="true">
      <div className="rounded-lg border bg-card text-card-foreground shadow-sm border-0 shadow-sm">
        <div className="flex flex-col space-y-1.5 p-6">
          <h3 className="flex items-center gap-2 text-2xl font-semibold leading-none tracking-tight">
            <CalendarRange className="h-5 w-5 text-primary" />
            Prévia da semana
          </h3>
          <p className="text-sm text-muted-foreground">
            Simulação de {formatDate(start)} a {formatDate(end)}. Cada dia respeita a versão da meta vigente naquela data.
          </p>
        </div>
        <div className="space-y-4 p-6 pt-0">
          <div className="grid auto-cols-[minmax(10rem,1fr)] grid-flow-col gap-3 overflow-x-auto pb-2 xl:grid-flow-row xl:grid-cols-3 xl:overflow-visible xl:pb-0">
            {days.map(day => <PreviewCard key={day.date} day={day} />)}
            <div className="min-w-0 rounded-2xl border border-l-4 border-l-emerald-500 bg-background p-3">
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate font-medium tracking-tight">Total da Semana</p>
                  <span className="rounded-full bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">sem.</span>
                </div>
                <p className="min-h-10 text-sm leading-5 text-foreground">Soma das metas simuladas para a semana de referência.</p>
              </div>
              <div className="mt-3 space-y-1 text-sm text-foreground">
                <p>{formatCalories(total.calories)}</p>
                <p>{formatGrams(total.proteinGrams)} proteína</p>
                <p>{formatGrams(total.carbsGrams)} carbo</p>
                <p>{formatGrams(total.fatGrams)} gordura</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function NutritionGoalVersionedPreviewBridge() {
  const [location] = useLocation();
  const isGoalsPage = location === "/goals";
  const goalQuery = trpc.nutrition.goals.get.useQuery(undefined, { enabled: isGoalsPage });
  const [startDate, setStartDate] = useState("");
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [originalDays, setOriginalDays] = useState<PreviewDay[]>([]);
  const hiddenCard = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isGoalsPage) return;

    const sync = () => {
      const card = findPreviewCard();
      const nextStartDate = document.querySelector<HTMLInputElement>("#goal-start-date")?.value ?? "";
      setStartDate(current => current === nextStartDate ? current : nextStartDate);
      if (!card) return;

      setOriginalDays(readOriginalDays(card));
      if (hiddenCard.current !== card) {
        if (hiddenCard.current) hiddenCard.current.style.display = "";
        hiddenCard.current = card;
        card.style.display = "none";
      }

      let nextHost = card.nextElementSibling as HTMLElement | null;
      if (!nextHost?.dataset.nutritionGoalVersionedPreviewHost) {
        nextHost = document.createElement("div");
        nextHost.dataset.nutritionGoalVersionedPreviewHost = "true";
        card.insertAdjacentElement("afterend", nextHost);
      }
      setHost(current => current === nextHost ? current : nextHost);
    };

    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    sync();
    document.querySelector("#goal-start-date")?.addEventListener("input", sync);

    return () => {
      observer.disconnect();
      document.querySelector("#goal-start-date")?.removeEventListener("input", sync);
      if (hiddenCard.current) hiddenCard.current.style.display = "";
      hiddenCard.current = null;
      setHost(null);
    };
  }, [isGoalsPage]);

  const previewDays = useMemo(
    () => buildPreviewDays(startDate, goalQuery.data, originalDays),
    [goalQuery.data, originalDays, startDate],
  );

  if (!isGoalsPage || !host || previewDays.length !== 7) return null;

  return createPortal(<VersionedPreview days={previewDays} />, host);
}
