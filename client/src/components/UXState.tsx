import React, { type ReactNode } from "react";
import { AlertCircle, Inbox, Info, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type UXStateVariant = "empty" | "error" | "info" | "loading";
type IconComponent = React.ComponentType<{ className?: string }>;

type UXStateProps = {
  variant?: UXStateVariant;
  title?: string;
  description: ReactNode;
  actions?: ReactNode;
  icon?: IconComponent;
  compact?: boolean;
  className?: string;
};

const variantStyles: Record<UXStateVariant, string> = {
  empty: "border-dashed bg-muted/20 text-muted-foreground",
  error: "border-amber-200 bg-amber-50/80 text-amber-900",
  info: "border-sky-200 bg-sky-50/80 text-sky-900",
  loading: "bg-muted/20 text-muted-foreground",
};

const iconStyles: Record<UXStateVariant, string> = {
  empty: "bg-muted text-muted-foreground",
  error: "bg-amber-100 text-amber-700",
  info: "bg-sky-100 text-sky-700",
  loading: "bg-muted text-muted-foreground",
};

const defaultIcons: Record<UXStateVariant, IconComponent> = {
  empty: Inbox,
  error: AlertCircle,
  info: Info,
  loading: Loader2,
};

export default function UXState({
  variant = "empty",
  title,
  description,
  actions,
  icon,
  compact = false,
  className,
}: UXStateProps) {
  const StateIcon = icon ?? defaultIcons[variant];

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-2xl border text-sm leading-6",
        compact ? "p-4" : "p-6",
        variantStyles[variant],
        className,
      )}
    >
      <div className={cn("flex shrink-0 items-center justify-center rounded-xl", compact ? "h-9 w-9" : "h-10 w-10", iconStyles[variant])}>
        <StateIcon className={cn("h-5 w-5", variant === "loading" ? "animate-spin" : "")} />
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        {title ? <p className="font-semibold tracking-tight text-foreground">{title}</p> : null}
        <div className="text-sm leading-6 text-muted-foreground">{description}</div>
        {actions ? <div className="flex flex-wrap gap-2 pt-1">{actions}</div> : null}
      </div>
    </div>
  );
}
