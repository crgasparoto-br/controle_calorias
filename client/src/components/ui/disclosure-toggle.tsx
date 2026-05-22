import React from "react";
import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

type DisclosureToggleProps = {
  expanded: boolean;
  expandedLabel?: string;
  collapsedLabel?: string;
  className?: string;
};

export function DisclosureToggle({
  expanded,
  expandedLabel = "Recolher",
  collapsedLabel = "Expandir",
  className,
}: DisclosureToggleProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold shadow-sm transition-colors",
        expanded
          ? "border border-sky-200 bg-sky-50 text-sky-700"
          : "border border-slate-200 bg-slate-50 text-slate-700",
        className,
      )}
    >
      <span
        className={cn(
          "inline-flex h-5 w-5 items-center justify-center rounded-full",
          expanded ? "bg-sky-100 text-sky-700" : "bg-slate-200 text-slate-700",
        )}
      >
        {expanded ? <Minus className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
      </span>
      {expanded ? expandedLabel : collapsedLabel}
    </span>
  );
}
