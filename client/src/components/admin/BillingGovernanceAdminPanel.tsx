import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { AlertTriangle, BarChart3, RefreshCw, ShieldAlert, ShieldCheck } from "lucide-react";
import React, { useMemo, useState } from "react";
import { toast } from "sonner";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

function percentFromBps(value: number | null | undefined) {
  if (value == null) return "Indisponível";
  return `${(value / 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
}

function moneyMinor(value: number, currency: string) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(value / 100);
}

function toIso(value: string) {
  return new Date(value).toISOString();
}

function formatDate(value: Date | string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function csv(value: string) {
  return value.split(",").map(item => item.trim()).filter(Boolean);
}

export default function BillingGovernanceAdminPanel() {
  const analytics = trpc.usageGovernance.analytics.useQuery({}, { retry: false });
  const overview = trpc.usageGovernance.adminOverview.useQuery({ limit: 100 }, { retry: false });
  const utils = trpc.useUtils();
  const [allowanceUserId, setAllowanceUserId] = useState("");
  const [allowanceUnits, setAllowanceUnits] = useState("100");
  const [allowanceReason, setAllowanceReason] = useState("");
  const [allowanceEndsAt, setAllowanceEndsAt] = useState("");
  const [abuseUserId, setAbuseUserId] = useState("");
  const [abuseSignals, setAbuseSignals] = useState("volume_anomaly,repetitive_heavy_automation");
  const [abuseOperation, setAbuseOperation] = useState("ai_heavy_processing");
  const [securityRiskConfirmed, setSecurityRiskConfirmed] = useState(false);
  const [legalHoldScopeId, setLegalHoldScopeId] = useState("");
  const [legalHoldReason, setLegalHoldReason] = useState("");
  const [caseId, setCaseId] = useState("");
  const [assignedAdminId, setAssignedAdminId] = useState("");
  const [reviewOutcome, setReviewOutcome] = useState<"dismissed" | "limitation_approved">("limitation_approved");
  const [reviewOperations, setReviewOperations] = useState("ai_heavy_processing");
  const [decisionReason, setDecisionReason] = useState("");
  const [emergencySecurity, setEmergencySecurity] = useState(false);

  const refresh = async () => {
    await Promise.all([
      utils.usageGovernance.analytics.invalidate(),
      utils.usageGovernance.adminOverview.invalidate(),
    ]);
  };

  const mutationOptions = (success: string) => ({
    onSuccess: async () => { toast.success(success); await refresh(); },
    onError: (error: { message?: string }) => toast.error(error.message || "Não foi possível concluir a operação."),
  });

  const grantAllowance = trpc.usageGovernance.grantAllowance.useMutation(mutationOptions("Franquia temporária registrada sem gerar cobrança."));
  const openAbuseCase = trpc.usageGovernance.openAbuseCase.useMutation({
    ...mutationOptions("Caso de possível abuso aberto para revisão humana."),
    onSuccess: async result => { setCaseId(result.id); toast.success(`Caso aberto: ${result.id}`); await refresh(); },
  });
  const placeLegalHold = trpc.usageGovernance.placeLegalHold.useMutation(mutationOptions("Legal hold registrado."));
  const revokeLegalHold = trpc.usageGovernance.revokeLegalHold.useMutation(mutationOptions("Legal hold revogado."));
  const assignCase = trpc.usageGovernance.assignAbuseCase.useMutation(mutationOptions("Responsável atribuído ao caso."));
  const reviewCase = trpc.usageGovernance.reviewAbuseCase.useMutation(mutationOptions("Revisão humana registrada."));
  const applyLimitation = trpc.usageGovernance.applyLimitation.useMutation(mutationOptions("Limitação registrada com comunicação e recurso disponíveis."));
  const revokeLimitation = trpc.usageGovernance.revokeLimitation.useMutation(mutationOptions("Limitação revertida antecipadamente."));
  const reviewAppeal = trpc.usageGovernance.reviewLimitationAppeal.useMutation(mutationOptions("Recurso revisado."));
  const reprocessRetention = trpc.usageGovernance.reprocessRetention.useMutation(mutationOptions("Job de retenção reprocessado com trilha auditável."));

  const thresholds = analytics.data?.policy.fairUse.alertThresholdPercentages ?? [];
  const economicRows = overview.data?.economicRows ?? [];
  const selectedCase = overview.data?.abuseCases.find(item => item.id === caseId);
  const selectedLimitations = useMemo(
    () => (overview.data?.limitations ?? []).filter(item => item.abuseCaseId === caseId),
    [overview.data?.limitations, caseId],
  );

  const requireDecisionReason = () => {
    if (decisionReason.trim().length < 3) {
      toast.error("Informe um motivo auditável para a decisão.");
      return false;
    }
    return true;
  };

  const submitAllowance = () => {
    const userId = Number(allowanceUserId);
    const units = Number(allowanceUnits);
    if (!Number.isInteger(userId) || userId <= 0 || !Number.isInteger(units) || units <= 0 || allowanceReason.trim().length < 3 || !allowanceEndsAt) return;
    grantAllowance.mutate({ subjectType: "user", subjectId: String(userId), grantType: "additional_units", additionalUnits: units, reason: allowanceReason.trim(), startsAt: new Date().toISOString(), endsAt: toIso(allowanceEndsAt) });
  };

  const submitAbuseCase = () => {
    const userId = Number(abuseUserId);
    const signals = csv(abuseSignals) as Array<"high_cost" | "volume_anomaly" | "repetitive_heavy_automation" | "client_retry_anomaly" | "account_sharing" | "control_bypass_attempt" | "incompatible_usage_pattern" | "credential_abuse" | "security_risk">;
    const operations = csv(abuseOperation);
    if (!Number.isInteger(userId) || userId <= 0 || signals.length === 0 || operations.length === 0) return;
    openAbuseCase.mutate({
      subjectUserId: userId,
      signals,
      evidence: {
        affectedOperations: operations,
        observedOperation: operations[0],
        ...(securityRiskConfirmed ? { securityRiskConfirmed: true } : {}),
      },
    });
  };

  const submitLegalHold = () => {
    if (!legalHoldScopeId.trim() || legalHoldReason.trim().length < 3) return;
    placeLegalHold.mutate({ scopeType: "user", scopeId: legalHoldScopeId.trim(), reason: legalHoldReason.trim() });
  };

  const submitReview = () => {
    if (!caseId || !requireDecisionReason()) return;
    reviewCase.mutate({
      id: caseId,
      outcome: reviewOutcome,
      reason: decisionReason.trim(),
      systemFailuresExcluded: true,
      legitimateGrowthReviewed: true,
      impact: { affectedOperations: reviewOutcome === "limitation_approved" ? csv(reviewOperations) : [], legitimateGrowthNotes: "Crescimento legítimo revisado pelo administrador." },
    });
  };

  const submitLimitation = () => {
    if (!selectedCase || !requireDecisionReason()) return;
    const operations = csv(reviewOperations);
    if (!operations.length) return;
    const now = new Date();
    const priorNormal = selectedLimitations.find(item => item.state === "active" && !item.emergencySecurity);
    const startsAt = !emergencySecurity && priorNormal?.endsAt ? new Date(priorNormal.endsAt) : now;
    const endsAt = new Date(startsAt.getTime() + (emergencySecurity ? 24 * HOUR_MS : 7 * DAY_MS));
    applyLimitation.mutate({
      abuseCaseId: selectedCase.id,
      subjectUserId: selectedCase.subjectUserId,
      operations,
      reason: decisionReason.trim(),
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      emergencySecurity,
      communicatedAt: now.toISOString(),
      appealOfferedAt: now.toISOString(),
    });
  };

  return (
    <section className="space-y-6" aria-labelledby="billing-governance-title">
      <Card>
        <CardHeader><CardTitle id="billing-governance-title" className="flex items-center gap-2"><BarChart3 className="h-5 w-5" />Economia e governança de uso</CardTitle><CardDescription>Visão gerencial para operação do produto. Não é escrituração contábil oficial; custos financeiros e indiretos ficam separados do índice de custo variável.</CardDescription></CardHeader>
        <CardContent className="space-y-5">
          {analytics.isError || overview.isError ? <div role="alert" className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"><AlertTriangle className="mt-0.5 h-4 w-4" />Não foi possível carregar todos os indicadores administrativos.</div> : null}
          <div className="grid gap-3 md:grid-cols-4"><PolicyMetric label="Alertas de orçamento" value={thresholds.length ? thresholds.map(value => `${value}%`).join(" · ") : "Carregando..."} /><PolicyMetric label="Retenção detalhada" value={analytics.data ? `${analytics.data.policy.retention.detailedUsageMonths} meses` : "Carregando..."} /><PolicyMetric label="Agregados diários" value={analytics.data ? `${analytics.data.policy.retention.dailyAggregateMonths} meses` : "Carregando..."} /><PolicyMetric label="Economia/auditoria" value={analytics.data ? `${analytics.data.policy.retention.monthlyEconomicYears} anos` : "Carregando..."} /></div>
          <div className="overflow-x-auto rounded-xl border"><table className="w-full min-w-[1320px] text-sm"><thead className="bg-muted/40 text-left text-xs text-muted-foreground"><tr><th className="p-3">Competência</th><th className="p-3">Produto/versão</th><th className="p-3">Receita</th><th className="p-3">Descontos/cupons/créditos</th><th className="p-3">Refund/chargeback</th><th className="p-3">Impostos/taxas</th><th className="p-3">Receita líquida</th><th className="p-3">Custo variável</th><th className="p-3">Índice</th><th className="p-3">Média 3m</th><th className="p-3">Financeiro</th><th className="p-3">Cobertura</th></tr></thead><tbody className="divide-y">{economicRows.slice(0, 16).map(row => <tr key={`${new Date(row.competenceMonth).toISOString()}-${row.payerUserId}-${row.subscriptionId ?? "none"}-${row.currency}`}><td className="p-3">{new Date(row.competenceMonth).toLocaleDateString("pt-BR", { month: "short", year: "numeric" })}</td><td className="p-3">{row.productCode ?? "—"}<br/><span className="text-xs text-muted-foreground">{row.versionCode ?? "sem versão"} · {row.billingCycle ?? "—"}</span></td><td className="p-3">{moneyMinor(row.recognizedContractRevenueMinor, row.currency)}</td><td className="p-3">{moneyMinor(row.discountMinor + row.couponMinor + row.creditMinor, row.currency)}</td><td className="p-3">{moneyMinor(row.refundMinor + row.chargebackMinor, row.currency)}</td><td className="p-3">{moneyMinor(row.taxMinor + row.receiptFeeMinor, row.currency)}</td><td className="p-3">{moneyMinor(row.netEconomicRevenueMinor, row.currency)}</td><td className="p-3">{(row.variableCostMicros / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 4 })} {row.currency}</td><td className="p-3">{percentFromBps(row.variableCostRatioBps)}<br/><Badge variant="outline">{row.health}</Badge></td><td className="p-3">{percentFromBps(row.rolling3MonthVariableCostRatioBps)}<br/><Badge variant="outline">{row.rolling3MonthHealth}</Badge></td><td className="p-3">{moneyMinor(row.financialCostMinor, row.currency)}<br/><span className="text-xs text-muted-foreground">indireto não atribuído</span></td><td className="p-3">{percentFromBps(row.measurementCoverageBps)}</td></tr>)}</tbody></table></div>
          <p className="text-xs leading-5 text-muted-foreground">Atingir o orçamento apenas abre alerta/revisão; a política de orçamento, por si só, não altera o acesso. Moedas incompatíveis ficam fora do índice até reconciliação e conteúdo bruto conversacional não é disponibilizado nesta visão.</p>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card><CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5" />Franquia temporária</CardTitle><CardDescription>Unidades adicionais com vigência e motivo, sem gerar cobrança.</CardDescription></CardHeader><CardContent className="space-y-3"><Field label="Usuário" value={allowanceUserId} onChange={setAllowanceUserId} placeholder="ID do usuário" /><Field label="Unidades adicionais" value={allowanceUnits} onChange={setAllowanceUnits} placeholder="100" /><div className="space-y-2"><Label htmlFor="allowance-end">Término</Label><Input id="allowance-end" type="datetime-local" value={allowanceEndsAt} onChange={event => setAllowanceEndsAt(event.target.value)} /></div><div className="space-y-2"><Label htmlFor="allowance-reason">Motivo</Label><Textarea id="allowance-reason" value={allowanceReason} onChange={event => setAllowanceReason(event.target.value)} /></div><Button className="w-full" disabled={grantAllowance.isPending} onClick={submitAllowance}>Registrar franquia</Button></CardContent></Card>
        <Card><CardHeader><CardTitle className="flex items-center gap-2"><ShieldAlert className="h-5 w-5" />Abrir possível abuso</CardTitle><CardDescription>Custo alto isolado não basta. Sinais e operações são sanitizados antes da revisão.</CardDescription></CardHeader><CardContent className="space-y-3"><Field label="Usuário" value={abuseUserId} onChange={setAbuseUserId} placeholder="ID do usuário" /><Field label="Sinais" value={abuseSignals} onChange={setAbuseSignals} placeholder="volume_anomaly,repetitive_heavy_automation" /><Field label="Operações pesadas" value={abuseOperation} onChange={setAbuseOperation} placeholder="ai_heavy_processing" /><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={securityRiskConfirmed} onChange={event => setSecurityRiskConfirmed(event.target.checked)} />Risco de segurança confirmado por evidência técnica</label><Button className="w-full" variant="outline" disabled={openAbuseCase.isPending} onClick={submitAbuseCase}>Abrir caso</Button></CardContent></Card>
        <Card><CardHeader><CardTitle>Retenção e legal hold</CardTitle><CardDescription>Legal hold impede eliminação apenas no escopo documentado.</CardDescription></CardHeader><CardContent className="space-y-3"><Field label="Usuário" value={legalHoldScopeId} onChange={setLegalHoldScopeId} placeholder="ID do usuário" /><div className="space-y-2"><Label htmlFor="legal-hold-reason">Motivo</Label><Textarea id="legal-hold-reason" value={legalHoldReason} onChange={event => setLegalHoldReason(event.target.value)} /></div><Button className="w-full" variant="outline" disabled={placeLegalHold.isPending} onClick={submitLegalHold}>Registrar legal hold</Button></CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Casos, revisão humana e limitação</CardTitle><CardDescription>Selecione um caso para atribuir responsável, revisar evidências e, quando aprovado, limitar somente operações pesadas relacionadas. A extensão normal exige outro administrador no backend.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-4"><div className="space-y-2"><Label htmlFor="case-id">Caso</Label><select id="case-id" className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={caseId} onChange={event => setCaseId(event.target.value)}><option value="">Selecione</option>{overview.data?.abuseCases.map(item => <option key={item.id} value={item.id}>#{item.id.slice(0, 8)} · usuário {item.subjectUserId} · {item.state}</option>)}</select></div><Field label="Responsável admin" value={assignedAdminId} onChange={setAssignedAdminId} placeholder="ID" /><div className="space-y-2"><Label htmlFor="review-outcome">Resultado</Label><select id="review-outcome" className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={reviewOutcome} onChange={event => setReviewOutcome(event.target.value as typeof reviewOutcome)}><option value="limitation_approved">Aprovar limitação</option><option value="dismissed">Descartar caso</option></select></div><Field label="Operações revisadas" value={reviewOperations} onChange={setReviewOperations} placeholder="ai_heavy_processing" /></div>
          <div className="space-y-2"><Label htmlFor="decision-reason">Motivo da decisão/ação</Label><Textarea id="decision-reason" value={decisionReason} onChange={event => setDecisionReason(event.target.value)} placeholder="Justificativa, comunicação ou revisão do recurso" /></div>
          {selectedCase ? <div className="rounded-xl bg-muted/30 p-4 text-sm"><div className="flex flex-wrap gap-2"><Badge variant="outline">{selectedCase.state}</Badge>{selectedCase.signals.map(signal => <Badge key={signal} variant="secondary">{signal}</Badge>)}{selectedCase.assignment ? <Badge>responsável {selectedCase.assignment.assignedToUserId}</Badge> : null}</div><p className="mt-3 text-xs text-muted-foreground">Evidência técnica sanitizada: {Object.entries(selectedCase.evidence).map(([key, value]) => `${key}=${Array.isArray(value) ? value.join("|") : String(value)}`).join(" · ") || "sem campos adicionais"}</p></div> : null}
          <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={!selectedCase || assignCase.isPending} onClick={() => { const assignedToUserId = Number(assignedAdminId); if (!selectedCase || !requireDecisionReason() || !Number.isInteger(assignedToUserId) || assignedToUserId <= 0) return; assignCase.mutate({ caseId: selectedCase.id, assignedToUserId, reason: decisionReason.trim() }); }}>Atribuir responsável</Button><Button variant="outline" disabled={!selectedCase || reviewCase.isPending} onClick={submitReview}>Registrar revisão humana</Button><label className="flex items-center gap-2 rounded-md border px-3 text-sm"><input type="checkbox" checked={emergencySecurity} onChange={event => setEmergencySecurity(event.target.checked)} />Emergência 24h</label><Button disabled={!selectedCase || applyLimitation.isPending} onClick={submitLimitation}>Aplicar/estender limitação</Button></div>
          <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-sm"><thead className="text-left text-xs text-muted-foreground"><tr><th className="p-2">Tipo</th><th className="p-2">Operações</th><th className="p-2">Vigência</th><th className="p-2">Aprovação</th><th className="p-2">Comunicação/recurso</th><th className="p-2">Estado</th><th className="p-2">Ação</th></tr></thead><tbody>{selectedLimitations.map(item => <tr key={item.id} className="border-t"><td className="p-2">{item.lifecycleKind}{item.emergencySecurity ? " · segurança" : ""}</td><td className="p-2">{item.operations.join(", ")}</td><td className="p-2">{formatDate(item.startsAt)} → {formatDate(item.endsAt)}</td><td className="p-2">{item.approvedByUserId}{item.secondApprovedByUserId ? ` / ${item.secondApprovedByUserId}` : ""}</td><td className="p-2">{item.communicatedAt ? "comunicado" : "pendente"} · {item.appealOfferedAt ? "recurso oferecido" : "sem recurso"}</td><td className="p-2"><Badge variant="outline">{item.state}</Badge></td><td className="p-2">{item.state === "active" ? <Button size="sm" variant="outline" disabled={revokeLimitation.isPending} onClick={() => { if (!requireDecisionReason()) return; revokeLimitation.mutate({ id: item.id, reason: decisionReason.trim() }); }}>Reverter</Button> : null}</td></tr>)}</tbody></table></div>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card><CardHeader><CardTitle>Recursos e manifestações</CardTitle><CardDescription>Recursos pendentes são separados da decisão original; aprovação reverte limitações ativas conforme o contrato do backend.</CardDescription></CardHeader><CardContent className="space-y-3">{overview.data?.appeals.map(appeal => <div key={appeal.id} className="rounded-xl border p-3 text-sm"><div className="flex items-center justify-between"><span>Usuário {appeal.subjectUserId}</span><Badge variant="outline">{appeal.state}</Badge></div><p className="mt-2 text-muted-foreground">{appeal.rationale}</p>{appeal.state === "pending" ? <div className="mt-3 flex gap-2"><Button size="sm" disabled={reviewAppeal.isPending} onClick={() => { if (!requireDecisionReason()) return; reviewAppeal.mutate({ appealId: appeal.id, result: "approved", rationale: decisionReason.trim() }); }}>Aprovar recurso</Button><Button size="sm" variant="outline" disabled={reviewAppeal.isPending} onClick={() => { if (!requireDecisionReason()) return; reviewAppeal.mutate({ appealId: appeal.id, result: "denied", rationale: decisionReason.trim() }); }}>Negar recurso</Button></div> : <p className="mt-2 text-xs">Resultado: {appeal.result ?? "—"} · {appeal.reviewRationale ?? "sem observação"}</p>}</div>)}{!overview.isLoading && !overview.data?.appeals.length ? <p className="text-sm text-muted-foreground">Sem recursos registrados.</p> : null}</CardContent></Card>
        <Card><CardHeader><CardTitle>Jobs de retenção</CardTitle><CardDescription>Resultado, falha e reprocessamento permanecem auditáveis. O reprocessamento reutiliza a política vigente e registra sua correlação com a execução original.</CardDescription></CardHeader><CardContent className="space-y-3">{overview.data?.retentionAudits.map(audit => <div key={audit.id} className="rounded-xl border p-3 text-sm"><div className="flex items-center justify-between"><span>{formatDate(audit.runAt)}</span><Badge variant="outline">{audit.status}</Badge></div><p className="mt-1 text-xs text-muted-foreground">detalhe: {formatDate(audit.detailedCutoff)} · diário: {formatDate(audit.dailyCutoff)} · mensal: {formatDate(audit.monthlyCutoff)} · regra {audit.ruleVersion}</p><p className="mt-1 text-xs">{audit.detail ?? "sem detalhe"}</p><Button className="mt-2" size="sm" variant="outline" disabled={reprocessRetention.isPending} onClick={() => { if (!requireDecisionReason()) return; reprocessRetention.mutate({ sourceAuditId: audit.id, reason: decisionReason.trim() }); }}><RefreshCw className="h-4 w-4" />Reprocessar</Button></div>)}{!overview.isLoading && !overview.data?.retentionAudits.length ? <p className="text-sm text-muted-foreground">Nenhuma execução de retenção registrada.</p> : null}</CardContent></Card>
      </div>

      <Card><CardHeader><CardTitle>Legal holds ativos e históricos</CardTitle><CardDescription>O histórico é preservado; revogar um hold não apaga a trilha.</CardDescription></CardHeader><CardContent className="space-y-2">{overview.data?.legalHolds.map(hold => <div key={hold.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3 text-sm"><div><span className="font-medium">{hold.scopeType}:{hold.scopeId}</span><p className="text-xs text-muted-foreground">{hold.reason} · início {formatDate(hold.startsAt)}{hold.endsAt ? ` · fim ${formatDate(hold.endsAt)}` : ""}</p></div>{hold.revokedAt ? <Badge variant="secondary">revogado</Badge> : <Button size="sm" variant="outline" disabled={revokeLegalHold.isPending} onClick={() => { if (!requireDecisionReason()) return; revokeLegalHold.mutate({ id: hold.id, reason: decisionReason.trim() }); }}>Revogar hold</Button>}</div>)}</CardContent></Card>
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
