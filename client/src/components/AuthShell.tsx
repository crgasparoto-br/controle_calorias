import React, { type ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";

type AuthMetric = {
  label: string;
  value: string;
};

type AuthShellProps = {
  eyebrow: string;
  title: string;
  description: string;
  formTitle: string;
  formDescription: string;
  footer: ReactNode;
  children: ReactNode;
  metrics: AuthMetric[];
};

export default function AuthShell({
  eyebrow,
  title,
  description,
  formTitle,
  formDescription,
  footer,
  children,
  metrics,
}: AuthShellProps) {
  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,rgba(245,247,250,0.98)_0%,rgba(236,242,247,0.95)_100%)] px-4 py-6 sm:px-6 sm:py-10 lg:px-8">
      <div className="mx-auto grid min-h-[calc(100vh-3rem)] w-full max-w-6xl items-stretch gap-6 lg:grid-cols-[1.1fr,0.9fr]">
        <section className="overflow-hidden rounded-[32px] border border-border/70 bg-card px-6 py-8 shadow-sm sm:px-8 sm:py-10 lg:px-10 lg:py-12">
          <div className="max-w-xl space-y-5">
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">{eyebrow}</p>
              <div className="space-y-3">
                <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">{title}</h1>
                <p className="max-w-2xl text-sm leading-7 text-muted-foreground sm:text-base">{description}</p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              {metrics.map(metric => (
                <div key={metric.label} className="rounded-2xl border border-border/70 bg-muted/20 px-4 py-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{metric.label}</p>
                  <p className="mt-2 text-lg font-semibold tracking-tight text-foreground">{metric.value}</p>
                </div>
              ))}
            </div>

            <div className="rounded-[28px] border border-border/70 bg-background/80 p-5 shadow-sm sm:p-6">
              <p className="text-sm font-medium text-foreground">Planejamento em um fluxo mais leve</p>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                A entrada do app agora segue a mesma linha visual do restante da plataforma: leitura mais clara, menos peso visual e melhor adaptação para mobile e desktop.
              </p>
            </div>
          </div>
        </section>

        <Card className="border-border/70 bg-card/95 py-0 shadow-sm backdrop-blur-sm">
          <CardContent className="flex h-full flex-col justify-center p-6 sm:p-8">
            <div className="space-y-2">
              <h2 className="text-2xl font-semibold tracking-tight text-foreground">{formTitle}</h2>
              <p className="text-sm leading-6 text-muted-foreground">{formDescription}</p>
            </div>
            <div className="mt-8">{children}</div>
            <div className="mt-6 text-sm text-muted-foreground">{footer}</div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
