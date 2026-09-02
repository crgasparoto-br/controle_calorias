import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { AlertTriangle, RefreshCw, UsersRound } from "lucide-react";
import React, { useMemo, useState } from "react";
import {
  collectEconomicIdentityContext,
  economicMonthWindow,
} from "./billingEconomicIdentity";

function moneyMinor(value: number, currency: string) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(value / 100);
}

function moneyMicros(value: number, currency: string) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency, maximumFractionDigits: 4 }).format(value / 1_000_000);
}

function percentFromBps(value: number | null | undefined) {
  if (value == null) return "Indisponível";
  return `${(value / 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
}

function ids(ids: number[], empty: string) {
  return ids.length ? ids.map(id => `#${id}`).join(", ") : empty;
}

export default function BillingEconomicIdentityPanel() {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [userFilter, setUserFilter] = useState("");
  const [sponsorFilter, setSponsorFilter] = useState("");
  const [productFilter, setProductFilter] = useState("");
  const [versionFilter, setVersionFilter] = useState("");
  const [cycleFilter, setCycleFilter] = useState("");
  const window = useMemo(() => economicMonthWindow(month), [month]);
  const analytics = trpc.usageGovernance.analytics.useQuery(window, { retry: false });
  const economic = trpc.usageGovernance.adminEconomicRows.useQuery({
    month,
    ...(productFilter.trim() ? { productCode: productFilter.trim() } : {}),
    ...(versionFilter.trim() ? { versionCode: versionFilter.trim() } : {}),
    ...(cycleFilter.trim() ? { billingCycle: cycleFilter.trim() } : {}),
  }, { retry: false });

  const rows = useMemo(() => {
    const dimensions = analytics.data?.byDimensions ?? [];
    const userId = Number(userFilter);
    const sponsorId = Number(sponsorFilter);
    return (economic.data?.rows ?? [])
      .map(row => ({
        ...row,
        identity: collectEconomicIdentityContext(
          {
            payerUserId: row.payerUserId,
            productCode: row.productCode,
            versionCode: row.versionCode,
            billingCycle: row.billingCycle,
          },
          dimensions,
        ),
      }))
      .filter(row => {
        if (
          Number.isInteger(userId) && userId > 0 &&
          row.payerUserId !== userId &&
          !row.identity.beneficiaryUserIds.includes(userId)
        ) return false;
        if (
          Number.isInteger(sponsorId) && sponsorId > 0 &&
          !row.identity.sponsorUserIds.includes(sponsorId)
        ) return false;
        return true;
      });
  }, [analytics.data?.byDimensions, economic.data?.rows, sponsorFilter, userFilter]);

  const loading = analytics.isLoading || economic.isLoading;
  const failed = analytics.isError || economic.isError;
  const usageCoverage = analytics.data?.coverage.usage;

  const refresh = async () => {
    await Promise.all([analytics.refetch(), economic.refetch()]);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UsersRound className="h-5 w-5" />
          Economia por identidade comercial
        </CardTitle>
        <CardDescription>
          Relacione os fatos financeiros do pagador com os usuários e patrocinadores observados na telemetria do mesmo período, produto, versão e ciclo. A receita continua atribuída ao contrato/pagador; beneficiários não recebem rateio financeiro implícito.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          <div className="space-y-2">
            <Label htmlFor="economic-identity-month">Competência</Label>
            <Input id="economic-identity-month" type="month" value={month} onChange={event => { if (event.target.value) setMonth(event.target.value); }} />
          </div>
          <FilterField id="economic-identity-user" label="Usuário" value={userFilter} onChange={setUserFilter} placeholder="ID pagador/beneficiário" />
          <FilterField id="economic-identity-sponsor" label="Patrocinador" value={sponsorFilter} onChange={setSponsorFilter} placeholder="ID do patrocinador" />
          <FilterField id="economic-identity-product" label="Produto" value={productFilter} onChange={setProductFilter} placeholder="Código" />
          <FilterField id="economic-identity-version" label="Versão" value={versionFilter} onChange={setVersionFilter} placeholder="Versão" />
          <FilterField id="economic-identity-cycle" label="Ciclo" value={cycleFilter} onChange={setCycleFilter} placeholder="monthly/yearly" />
        </div>

        {usageCoverage ? (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant={usageCoverage.state === "complete" ? "default" : "secondary"}>
              Contexto de uso {usageCoverage.state === "complete" ? "completo" : "parcial"}
            </Badge>
            <span>
              Identidades são derivadas dos agregados diários retidos por {usageCoverage.retentionMonths} meses; fatos econômicos seguem a retenção financeira independente.
            </span>
          </div>
        ) : null}

        {failed ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            <span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4" />Não foi possível carregar a correlação econômica por identidade.</span>
            <Button size="sm" variant="outline" onClick={() => void refresh()}><RefreshCw className="h-4 w-4" />Tentar novamente</Button>
          </div>
        ) : loading ? (
          <div role="status" className="rounded-xl border p-6 text-sm text-muted-foreground">Carregando competência e identidades observadas...</div>
        ) : rows.length ? (
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full min-w-[1540px] text-sm">
              <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="p-3">Competência</th><th className="p-3">Produto / versão / ciclo</th><th className="p-3">Usuário / pagador</th><th className="p-3">Patrocinador</th><th className="p-3">Receita contratual</th><th className="p-3">Descontos / cupons / créditos</th><th className="p-3">Refund / chargeback</th><th className="p-3">Impostos / taxas</th><th className="p-3">Receita líquida</th><th className="p-3">Custo variável</th><th className="p-3">Índice / média 3m</th><th className="p-3">Financeiro</th><th className="p-3">Cobertura</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map(row => (
                  <tr key={`${new Date(row.competenceMonth).toISOString()}-${row.payerUserId}-${row.subscriptionId ?? "none"}-${row.currency}`}>
                    <td className="p-3">{new Date(row.competenceMonth).toLocaleDateString("pt-BR", { month: "short", year: "numeric" })}</td>
                    <td className="p-3">{row.productCode ?? "—"}<br/><span className="text-xs text-muted-foreground">{row.versionCode ?? "sem versão"} · {row.billingCycle ?? "—"}</span></td>
                    <td className="p-3">Pagador #{row.payerUserId}<br/><span className="text-xs text-muted-foreground">Beneficiários observados: {ids(row.identity.beneficiaryUserIds, "nenhum no período")}</span></td>
                    <td className="p-3">{ids(row.identity.sponsorUserIds, "Sem patrocínio observado")}</td>
                    <td className="p-3">{moneyMinor(row.recognizedContractRevenueMinor, row.currency)}</td>
                    <td className="p-3">{moneyMinor(row.discountMinor + row.couponMinor + row.creditMinor, row.currency)}</td>
                    <td className="p-3">{moneyMinor(row.refundMinor + row.chargebackMinor, row.currency)}</td>
                    <td className="p-3">{moneyMinor(row.taxMinor + row.receiptFeeMinor, row.currency)}</td>
                    <td className="p-3">{moneyMinor(row.netEconomicRevenueMinor, row.currency)}</td>
                    <td className="p-3">{moneyMicros(row.variableCostMicros, row.currency)}</td>
                    <td className="p-3">{percentFromBps(row.variableCostRatioBps)}<br/><span className="text-xs text-muted-foreground">3m: {percentFromBps(row.rolling3MonthVariableCostRatioBps)}</span></td>
                    <td className="p-3">{moneyMinor(row.financialCostMinor, row.currency)}<br/><span className="text-xs text-muted-foreground">indireto não atribuído</span></td>
                    <td className="p-3">{percentFromBps(row.measurementCoverageBps)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
            Nenhum fato econômico da amostra administrativa corresponde à competência e aos filtros selecionados.
          </div>
        )}

        <p className="text-xs leading-5 text-muted-foreground">
          A correlação de identidade é contextual: pagador, beneficiário e patrocinador permanecem campos distintos. Quando a telemetria detalhada já estiver fora da janela de retenção, o painel não inventa patrocinador nem redistribui receita histórica.
        </p>
      </CardContent>
    </Card>
  );
}

function FilterField(props: { id: string; label: string; value: string; onChange: (value: string) => void; placeholder: string }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={props.id}>{props.label}</Label>
      <Input id={props.id} value={props.value} onChange={event => props.onChange(event.target.value)} placeholder={props.placeholder} />
    </div>
  );
}
