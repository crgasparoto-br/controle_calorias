import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  Info,
  RefreshCw,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import React from "react";

export const professionalLabels = {
  authorization: {
    pending: "Pendente",
    approved: "Aprovada",
    rejected: "Recusada",
    revoked: "Revogada",
  },
  tracking: {
    not_started: "Não iniciado",
    active: "Ativo",
    paused: "Pausado",
    ended: "Encerrado",
  },
  message: {
    draft: "Rascunho",
    pending: "Pendente",
    sent: "Enviada",
    failed: "Falha no envio",
    received: "Recebida",
  },
  severity: {
    urgent: "Urgente",
    attention: "Atenção",
    info: "Informativo",
  },
  origin: {
    professional: "Nutricionista",
    patient: "Paciente",
    ai_suggested: "Sugestão da IA revisada",
    automatic: "Automática para revisão",
  },
  entitlement: {
    professional_dashboard: "Painel profissional",
    professional_portfolio: "Carteira de pacientes",
    professional_record: "Prontuário e acompanhamento",
    professional_messages: "Mensagens profissionais",
    professional_reports: "Relatórios profissionais",
    professional_settings: "Configurações profissionais",
  },
} as const;

export type ProfessionalStatusKind = keyof Pick<
  typeof professionalLabels,
  "authorization" | "tracking" | "message" | "severity"
>;

const statusIcons = {
  authorization: ShieldCheck,
  tracking: Clock3,
  message: Info,
  severity: AlertCircle,
} as const;

const statusClasses: Record<ProfessionalStatusKind, Record<string, string>> = {
  authorization: {
    approved: "border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200",
    pending: "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200",
    rejected: "border-slate-400/50 bg-slate-500/10 text-slate-700 dark:text-slate-200",
    revoked: "border-destructive/40 bg-destructive/10 text-destructive",
  },
  tracking: {
    active: "border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200",
    not_started: "border-blue-500/40 bg-blue-500/10 text-blue-800 dark:text-blue-200",
    paused: "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200",
    ended: "border-slate-400/50 bg-slate-500/10 text-slate-700 dark:text-slate-200",
  },
  message: {
    draft: "border-slate-400/50 bg-slate-500/10 text-slate-700 dark:text-slate-200",
    pending: "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200",
    sent: "border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200",
    failed: "border-destructive/40 bg-destructive/10 text-destructive",
    received: "border-blue-500/40 bg-blue-500/10 text-blue-800 dark:text-blue-200",
  },
  severity: {
    urgent: "border-destructive/40 bg-destructive/10 text-destructive",
    attention: "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200",
    info: "border-blue-500/40 bg-blue-500/10 text-blue-800 dark:text-blue-200",
  },
};

export function professionalLabel(
  kind: keyof typeof professionalLabels,
  value: string
) {
  const labels = professionalLabels[kind] as Record<string, string>;
  return labels[value] ?? "Não informado";
}

export function ProfessionalStatusBadge({
  kind,
  value,
}: {
  kind: ProfessionalStatusKind;
  value: string | null | undefined;
}) {
  const Icon = statusIcons[kind];
  const normalized = value ?? "unknown";
  const className =
    statusClasses[kind][normalized] ??
    "border-border bg-muted text-muted-foreground";
  return (
    <span
      className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${className}`}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="truncate">{professionalLabel(kind, normalized)}</span>
    </span>
  );
}

export function ProfessionalPage({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`mx-auto w-full max-w-[1600px] space-y-6 ${className}`}>
      {children}
    </div>
  );
}

export function ProfessionalPageHeader({
  actions,
  description,
  eyebrow = "Área Profissional",
  title,
}: {
  actions?: React.ReactNode;
  description?: string;
  eyebrow?: string;
  title: string;
}) {
  return (
    <header className="flex min-w-0 flex-col gap-4 border-b pb-5 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0 max-w-4xl">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
          {eyebrow}
        </p>
        <h1 className="mt-1 break-words text-2xl font-semibold tracking-tight sm:text-3xl">
          {title}
        </h1>
        {description ? (
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </header>
  );
}

export function ProfessionalSplitLayout({
  aside,
  children,
}: {
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  if (!aside) return <div className="min-w-0">{children}</div>;
  return (
    <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(280px,360px)] xl:items-start">
      <div className="min-w-0">{children}</div>
      <aside className="min-w-0 space-y-4 xl:sticky xl:top-24">{aside}</aside>
    </div>
  );
}

export function ProfessionalAsyncState({
  actionLabel = "Tentar novamente",
  description,
  icon = "error",
  onRetry,
  title,
  variant = "card",
}: {
  actionLabel?: string;
  description: string;
  icon?: "error" | "empty" | "success";
  onRetry?: () => void;
  title: string;
  variant?: "card" | "panel";
}) {
  const Icon =
    icon === "success" ? CheckCircle2 : icon === "empty" ? UserRound : AlertCircle;
  const content = (
    <div className="flex flex-col items-center text-center">
      <Icon className="h-9 w-9 text-muted-foreground" aria-hidden="true" />
      <h2 className="mt-3 font-semibold">{title}</h2>
      <p className="mt-1 max-w-xl text-sm leading-6 text-muted-foreground">
        {description}
      </p>
      {onRetry ? (
        <Button className="mt-4" variant="outline" onClick={onRetry}>
          <RefreshCw className="h-4 w-4" />
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
  if (variant === "panel") {
    return (
      <div role={icon === "error" ? "alert" : "status"} className="rounded-2xl border bg-card p-6">
        {content}
      </div>
    );
  }
  return (
    <Card role={icon === "error" ? "alert" : "status"}>
      <CardContent className="py-10">{content}</CardContent>
    </Card>
  );
}

export function ProfessionalLoadingState({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-2xl border bg-card p-6 text-sm text-muted-foreground"
    >
      {label}
    </div>
  );
}

export function ProfessionalPatientHeader({
  authorizationStatus = "approved",
  displayName,
  lastActivityAt,
  nextReviewAt,
  trackingStatus,
}: {
  authorizationStatus?: string;
  displayName: string;
  lastActivityAt?: number | null;
  nextReviewAt?: number | null;
  trackingStatus?: string | null;
}) {
  const format = (value: number | null | undefined, fallback: string) =>
    value
      ? new Intl.DateTimeFormat("pt-BR", {
          dateStyle: "short",
          timeStyle: "short",
        }).format(new Date(value))
      : fallback;
  return (
    <section
      aria-label="Contexto do paciente"
      className="grid min-w-0 gap-4 rounded-2xl border bg-card p-4 shadow-sm lg:grid-cols-[minmax(0,1.5fr)_repeat(2,minmax(0,1fr))] lg:items-center"
    >
      <div className="min-w-0">
        <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
          Paciente em acompanhamento
        </p>
        <h2 className="mt-1 break-words text-xl font-semibold">{displayName}</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <ProfessionalStatusBadge kind="authorization" value={authorizationStatus} />
          <ProfessionalStatusBadge kind="tracking" value={trackingStatus ?? "not_started"} />
        </div>
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">Última atividade</p>
        <p className="mt-1 break-words text-sm font-medium">
          {format(lastActivityAt, "Não informado")}
        </p>
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">Próxima revisão</p>
        <p className="mt-1 break-words text-sm font-medium">
          {format(nextReviewAt, "Sem revisão agendada")}
        </p>
      </div>
    </section>
  );
}
