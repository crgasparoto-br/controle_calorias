import React, { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { RefreshCw, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

function formatDate(value: Date | string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export default function BillingUsageLimitationAppeal() {
  const utils = trpc.useUtils();
  const overview = trpc.usageGovernance.myLimitations.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: true,
  });
  const [rationaleByLimitation, setRationaleByLimitation] = useState<Record<string, string>>({});
  const appeal = trpc.usageGovernance.submitLimitationAppeal.useMutation({
    onSuccess: async () => {
      toast.success("Seu recurso foi registrado para revisão administrativa.");
      setRationaleByLimitation({});
      await utils.usageGovernance.myLimitations.invalidate();
    },
    onError: error => toast.error(error.message || "Não foi possível registrar o recurso."),
  });

  if (overview.isLoading) {
    return <div role="status" className="rounded-xl border p-4 text-sm text-muted-foreground">Verificando limitações temporárias...</div>;
  }
  if (overview.isError) {
    return (
      <div role="alert" className="rounded-xl border border-amber-500/30 p-4 text-sm">
        <p>Não foi possível consultar limitações temporárias. Isso não altera seu acesso.</p>
        <Button className="mt-3" size="sm" variant="outline" onClick={() => void overview.refetch()}><RefreshCw className="h-4 w-4" />Tentar novamente</Button>
      </div>
    );
  }

  const limitations = overview.data?.limitations ?? [];
  if (!limitations.length) return null;
  const appeals = overview.data?.appeals ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><ShieldAlert className="h-5 w-5" />Uso temporariamente limitado</CardTitle>
        <CardDescription>
          Limitações de fair use atingem apenas operações pesadas relacionadas ao caso. Login, consulta, exportação e registros manuais permanecem disponíveis. Você pode apresentar recurso quando ele tiver sido oferecido.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {limitations.map(item => {
          const itemAppeals = appeals.filter(entry => entry.limitationId === item.id);
          const pendingAppeal = itemAppeals.find(entry => entry.state === "pending");
          const latestAppeal = itemAppeals[0];
          const canAppeal = item.state === "active" && Boolean(item.appealOfferedAt) && !pendingAppeal;
          const rationale = rationaleByLimitation[item.id] ?? "";
          return (
            <article key={item.id} className="rounded-xl border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium">Operações afetadas: {item.operations.join(", ") || "nenhuma operação informada"}</p>
                  <p className="mt-1 text-xs text-muted-foreground">Vigência: {formatDate(item.startsAt)} → {formatDate(item.endsAt)}</p>
                  <p className="mt-1 text-xs text-muted-foreground">Comunicação: {formatDate(item.communicatedAt)} · recurso oferecido: {formatDate(item.appealOfferedAt)}</p>
                </div>
                <div className="flex flex-wrap gap-2"><Badge variant="outline">{item.state}</Badge>{item.emergencySecurity ? <Badge variant="destructive">proteção de segurança 24h</Badge> : null}</div>
              </div>
              {latestAppeal ? (
                <div className="mt-3 rounded-lg bg-muted/30 p-3 text-sm">
                  <p>Recurso: <strong>{latestAppeal.state}</strong>{latestAppeal.result ? ` · resultado ${latestAppeal.result}` : ""}</p>
                  <p className="mt-1 text-xs text-muted-foreground">Enviado em {formatDate(latestAppeal.submittedAt)}{latestAppeal.reviewedAt ? ` · revisado em ${formatDate(latestAppeal.reviewedAt)}` : ""}</p>
                </div>
              ) : null}
              {canAppeal ? (
                <div className="mt-4 space-y-2">
                  <Label htmlFor={`appeal-${item.id}`}>Sua manifestação ou recurso</Label>
                  <Textarea id={`appeal-${item.id}`} value={rationale} onChange={event => setRationaleByLimitation(current => ({ ...current, [item.id]: event.target.value }))} placeholder="Explique por que a limitação deve ser revista." />
                  <Button disabled={appeal.isPending || rationale.trim().length < 3} onClick={() => appeal.mutate({ limitationId: item.id, rationale: rationale.trim() })}>Enviar recurso</Button>
                </div>
              ) : null}
            </article>
          );
        })}
      </CardContent>
    </Card>
  );
}
