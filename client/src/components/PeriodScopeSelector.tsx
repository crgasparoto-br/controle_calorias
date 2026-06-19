import React, { type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  addDaysToDateValue,
  addMonthsToMonthValue,
  addWeeksToDateValue,
  formatMonthLabel,
  formatRangeLabel,
  getMonthRange,
  getWeekRange,
  normalizeDateRange,
  type PeriodScope,
} from "@/lib/dateRanges";
import { CalendarDays, CalendarRange, ChevronLeft, ChevronRight } from "lucide-react";

type PeriodScopeSelectorProps = {
  scope: PeriodScope;
  onScopeChange: (scope: PeriodScope) => void;
  selectedDay: string;
  onSelectedDayChange: (selectedDay: string) => void;
  selectedMonth: string;
  onSelectedMonthChange: (selectedMonth: string) => void;
  rangeStart: string;
  onRangeStartChange: (rangeStart: string) => void;
  rangeEnd: string;
  onRangeEndChange: (rangeEnd: string) => void;
};

const SCOPE_OPTIONS: Array<{ value: PeriodScope; label: string }> = [
  { value: "day", label: "Dia" },
  { value: "week", label: "Semana" },
  { value: "month", label: "Mês" },
  { value: "range", label: "Período" },
];

const PROFESSIONAL_FILTER_PORTAL_ATTR = "data-professional-period-filter-portal";
const useClientLayoutEffect = typeof window === "undefined" ? React.useEffect : React.useLayoutEffect;

function SelectorShell({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-end gap-3 rounded-3xl border bg-card p-3 shadow-sm">{children}</div>;
}

function RangeBadge({ children }: { children: ReactNode }) {
  return <Badge variant="outline" className="rounded-full px-3 py-1 text-xs text-muted-foreground">{children}</Badge>;
}

function getActiveReportsContent() {
  const activeTrigger = document.querySelector<HTMLElement>('[data-slot="tabs-trigger"][data-state="active"]');
  const activeContent = document.querySelector<HTMLElement>('[data-slot="tabs-content"][data-state="active"]');
  const isReportsTab = activeTrigger?.textContent?.trim() === "Relatórios";

  if (!isReportsTab || !activeContent) return null;
  return activeContent;
}

function ensureProfessionalFilterPortal(activeContent: HTMLElement) {
  const existing = Array.from(activeContent.children).find(child => child.getAttribute(PROFESSIONAL_FILTER_PORTAL_ATTR) === "true") as HTMLElement | undefined;

  if (existing) return existing;

  const portal = document.createElement("div");
  portal.setAttribute(PROFESSIONAL_FILTER_PORTAL_ATTR, "true");
  portal.className = "mb-6";
  activeContent.prepend(portal);

  return portal;
}

function cleanupProfessionalFilterPortals(activeContent?: HTMLElement | null) {
  document.querySelectorAll<HTMLElement>(`[${PROFESSIONAL_FILTER_PORTAL_ATTR}="true"]`).forEach(portal => {
    if (!activeContent || !activeContent.contains(portal)) portal.remove();
  });
}

export function PeriodScopeSelector({
  scope,
  onScopeChange,
  selectedDay,
  onSelectedDayChange,
  selectedMonth,
  onSelectedMonthChange,
  rangeStart,
  onRangeStartChange,
  rangeEnd,
  onRangeEndChange,
}: PeriodScopeSelectorProps) {
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const [hideInsideProfessionalPatientFilter, setHideInsideProfessionalPatientFilter] = React.useState(false);
  const [professionalReportsPortal, setProfessionalReportsPortal] = React.useState<HTMLElement | null>(null);
  const weekRange = getWeekRange(selectedDay);
  const monthRange = getMonthRange(selectedMonth);

  useClientLayoutEffect(() => {
    const root = rootRef.current;
    const parent = root?.parentElement;
    if (!root || !parent) return;

    const hasDirectPatientSelectorSibling = Array.from(parent.children).some(child => {
      if (child === root) return false;
      const childText = child.textContent ?? "";
      return childText.includes("Pessoa acompanhada") && Boolean(child.querySelector("select"));
    });

    if (!hasDirectPatientSelectorSibling) return;

    setHideInsideProfessionalPatientFilter(true);

    const updatePortal = () => {
      const activeContent = getActiveReportsContent();

      if (!activeContent) {
        cleanupProfessionalFilterPortals();
        setProfessionalReportsPortal(null);
        return;
      }

      const portal = ensureProfessionalFilterPortal(activeContent);
      cleanupProfessionalFilterPortals(activeContent);
      setProfessionalReportsPortal(portal);
    };

    updatePortal();

    const observer = new MutationObserver(updatePortal);
    observer.observe(document.body, { attributes: true, attributeFilter: ["data-state"], subtree: true });
    document.addEventListener("click", updatePortal, true);

    return () => {
      observer.disconnect();
      document.removeEventListener("click", updatePortal, true);
      cleanupProfessionalFilterPortals();
    };
  }, []);

  const renderSelector = (ref?: React.Ref<HTMLDivElement>) => (
    <div ref={ref} className="space-y-3" data-period-scope-selector>
      <div className="flex flex-wrap gap-2 rounded-3xl border bg-card p-1 shadow-sm">
        {SCOPE_OPTIONS.map(option => (
          <Button
            key={option.value}
            type="button"
            variant={scope === option.value ? "default" : "ghost"}
            className="rounded-2xl px-4"
            onClick={() => onScopeChange(option.value)}
          >
            {option.label}
          </Button>
        ))}
      </div>

      {scope === "day" ? (
        <SelectorShell>
          <div className="space-y-2">
            <Label htmlFor="period-selector-day" className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-primary" />
              Dia ativo
            </Label>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="icon" className="rounded-full" onClick={() => onSelectedDayChange(addDaysToDateValue(selectedDay, -1))} aria-label="Dia anterior">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Input
                id="period-selector-day"
                type="date"
                value={selectedDay}
                onChange={event => onSelectedDayChange(event.target.value)}
                className="min-w-[10.5rem] sm:w-44"
              />
              <Button type="button" variant="outline" size="icon" className="rounded-full" onClick={() => onSelectedDayChange(addDaysToDateValue(selectedDay, 1))} aria-label="Próximo dia">
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </SelectorShell>
      ) : null}

      {scope === "week" ? (
        <SelectorShell>
          <div className="space-y-2">
            <Label htmlFor="period-selector-week" className="flex items-center gap-2">
              <CalendarRange className="h-4 w-4 text-primary" />
              Semana de referência
            </Label>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="icon" className="rounded-full" onClick={() => onSelectedDayChange(addWeeksToDateValue(selectedDay, -1))} aria-label="Semana anterior">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Input
                id="period-selector-week"
                type="date"
                value={selectedDay}
                onChange={event => onSelectedDayChange(event.target.value)}
                className="min-w-[10.5rem] sm:w-44"
              />
              <Button type="button" variant="outline" size="icon" className="rounded-full" onClick={() => onSelectedDayChange(addWeeksToDateValue(selectedDay, 1))} aria-label="Próxima semana">
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <RangeBadge>{formatRangeLabel(weekRange)}</RangeBadge>
        </SelectorShell>
      ) : null}

      {scope === "month" ? (
        <SelectorShell>
          <div className="space-y-2">
            <Label htmlFor="period-selector-month" className="flex items-center gap-2">
              <CalendarRange className="h-4 w-4 text-primary" />
              Mês ativo
            </Label>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="icon" className="rounded-full" onClick={() => onSelectedMonthChange(addMonthsToMonthValue(selectedMonth, -1))} aria-label="Mês anterior">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Input
                id="period-selector-month"
                type="month"
                value={selectedMonth}
                onChange={event => onSelectedMonthChange(event.target.value)}
                className="min-w-[10.5rem] sm:w-44"
              />
              <Button type="button" variant="outline" size="icon" className="rounded-full" onClick={() => onSelectedMonthChange(addMonthsToMonthValue(selectedMonth, 1))} aria-label="Próximo mês">
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <RangeBadge>{formatMonthLabel(selectedMonth)}</RangeBadge>
          <RangeBadge>{formatRangeLabel(monthRange)}</RangeBadge>
        </SelectorShell>
      ) : null}

      {scope === "range" ? (
        <SelectorShell>
          <div className="space-y-2">
            <Label htmlFor="period-selector-range-start" className="flex items-center gap-2">
              <CalendarRange className="h-4 w-4 text-primary" />
              Início
            </Label>
            <Input
              id="period-selector-range-start"
              type="date"
              value={rangeStart}
              onChange={event => onRangeStartChange(event.target.value)}
              className="min-w-[10.5rem] sm:w-44"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="period-selector-range-end">Fim</Label>
            <Input
              id="period-selector-range-end"
              type="date"
              value={rangeEnd}
              onChange={event => onRangeEndChange(event.target.value)}
              className="min-w-[10.5rem] sm:w-44"
            />
          </div>
          <RangeBadge>{formatRangeLabel(normalizeDateRange(rangeStart, rangeEnd))}</RangeBadge>
        </SelectorShell>
      ) : null}
    </div>
  );

  if (hideInsideProfessionalPatientFilter) {
    return (
      <>
        <div ref={rootRef} className="hidden" aria-hidden="true" />
        {professionalReportsPortal ? createPortal(renderSelector(), professionalReportsPortal) : null}
      </>
    );
  }

  return renderSelector(rootRef);
}
