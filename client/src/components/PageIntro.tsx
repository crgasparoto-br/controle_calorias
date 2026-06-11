import React, { type ReactNode } from "react";
import { cn } from "@/lib/utils";

type PageIntroProps = {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  stats?: ReactNode;
  className?: string;
};

export default function PageIntro({
  eyebrow,
  title,
  description,
  actions,
  stats,
  className,
}: PageIntroProps) {
  const hasHeaderText = Boolean(title || description);

  return (
    <section
      className={cn(
        "overflow-hidden rounded-[28px] border border-border/70 bg-card p-5 shadow-sm sm:p-6",
        className,
      )}
    >
      <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
        <div className="max-w-3xl space-y-3">
          {eyebrow ? (
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
              {eyebrow}
            </p>
          ) : null}
          {hasHeaderText ? (
            <div className="space-y-2">
              {title ? <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">{title}</h1> : null}
              {description ? <p className="text-sm leading-6 text-muted-foreground sm:text-base">{description}</p> : null}
            </div>
          ) : null}
        </div>
        {actions ? (
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
            {actions}
          </div>
        ) : null}
      </div>
      {stats ? <div className="mt-5 rounded-3xl bg-muted/20 p-3 sm:p-4">{stats}</div> : null}
    </section>
  );
}
