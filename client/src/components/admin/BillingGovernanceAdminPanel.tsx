import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { AlertTriangle, BarChart3, ShieldAlert, ShieldCheck } from "lucide-react";
import React, { useMemo, useState } from "react";
import { toast } from "sonner";

function percentFromBps(value: number | null | undefined) {
  if (value == null) return "Indisponível";
  return `${(value / 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
}

function moneyMinor(value: number, currency: string) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency,
  }).format(value / 100);
}

function toIso(value: string) {
  return new Date(value).toISOString();
}

export default function BillingGovernanceAdminPanel() {
  const analytics = trpc.usageGovernance.analytics.useQuery({}, { retry: false });
  const utils = trpc.useUtils();
  const [allowanceUserId, setAllowanceUserId] = useState("");
  const [allowanceUnits, setAllowanceUnits] = useState("100");
  const [allowanceReason, setAllowanceReason] = useState("");
  const [allowanceEndsAt, setAllowanceEndsAt] = useState("");
  const [abuseUserId, setAbuseUserId] = useState("");
  const [abuseSignals, setAbuseSignals] = useState("volume_anomaly,repetitive_heavy_automation");
  const [abuseOperation, setAbuseOperation] = useState("ai_heavy_processing");
  const [legalHoldScopeId, setLegalHoldScopeId] = useState("");
  const [legalHoldReason, setLegalHoldReason] = useState("");

  const grantAllowance = trpc.usageGovernance.grantAllowance.useMutation({
    onSuccess: async () => {
      toast.success("Franquia temporária registrada sem gerar cobrança.");
      setAllowanceReason("");
      await utils.usageGovernance.analytics.invalidate();
    },
    onError: error => toast.error(error.message || "Não foi possível registrar a franquia."),
  });

  const openAbuseCase = trpc.usageGovernance.openAbuseCase.useMutation({
    onSuccess: result => toast.success(`Caso de possível abuso aberto: ${result.id}`),
    onError: error => toast.error(error.message || "Não foi possível abrir o caso."),
  });

  const placeLegalHold = trpc.usageGovernance.placeLegalHold.useMutation({
    onSuccess: result => toast.success(`Legal hold registrado: ${result.id}`),
    onError: error => toast.error(error.message || "Não foi possível registrar o legal hold."),
  });

  const thresholds = analytics.data?.policy.fairUse.alertThresholdPercentages ?? [];
  const monthly = analytics.data?.monthlyEconomics ?? [];
  const latestMonths = useMemo(
    () => [...monthly].sort((a, b) => new Date(b.competenceMonth).getTime() - new Date(a.competenceMonth).getTime()).slice(0, 8),
    [monthly]
  );

  const submitAllowance = () => {
    const userId = Number(allowanceUserId);
    const units = Number(allowanceUnits);
    if (!Number.isInteger(userId) || userId <= 0 || !Number.isInteger(units) || units <= 0 || allowanceReason.trim().length < 3 || !allowanceEndsAt) return;
    grantAllowance.mutate({
      subjectType: "user",
      subjectId: String(userId),
      grantType: "additional_units",
      additionalUnits: units,
      reason: allowanceReason.trim(),
      startsAt: new Date().toISOString(),
      endsAt: toIso(allowanceEndsAt),
    });
  };

  const submitAbuseCase = () => {
    const userId = Number(abuseUserId);
    const signals = abuseSignals.split(",").map(item => item.trim()).filter(Boolean) as Array<
      "high_cost" | "volume_anomaly" | "repetitive_heavy_automation" | "client_retry_anomaly" | "account_sharing" | "control_bypass_attempt" | "incompatible_usage_pattern" | "credential_abuse" | "security_risk"
    >;
    if (!Number.isInteger(userId) || userId <= 0 || signals.length === 0 || !abuseOperation.trim()) return;
    openAbuseCase.mutate({
      subjectUserId: userId,
      signals,
      evidence: { affectedOperations: [abuseOperation.trim()] },
    });
  };

  const submitLegalHold = () => {
    if (!legalHoldScopeId.trim() || legalHoldReason.trim().length < 3) return;
    placeLegalHold.mutate({
      scopeType: "user",
      scopeId: legalHoldScopeId.trim(),
      reason: legalHoldReason.trim(),
    });
  };

  return (
    <section className="space-y-6" aria-labelledby="billing-governance-title">
      <Card>
        <CardHeader>
          <CardTitle id="billing-governance-title" className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            Economia e governança de uso
          </CardTitle>
          <CardDescription>
            Visão gerencial para operação do produto. Estes indicadores não constituem escrituração contábil oficial e não alteram plano ou cobrança automaticamente.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {analytics.isError ? (
            <div role="alert" className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4" />
              Não foi possível carregar os indicadores econômicos e de consumo.
            </div>
          ) : null}
          <div className="grid gap-3 md:grid-cols-3">
            <PolicyMetric label="Alertas de orçamento" value={thresholds.length ? thresholds.map(value => `${value}%`).join(" · ") : "Carregando..."} />
            <PolicyMetric label="Retenção detalhada" value={analytics.data ? `${analytics.data.policy.retention.detailedUsageMonths} meses` : "Carregando..."} />
            <PolicyMetric label="Agregados econômicos" value={analytics.data ? `${analytics.data.policy.retention.monthlyEconomicYears} anos` : "Carregando..."} />
          </div>
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                <tr><th className="p-3">Competência</th><th className="p-3">Versão</th><th className="p-3">Receita contratual</th><th className="p-3">Receita líquida econômica</th><th className="p-3">Custo variável</th><th className="p-3">Índice</th><th className="p-3">Faixa</th><th className="p-3">Cobertura</th></tr>
              </thead>
              <tbody className="divide-y">
                {latestMonths.map(row => (
                  <tr key={`${new Date(row.competenceMonth).toISOString()}-${row.payerUserId}-${row.subscriptionId ?? "none"}-${row.currency}`}>
                    <td className="p-3">{new Date(row.competenceMonth).toLocaleDateString("pt-BR", { month: "short", year: "numeric" })}</td>
                    <td className="p-3">{row.versionCode ?? "Sem versão"}</td>
                    <td className="p-3">{moneyMinor(row.recognizedContractRevenueMinor, row.currency)}</td>
                    <td className="p-3">{moneyMinor(row.netEconomicRevenueMinor, row.currency)}</td>
                    <td className="p-3">{(row.variableCostMicros / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 4 })} {row.currency}</td>
                    <td className="p-3">{percentFromBps(row.variableCostRatioBps)}</td>
                    <td className="p-3"><Badge variant="outline">{row.health}</Badge></td>
                    <td className="p-3">{percentFromBps(row.measurementCoverageBps)}</td>
                  </tr>
                ))}
                {!analytics.isLoading && latestMonths.length === 0 ? <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">Sem agregados econômicos no período disponível.</td></tr> : null}
              </tbody>
            </table>
          </div>
          <p className="text-xs leading-5 text-muted-foreground">
            Qualidade e cobertura são exibidas junto aos valores. Custos em moeda incompatível permanecem fora do índice até reconciliação; conteúdo bruto de mensagens, prompts, imagens, áudios e transcrições não faz parte desta visão.
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5" />Franquia temporária</CardTitle><CardDescription>Concede unidades adicionais com vigência e motivo. A ação não cria cobrança.</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            <Field label="Usuário" value={allowanceUserId} onChange={setAllowanceUserId} placeholder="ID do usuário" />
            <Field label="Unidades adicionais" value={allowanceUnits} onChange={setAllowanceUnits} placeholder="100" />
            <div className="space-y-2"><Label htmlFor="allowance-end">Término</Label><Input id="allowance-end" type="datetime-local" value={allowanceEndsAt} onChange={event => setAllowanceEndsAt(event.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="allowance-reason">Motivo</Label><Textarea id="allowance-reason" value={allowanceReason} onChange={event => setAllowanceReason(event.target.value)} placeholder="Justificativa auditável" /></div>
            <Button className="w-full" disabled={grantAllowance.isPending} onClick={submitAllowance}>Registrar franquia</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><ShieldAlert className="h-5 w-5" />Possível abuso</CardTitle><CardDescription>Custo elevado isoladamente não é evidência suficiente. O backend exige sinais combinados e revisão humana antes de limitação normal.</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            <Field label="Usuário" value={abuseUserId} onChange={setAbuseUserId} placeholder="ID do usuário" />
            <Field label="Sinais" value={abuseSignals} onChange={setAbuseSignals} placeholder="volume_anomaly,repetitive_heavy_automation" />
            <Field label="Operação pesada relacionada" value={abuseOperation} onChange={setAbuseOperation} placeholder="ai_heavy_processing" />
            <p className="text-xs leading-5 text-muted-foreground">A limitação posterior permanece limitada a 7 dias; uma extensão exige outro administrador. Proteção emergencial fica limitada a 24 horas e exige risco de segurança comprovado.</p>
            <Button className="w-full" variant="outline" disabled={openAbuseCase.isPending} onClick={submitAbuseCase}>Abrir caso para revisão</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Retenção e legal hold</CardTitle><CardDescription>Suspende a eliminação automática apenas para o escopo documentado, mantendo trilha auditável.</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            <Field label="Usuário" value={legalHoldScopeId} onChange={setLegalHoldScopeId} placeholder="ID do usuário" />
            <div className="space-y-2"><Label htmlFor="legal-hold-reason">Motivo</Label><Textarea id="legal-hold-reason" value={legalHoldReason} onChange={event => setLegalHoldReason(event.target.value)} placeholder="Base e justificativa do legal hold" /></div>
            <Button className="w-full" variant="outline" disabled={placeLegalHold.isPending} onClick={submitLegalHold}>Registrar legal hold</Button>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}

function PolicyMetric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border bg-muted/20 p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-2 font-semibold">{value}</p></div>;
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder: string }) {
  const id = `billing-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return <div className="space-y-2"><Label htmlFor={id}>{label}</Label><Input id={id} value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} /></div>;
}
