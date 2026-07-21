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
        <CardTitle>Critérios da central de alertas</CardTitle>
        <CardDescription>
          A tela mostra apenas critérios realmente suportados pelo avaliador
          central. Regras ainda fixas não podem ser alteradas localmente.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {criteria.map(criterion => (
          <div key={criterion.key} className="rounded-xl border p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="font-medium">{criterion.label}</p>
              <span className="rounded-full bg-muted px-3 py-1 text-xs">
                {criterion.configurable
                  ? "Configurável"
                  : `Regra atual: ${criterion.value} dias`}
              </span>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
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
      ? "Sem limite comercial configurado"
      : entitlements.capacity.usageAvailable &&
          entitlements.capacity.used !== null
        ? `${entitlements.capacity.used} de ${entitlements.capacity.limit}`
        : `Limite contratado: ${entitlements.capacity.limit}`;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Acesso comercial e recursos</CardTitle>
        <CardDescription>
          O backend é a fonte do plano, capacidade e recursos. A interface não
          calcula preços, limites nem elegibilidade.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border p-4">
            <p className="text-xs text-muted-foreground">Situação</p>
            <p className="mt-1 font-semibold">{entitlements.planName}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {entitlements.mode === "open_access"
                ? "Modo aberto de transição"
                : entitlements.commercialState}
            </p>
          </div>
          <div className="rounded-xl border p-4">
            <p className="text-xs text-muted-foreground">Capacidade</p>
            <p className="mt-1 font-semibold">{capacityLabel}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {entitlements.capacity.usageAvailable &&
              entitlements.capacity.used !== null
                ? `${entitlements.capacity.used} acompanhamentos contabilizados pelo billing`
                : "Uso não informado pelo contrato central"}
            </p>
          </div>
          <div className="rounded-xl border p-4">
            <p className="text-xs text-muted-foreground">Avaliação</p>
            <div className="mt-1 flex items-center gap-2 font-semibold">
              {entitlements.allowed ? (
                <BadgeCheck className="h-4 w-4" />
              ) : (
                <AlertTriangle className="h-4 w-4" />
              )}
              {entitlements.allowed ? "Recursos liberados" : "Acesso bloqueado"}
            </div>
            {entitlements.fallbackUsed ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Provider indisponível; fallback do modo aberto aplicado.
              </p>
            ) : null}
          </div>
        </div>
        <div>
          <p className="mb-2 text-sm font-medium">Recursos habilitados</p>
          {entitlements.enabledResources.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {entitlements.enabledResources.map(resource => (
                <span
                  key={resource}
                  className="inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs"
                >
                  <ShieldCheck className="h-3.5 w-3.5" />
                  {resource.replace(/^professional_/, "").replaceAll("_", " ")}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Nenhum recurso profissional liberado pelo contrato atual.
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
          Ao desativar, a navegação e as APIs profissionais ficam bloqueadas.
          Vínculos, prontuários, mensagens e histórico são preservados.
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
