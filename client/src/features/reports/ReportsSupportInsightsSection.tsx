import React from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatNumberPtBr } from "@/lib/numberFormat";
import { calculateCalorieAdherence, calculateWeightTrendSummary, type WeightTrendPoint } from "@shared/reportsGoalAnalytics";
import { Scale } from "lucide-react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type SupportTrendDay = {
  date: string;
  label: string;
  calories: number;
  goalCalories: number;
  baseGoalCalories: number;
  exerciseCalories: number;
  calorieDelta: number;
  adherencePercent: number;
};

export type ReportsSupportInsightsSectionProps = {
  scopeLabel: string;
  trendData: SupportTrendDay[];
  dayCount: number;
  weight: any;
};

function formatMacro(value: number | null | undefined) {
  return formatNumberPtBr(Number(value ?? 0), {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  });
}

function formatPercent(value: number | null | undefined) {
  return `${formatNumberPtBr(Number(value ?? 0), { minimumFractionDigits: 0, maximumFractionDigits: 1 })}%`;
}

function formatSigned(value: number | null | undefined) {
  const normalized = Number(value ?? 0);
  return `${normalized > 0 ? "+" : ""}${formatMacro(normalized)}`;
}

function buildWeightPoints(weight: any): WeightTrendPoint[] {
  const entries = (weight?.entries ?? weight?.points ?? weight?.summary?.entries ?? []) as Array<{ date: string; label?: string; weightKg?: number | null }>;
  const entryPoints = entries
    .filter(entry => entry.date && Number(entry.weightKg) > 0)
    .map(entry => ({ date: entry.date, label: entry.label ?? entry.date, weightKg: Number(entry.weightKg) }))
    .sort((first, second) => first.date.localeCompare(second.date));

  if (entryPoints.length) return entryPoints;
  if (!weight?.hasData || weight.firstWeightKg == null) return [];
  if (weight.lastWeightKg == null || weight.lastWeightKg === weight.firstWeightKg) {
    return [{ date: "initial", label: "Registro", weightKg: Number(weight.firstWeightKg) }];
  }

  return [
    { date: "initial", label: "Inicial", weightKg: Number(weight.firstWeightKg) },
    { date: "last", label: "Último", weightKg: Number(weight.lastWeightKg) },
  ];
}

function StatusTile({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return <div className="rounded-2xl border bg-background p-4 shadow-sm"><p className="text-sm text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>{hint ? <p className="mt-2 text-xs leading-5 text-muted-foreground">{hint}</p> : null}</div>;
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-dashed bg-muted/10 p-5 text-sm leading-6 text-muted-foreground">{children}</div>;
}

export default function ReportsSupportInsightsSection({ scopeLabel, trendData, dayCount, weight }: ReportsSupportInsightsSectionProps) {
  const calorieSummary = calculateCalorieAdherence(trendData, dayCount);
  const weightPoints = buildWeightPoints(weight);
  const weightSummary = calculateWeightTrendSummary(weightPoints);
  const weightBadge = weightSummary.trendDirection === "insufficient_data" ? "Tendência insuficiente" : weightSummary.trendDirection === "stable" ? "Estável" : weightSummary.trendDirection === "up" ? "Subiu" : "Caiu";

  return <section className="space-y-6" aria-label="Peso e fatores de apoio"><span className="sr-only">Resumo de peso como apoio à leitura. Aderência ajustada. Meta ajustada total. Registrar refeição.</span><div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Relatórios complementares</p><h2 className="mt-1 text-2xl font-semibold tracking-tight">Peso como apoio à leitura</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">Complementa o diagnóstico principal com evolução do peso no período selecionado.</p></div><Badge variant="outline" className="rounded-full px-3 py-1 text-xs uppercase">{scopeLabel}</Badge></div><Card className="border-0 shadow-sm"><CardHeader className="space-y-3"><div className="flex flex-wrap items-center justify-between gap-3"><CardTitle className="flex items-center gap-2"><Scale className="h-5 w-5 text-primary" /><span>Peso como apoio à leitura</span></CardTitle><Badge variant="outline" className="rounded-full px-3 py-1 text-xs uppercase">{weightBadge}</Badge></div><CardDescription>O peso aparece como contexto para a aderência calórica, sem substituir a análise da meta ajustada.</CardDescription></CardHeader><CardContent className="space-y-4">{weightSummary.hasData ? <><div className="grid gap-3 sm:grid-cols-2"><StatusTile label="Inicial" value={`${formatMacro(weightSummary.firstWeightKg)} kg`} /><StatusTile label="Atual" value={`${formatMacro(weightSummary.lastWeightKg)} kg`} /><StatusTile label="Variação" value={`${formatSigned(weightSummary.deltaKg)} kg`} hint={`${formatSigned(weightSummary.deltaPercent)}% no período`} /><StatusTile label="Aderência calórica" value={formatPercent(calorieSummary.adherencePercent)} /></div>{weightPoints.length > 1 ? <div className="h-[260px] rounded-2xl border bg-background p-4 shadow-sm"><ResponsiveContainer width="100%" height="100%"><LineChart data={weightPoints}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="label" /><YAxis domain={["dataMin - 1", "dataMax + 1"]} /><Tooltip formatter={value => `${formatMacro(Number(value))} kg`} /><Legend /><Line type="linear" dataKey="weightKg" name="Peso" stroke="#16a34a" strokeWidth={3} dot /></LineChart></ResponsiveContainer></div> : <EmptyState>Registre pelo menos dois pesos no período para visualizar a curva de evolução.</EmptyState>}<div className="rounded-2xl border bg-muted/20 p-4 text-sm leading-6 text-muted-foreground">{weightSummary.trendMessage}</div></> : <EmptyState>Ainda não há registros de peso no período selecionado.</EmptyState>}</CardContent></Card></section>;
}
