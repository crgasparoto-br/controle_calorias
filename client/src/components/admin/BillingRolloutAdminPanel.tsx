import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { AlertTriangle, PauseCircle, RotateCcw, ShieldCheck, UsersRound } from "lucide-react";
import React, { useMemo, useState } from "react";
import { toast } from "sonner";

const PHASES = [
  "fake", "sandbox", "internal", "pilot_a", "pilot_b", "general_non_blocking",
  "enforced_10", "enforced_25", "enforced_50", "enforced_100",
] as const;
type Phase = (typeof PHASES)[number];

function phaseLabel(value: Phase | string) {
  return ({
    fake: "Simulação",
    sandbox: "Ambiente de testes",
    internal: "Uso interno",
    pilot_a: "Piloto A",
    pilot_b: "Piloto B",
    general_non_blocking: "Geral sem bloqueio",
    enforced_10: "Aplicação gradual 10%",
    enforced_25: "Aplicação gradual 25%",
    enforced_50: "Aplicação gradual 50%",
    enforced_100: "Aplicação para 100%",
  } as Record<string, string>)[value] ?? value;
}

function accessModeLabel(value: string | null | undefined) {
  if (!value) return "—";
  return ({
    open_access: "Acesso aberto",
    enforced: "Regras de acesso aplicadas",
  } as Record<string, string>)[value] ?? value;
}

function severityLabel(value: string) {
  return ({ low: "Baixa", medium: "Média", high: "Alta", critical: "Crítica" } as Record<string, string>)[value] ?? value;
}

function incidentTypeLabel(value: string) {
  return ({
    duplicate_charge: "Cobrança duplicada",
    improper_activation: "Ativação indevida",
    improper_block: "Bloqueio indevido",
    data_loss: "Perda de dados",
    sensitive_exposure: "Exposição de dados sensíveis",
    reconciliation_failure: "Falha na conferência financeira",
    essential_notification_failure: "Falha de comunicação essencial",
    service_degradation: "Degradação operacional",
    security_incident: "Incidente de segurança",
    other: "Outro",
  } as Record<string, string>)[value] ?? value;
}

function formatDate(value: Date | string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export default function BillingRolloutAdminPanel() {
  const utils = trpc.useUtils();
  const overview = trpc.billing.adminRolloutOverview.useQuery(undefined, { retry: false });
  const [phase, setPhase] = useState<Phase>("fake");
  const [reason, setReason] = useState("");
  const [snapshotKey, setSnapshotKey] = useState("");
  const [ruleVersion, setRuleVersion] = useState("v1");
  const [criterion, setCriterion] = useState("");
  const [candidateIds, setCandidateIds] = useState("");
  const [percentage, setPercentage] = useState(100);
  const [reinforced, setReinforced] = useState(false);
  const [decision, setDecision] = useState<"advance" | "hold" | "reject">("hold");
  const [resumeAfterIncident, setResumeAfterIncident] = useState(false);
  const [owners, setOwners] = useState({ product: "", technical: "", billing: "", support: "", authorizer: "" });
  const [evidence, setEvidence] = useState("");
  const [metrics, setMetrics] = useState({ processedWithin5mBps: 9500, reconciledWithin30mBps: 10000, financialDivergenceBps: 0, internalNotificationsPersistedBps: 10000 });
  const [incidentId, setIncidentId] = useState("");
  const [incidentType, setIncidentType] = useState<"duplicate_charge" | "improper_activation" | "improper_block" | "data_loss" | "sensitive_exposure" | "reconciliation_failure" | "essential_notification_failure" | "service_degradation" | "security_incident" | "other">("other");
  const [incidentSeverity, setIncidentSeverity] = useState<"low" | "medium" | "high" | "critical">("medium");
  const [incidentCause, setIncidentCause] = useState("");
  const [incidentImpact, setIncidentImpact] = useState("");

  const parsedCandidateIds = useMemo(() => Array.from(new Set(candidateIds.split(/[\s,;]+/).map(Number).filter(value => Number.isInteger(value) && value > 0))), [candidateIds]);
  const refresh = () => utils.billing.adminRolloutOverview.invalidate();

  const createSnapshot = trpc.billing.adminCreateRolloutSnapshot.useMutation({
    onSuccess: async () => { toast.success("Grupo da etapa registrado."); await refresh(); },
    onError: error => toast.error(error.message),
  });
  const pause = trpc.billing.adminSetRolloutPause.useMutation({
    onSuccess: async (_, variables) => { toast.success(variables.paused ? "Pausa registrada." : "Retomada registrada."); await refresh(); },
    onError: error => toast.error(error.message),
  });
  const rollback = trpc.billing.adminRecordRolloutRollback.useMutation({
    onSuccess: async () => { toast.success("Reversão administrativa para acesso aberto registrada."); await refresh(); },
    onError: error => toast.error(error.message),
  });
  const recordGate = trpc.billing.adminRecordRolloutGateDecision.useMutation({
    onSuccess: async () => { toast.success("Decisão de avanço registrada."); await refresh(); },
    onError: error => toast.error(error.message),
  });
  const recordIncident = trpc.billing.adminRecordRolloutIncident.useMutation({
    onSuccess: async () => { toast.success("Incidente da implantação registrado."); setIncidentId(""); setIncidentCause(""); setIncidentImpact(""); await refresh(); },
    onError: error => toast.error(error.message),
  });

  const commonReason = reason.trim();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5" />Implantação comercial gradual</CardTitle>
        <CardDescription>
          Controle quais grupos recebem as regras comerciais, registre pausas, reversões e decisões de avanço. A progressão é sempre manual e nenhuma ação desta seção cria cobrança ou assinatura.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {overview.isError ? <div role="alert" className="rounded-xl border border-destructive/30 p-4 text-sm text-destructive">Não foi possível consultar a implantação comercial.</div> : null}
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl border p-4"><p className="text-xs text-muted-foreground">Modo de acesso</p><p className="mt-1 font-medium">{accessModeLabel(overview.data?.runtimeAccessMode)}</p></div>
          <div className="rounded-xl border p-4"><p className="text-xs text-muted-foreground">Última etapa aprovada</p><p className="mt-1 font-medium">{phaseLabel(overview.data?.currentApprovedPhase ?? "fake")}</p></div>
          <div className="rounded-xl border p-4"><p className="text-xs text-muted-foreground">Incidentes abertos</p><p className="mt-1 font-medium">{overview.data?.openIncidents.length ?? 0}</p></div>
          <div className="rounded-xl border p-4"><p className="text-xs text-muted-foreground">Progressão</p><p className="mt-1 font-medium">Somente manual</p></div>
        </div>

        <div className="grid gap-6 xl:grid-cols-2">
          <div className="space-y-4 rounded-xl border p-4">
            <div className="flex items-center gap-2"><UsersRound className="h-4 w-4" /><h3 className="font-medium">Definir grupo da etapa</h3></div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2"><Label>Etapa</Label><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={phase} onChange={event => setPhase(event.target.value as Phase)}>{PHASES.map(item => <option key={item} value={item}>{phaseLabel(item)}</option>)}</select></div>
              <div className="space-y-2"><Label>Percentual</Label><Input type="number" min={0} max={100} value={percentage} onChange={event => setPercentage(Number(event.target.value))} /></div>
              <div className="space-y-2"><Label>Identificador do grupo</Label><Input value={snapshotKey} onChange={event => setSnapshotKey(event.target.value)} placeholder="piloto-a-2026-08" /></div>
              <div className="space-y-2"><Label>Versão da regra</Label><Input value={ruleVersion} onChange={event => setRuleVersion(event.target.value)} /></div>
            </div>
            <div className="space-y-2"><Label>Critério de seleção</Label><Input value={criterion} onChange={event => setCriterion(event.target.value)} placeholder="Usuários elegíveis aprovados para a etapa" /></div>
            <div className="space-y-2"><Label>IDs dos usuários candidatos</Label><Textarea rows={3} value={candidateIds} onChange={event => setCandidateIds(event.target.value)} placeholder="101, 102, 103" /><p className="text-xs text-muted-foreground">{parsedCandidateIds.length} candidatos válidos. A ordem informada não altera a seleção.</p></div>
            <div className="space-y-2"><Label>Motivo</Label><Textarea rows={2} value={reason} onChange={event => setReason(event.target.value)} /></div>
            <Button disabled={createSnapshot.isPending || parsedCandidateIds.length === 0 || snapshotKey.trim().length < 3 || criterion.trim().length < 3 || commonReason.length < 3} onClick={() => createSnapshot.mutate({ phase, snapshotKey: snapshotKey.trim(), ruleVersion: ruleVersion.trim(), criterion: criterion.trim(), candidateUserIds: parsedCandidateIds, percentage, reason: commonReason })}>Registrar grupo</Button>
          </div>

          <div className="space-y-4 rounded-xl border p-4">
            <div className="flex items-center gap-2"><AlertTriangle className="h-4 w-4" /><h3 className="font-medium">Pausa e reversão</h3></div>
            <p className="text-sm text-muted-foreground">Pausas e reversões ficam registradas sem apagar o histórico e preservam cobranças, assinaturas, estornos, cancelamentos, capacidade e eventos legítimos. A retomada exige confirmação reforçada.</p>
            <div className="space-y-2"><Label>Etapa afetada</Label><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={phase} onChange={event => setPhase(event.target.value as Phase)}>{PHASES.map(item => <option key={item} value={item}>{phaseLabel(item)}</option>)}</select></div>
            <div className="space-y-2"><Label>Justificativa operacional</Label><Textarea rows={3} value={reason} onChange={event => setReason(event.target.value)} /></div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={reinforced} onChange={event => setReinforced(event.target.checked)} />Confirmação reforçada do administrador</label>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" disabled={pause.isPending || commonReason.length < 3} onClick={() => pause.mutate({ phase, paused: true, scope: "all", reason: commonReason, reinforcedConfirmation: false })}><PauseCircle className="h-4 w-4" />Pausar etapa</Button>
              <Button variant="outline" disabled={pause.isPending || commonReason.length < 3 || !reinforced} onClick={() => pause.mutate({ phase, paused: false, scope: "all", reason: commonReason, reinforcedConfirmation: reinforced })}>Retomar etapa</Button>
              <Button variant="destructive" disabled={rollback.isPending || commonReason.length < 3 || !reinforced} onClick={() => rollback.mutate({ phase, reason: commonReason, pauseCommunications: true, pauseBlocks: true, reinforcedConfirmation: true })}><RotateCcw className="h-4 w-4" />Registrar reversão</Button>
            </div>
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-2">
          <div className="space-y-4 rounded-xl border p-4">
            <div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4" /><h3 className="font-medium">Decisão manual de avanço</h3></div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2"><Label>Decisão</Label><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={decision} onChange={event => setDecision(event.target.value as "advance" | "hold" | "reject")}><option value="hold">Manter etapa</option><option value="advance">Avançar etapa</option><option value="reject">Reprovar etapa</option></select></div>
              <div className="space-y-2"><Label>Etapa avaliada</Label><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={phase} onChange={event => setPhase(event.target.value as Phase)}>{PHASES.map(item => <option key={item} value={item}>{phaseLabel(item)}</option>)}</select></div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {(Object.keys(owners) as Array<keyof typeof owners>).map(key => <div key={key} className="space-y-2"><Label>{({ product: "Produto", technical: "Técnico", billing: "Financeiro/comercial", support: "Suporte", authorizer: "Administrador autorizador" } as Record<string, string>)[key]}</Label><Input value={owners[key]} onChange={event => setOwners(current => ({ ...current, [key]: event.target.value }))} /></div>)}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2"><Label>Processados em até 5 min (%)</Label><Input type="number" min={0} max={100} value={metrics.processedWithin5mBps / 100} onChange={event => setMetrics(current => ({ ...current, processedWithin5mBps: Math.round(Number(event.target.value) * 100) }))} /></div>
              <div className="space-y-2"><Label>Conferidos em até 30 min (%)</Label><Input type="number" min={0} max={100} value={metrics.reconciledWithin30mBps / 100} onChange={event => setMetrics(current => ({ ...current, reconciledWithin30mBps: Math.round(Number(event.target.value) * 100) }))} /></div>
              <div className="space-y-2"><Label>Divergência financeira (%)</Label><Input type="number" min={0} max={100} step="0.01" value={metrics.financialDivergenceBps / 100} onChange={event => setMetrics(current => ({ ...current, financialDivergenceBps: Math.round(Number(event.target.value) * 100) }))} /></div>
              <div className="space-y-2"><Label>Avisos internos registrados (%)</Label><Input type="number" min={0} max={100} value={metrics.internalNotificationsPersistedBps / 100} onChange={event => setMetrics(current => ({ ...current, internalNotificationsPersistedBps: Math.round(Number(event.target.value) * 100) }))} /></div>
            </div>
            <div className="space-y-2"><Label>Evidências (uma por linha)</Label><Textarea rows={3} value={evidence} onChange={event => setEvidence(event.target.value)} /></div>
            <div className="space-y-2"><Label>Motivo da decisão</Label><Textarea rows={2} value={reason} onChange={event => setReason(event.target.value)} /></div>
            <div className="flex flex-wrap gap-4 text-sm"><label className="flex items-center gap-2"><input type="checkbox" checked={resumeAfterIncident} onChange={event => setResumeAfterIncident(event.target.checked)} />Retomada após incidente</label><label className="flex items-center gap-2"><input type="checkbox" checked={reinforced} onChange={event => setReinforced(event.target.checked)} />Confirmação reforçada</label></div>
            <Button disabled={recordGate.isPending || commonReason.length < 3 || Object.values(owners).some(value => value.trim().length < 2) || evidence.trim().length < 3} onClick={() => recordGate.mutate({ phase, decision, reason: commonReason, reinforcedConfirmation: reinforced, resumeAfterIncident, owners, metrics, evidence: evidence.split("\n").map(item => item.trim()).filter(Boolean) })}>Registrar decisão</Button>
          </div>

          <div className="space-y-4 rounded-xl border p-4">
            <div className="flex items-center gap-2"><AlertTriangle className="h-4 w-4" /><h3 className="font-medium">Incidente da implantação</h3></div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2"><Label>Identificador</Label><Input value={incidentId} onChange={event => setIncidentId(event.target.value)} placeholder="INC-2026-001" /></div>
              <div className="space-y-2"><Label>Severidade</Label><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={incidentSeverity} onChange={event => setIncidentSeverity(event.target.value as typeof incidentSeverity)}><option value="low">Baixa</option><option value="medium">Média</option><option value="high">Alta</option><option value="critical">Crítica</option></select></div>
              <div className="space-y-2 sm:col-span-2"><Label>Tipo</Label><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={incidentType} onChange={event => setIncidentType(event.target.value as typeof incidentType)}><option value="duplicate_charge">Cobrança duplicada</option><option value="improper_activation">Ativação indevida</option><option value="improper_block">Bloqueio indevido</option><option value="data_loss">Perda de dados</option><option value="sensitive_exposure">Exposição de dados sensíveis</option><option value="reconciliation_failure">Falha na conferência financeira</option><option value="essential_notification_failure">Falha de comunicação essencial</option><option value="service_degradation">Degradação operacional</option><option value="security_incident">Incidente de segurança</option><option value="other">Outro</option></select></div>
            </div>
            <div className="space-y-2"><Label>Causa</Label><Textarea rows={2} value={incidentCause} onChange={event => setIncidentCause(event.target.value)} /></div>
            <div className="space-y-2"><Label>Impacto</Label><Textarea rows={2} value={incidentImpact} onChange={event => setIncidentImpact(event.target.value)} /></div>
            <Button variant="outline" disabled={recordIncident.isPending || incidentId.trim().length < 3 || incidentCause.trim().length < 3 || incidentImpact.trim().length < 3} onClick={() => recordIncident.mutate({ incidentId: incidentId.trim(), phase, severity: incidentSeverity, type: incidentType, status: "open", affectedUsers: 0, cause: incidentCause.trim(), impact: incidentImpact.trim() })}>Registrar incidente</Button>
            {overview.data?.openIncidents.length ? <div className="space-y-2 border-t pt-4">{overview.data.openIncidents.slice(0, 6).map((item, index) => <div key={`${String(item.incidentId)}-${index}`} className="rounded-lg bg-muted/30 p-3 text-sm"><div className="flex items-center justify-between gap-2"><strong>{String(item.incidentId)}</strong><Badge variant={item.severity === "critical" || item.severity === "high" ? "destructive" : "outline"}>{severityLabel(String(item.severity))}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{incidentTypeLabel(String(item.type))} · {phaseLabel(String(item.phase))}</p></div>)}</div> : null}
          </div>
        </div>

        <div className="space-y-3">
          <h3 className="font-medium">Grupos recentes da implantação</h3>
          {overview.data?.snapshots.length ? <div className="divide-y rounded-xl border">{overview.data.snapshots.slice(0, 8).map((item, index) => <div key={`${String(item.snapshotKey)}-${index}`} className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm"><div><p className="font-medium">{phaseLabel(String(item.phase))} · {String(item.snapshotKey)}</p><p className="text-xs text-muted-foreground">regra {String(item.ruleVersion)} · {Number(item.effectivePopulation ?? 0)}/{Number(item.plannedPopulation ?? 0)} usuários · {formatDate(item.recordedAt as Date | string | null)}</p></div><Badge variant="outline">{Number(item.percentage ?? 0)}%</Badge></div>)}</div> : <p className="text-sm text-muted-foreground">Nenhum grupo foi definido ainda.</p>}
        </div>
      </CardContent>
    </Card>
  );
}
