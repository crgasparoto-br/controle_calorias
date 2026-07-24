import { professionalLabel } from "@/components/professional/ProfessionalUi";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AlertTriangle, BadgeCheck, ShieldCheck } from "lucide-react";
import React from "react";

type OperationalCriterion = {
  key: string;
  label: string;
  description: string;
  value: number;
  configurable: boolean;
};

type EntitlementSnapshot = {
  allowed: boolean;
  mode: "open_access" | "enforced";
  commercialState: string;
  planName: string;
  fallbackUsed: boolean;
  enabledResources: string[];
  capacity: {
    limit: number | null;
    used: number | null;
    usageAvailable: boolean;
  };
};

export function ProfessionalOperationalCriteriaCard({
  criteria,
}: {
  criteria: readonly OperationalCriterion[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Critérios operacionais de alertas</CardTitle>
        <CardDescription>
          Regras objetivas usadas para organizar pendências. Critérios fixos são
          apresentados apenas para consulta.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-2">
        {criteria.map(criterion => (
          <div key={criterion.key} className="min-w-0 rounded-xl border p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="font-medium">{criterion.label}</p>
              <span className="rounded-full border bg-muted px-3 py-1 text-xs">
                {criterion.configurable
                  ? "Configurável"
                  : `Regra atual: ${criterion.value} dias`}
              </span>
            </div>
            <p className="mt-2 break-words text-sm text-muted-foreground">
              {criterion.description}
            </p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function ProfessionalEntitlementSummaryCard({
  entitlements,
}: {
  entitlements: EntitlementSnapshot;
}) {
  const capacityLabel =
    entitlements.capacity.limit === null
      ? "Capacidade disponível não informada"
      : entitlements.capacity.usageAvailable &&
          entitlements.capacity.used !== null
        ? `${entitlements.capacity.used} de ${entitlements.capacity.limit}`
        : `Até ${entitlements.capacity.limit} acompanhamentos`;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Plano e acesso</CardTitle>
        <CardDescription>
          Consulte a disponibilidade atual da Área Profissional e os recursos
          liberados para sua conta.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="min-w-0 rounded-xl border p-4">
            <p className="text-xs text-muted-foreground">Plano atual</p>
            <p className="mt-1 break-words font-semibold">
              {entitlements.planName || "Não informado"}
            </p>
          </div>
          <div className="min-w-0 rounded-xl border p-4">
            <p className="text-xs text-muted-foreground">Capacidade</p>
            <p className="mt-1 break-words font-semibold">{capacityLabel}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {entitlements.capacity.usageAvailable &&
              entitlements.capacity.used !== null
                ? "Acompanhamentos em uso atualmente."
                : "Uso atual não informado."}
            </p>
          </div>
          <div className="min-w-0 rounded-xl border p-4">
            <p className="text-xs text-muted-foreground">Disponibilidade</p>
            <div className="mt-1 flex items-center gap-2 font-semibold">
              {entitlements.allowed ? (
                <BadgeCheck className="h-4 w-4" aria-hidden="true" />
              ) : (
                <AlertTriangle className="h-4 w-4" aria-hidden="true" />
              )}
              {entitlements.allowed ? "Recursos disponíveis" : "Acesso indisponível"}
            </div>
          </div>
        </div>
        <div>
          <p className="mb-2 text-sm font-medium">Recursos disponíveis</p>
          {entitlements.enabledResources.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {entitlements.enabledResources.map(resource => (
                <span
                  key={resource}
                  className="inline-flex max-w-full items-center gap-1 rounded-full border px-3 py-1 text-xs"
                >
                  <ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span className="truncate">
                    {professionalLabel("entitlement", resource)}
                  </span>
                </span>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Nenhum recurso profissional disponível no momento.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function ProfessionalAvailabilityCard({
  active,
  pending,
  onDeactivate,
}: {
  active: boolean;
  pending: boolean;
  onDeactivate: () => void;
}) {
  return (
    <Card className="border-destructive/30">
      <CardHeader>
        <CardTitle>Disponibilidade da Área Profissional</CardTitle>
        <CardDescription>
          Ao desativar, a navegação e novas operações profissionais ficam
          bloqueadas. Vínculos, prontuários, mensagens e histórico são preservados.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button
          variant="destructive"
          disabled={pending || !active}
          onClick={onDeactivate}
        >
          {pending ? "Desativando..." : "Desativar Área Profissional"}
        </Button>
      </CardContent>
    </Card>
  );
}
