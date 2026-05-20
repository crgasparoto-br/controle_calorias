import React, { type ReactNode } from "react";
import { cn } from "@/lib/utils";

type PageIntroProps = {
  eyebrow?: string;
  title: string;
  description: string;
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
  return (
    <section
      className={cn(
        "overflow-hidden rounded-[28px] border border-border/70 bg-[linear-gradient(135deg,rgba(255,255,255,0.98),rgba(248,250,252,0.92))] p-5 shadow-sm sm:p-6",
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
          <div className="space-y-2">
            <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">{title}</h1>
            <p className="text-sm leading-6 text-muted-foreground sm:text-base">{description}</p>
          </div>
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {stats ? <div className="mt-5">{stats}</div> : null}
    </section>
  );
}
