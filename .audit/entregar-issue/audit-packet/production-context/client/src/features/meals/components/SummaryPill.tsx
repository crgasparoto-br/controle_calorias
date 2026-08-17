import React from "react";

type SummaryPillProps = {
  label: string;
  value: string;
};

const COMPACT_SUMMARY_LABELS = new Set(["Gasto", "Duração"]);

export function SummaryPill({ label, value }: SummaryPillProps) {
  const isCompact = COMPACT_SUMMARY_LABELS.has(label);

  return (
    <div className={isCompact ? "min-w-24 rounded-xl bg-background px-3 py-2 text-center shadow-sm" : "rounded-2xl bg-background p-4 text-center shadow-sm"}>
      <p className={isCompact ? "text-[0.65rem] uppercase tracking-[0.14em] text-muted-foreground" : "text-xs uppercase tracking-[0.22em] text-muted-foreground"}>{label}</p>
      <p className={isCompact ? "mt-1 text-sm font-semibold tracking-tight" : "mt-2 text-lg font-semibold tracking-tight"}>{value}</p>
    </div>
  );
}
