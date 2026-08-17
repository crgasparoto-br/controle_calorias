import { Badge } from "@/components/ui/badge";
import { formatCalories, formatCountPtBr } from "@/lib/numberFormat";
import type { FoodQualitySummary, FoodQualityUnclassifiedReason } from "@shared/reportsGoalAnalytics";
import { AlertTriangle, ChevronDown } from "lucide-react";

type FoodQualityUnclassifiedDiagnostic = FoodQualitySummary["unclassifiedItems"][number];

const REASON_LABELS: Record<FoodQualityUnclassifiedReason, string> = {
  missing_catalog_id: "Sem vínculo com catálogo",
  catalog_id_not_found: "Vínculo não encontrado",
  unknown: "Não resolvido",
};

function diagnosticName(item: FoodQualityUnclassifiedDiagnostic) {
  return item.canonicalName ?? item.foodName ?? item.portionText ?? "Alimento sem identificação";
}

function diagnosticContext(item: FoodQualityUnclassifiedDiagnostic) {
  const details = [
    item.foodName && item.foodName !== diagnosticName(item) ? item.foodName : null,
    item.portionText,
    item.foodCatalogId ? `ID catálogo ${item.foodCatalogId}` : null,
  ].filter(Boolean);

  return details.length ? details.join(" · ") : "Sem detalhes adicionais.";
}

function diagnosticDateRange(item: FoodQualityUnclassifiedDiagnostic) {
  if (!item.firstDate && !item.lastDate) return "Sem data";
  if (!item.lastDate || item.firstDate === item.lastDate) return item.firstDate ?? item.lastDate;
  return `${item.firstDate} a ${item.lastDate}`;
}

export default function FoodQualityUnclassifiedDiagnostics({
  items,
  maxItems = 6,
}: {
  items?: FoodQualityUnclassifiedDiagnostic[];
  maxItems?: number;
}) {
  if (!items?.length) return null;

  const visibleItems = items.slice(0, maxItems);
  const hiddenCount = Math.max(items.length - visibleItems.length, 0);

  return (
    <details className="group rounded-2xl border bg-muted/10 p-4">
      <summary className="flex cursor-pointer list-none flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div className="min-w-0">
            <p className="font-medium tracking-tight">Alimentos não classificados</p>
            <p className="mt-1 text-sm leading-5 text-muted-foreground">
              Veja os itens que ainda impactam o percentual de não classificados neste período.
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge variant="outline">{formatCountPtBr(items.length, items.length === 1 ? " grupo" : " grupos")}</Badge>
          <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
        </div>
      </summary>

      <div className="mt-4 space-y-3 border-t pt-4">
        {visibleItems.map(item => (
          <div key={item.key} className="rounded-xl border bg-background p-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="font-medium leading-6">{diagnosticName(item)}</p>
                <p className="mt-1 text-sm leading-5 text-muted-foreground">{diagnosticContext(item)}</p>
              </div>
              <Badge variant="secondary" className="shrink-0">{REASON_LABELS[item.reason]}</Badge>
            </div>
            <div className="mt-3 grid gap-2 text-sm text-muted-foreground sm:grid-cols-3">
              <span>{formatCalories(item.totalCalories)}</span>
              <span>{formatCountPtBr(item.occurrences, item.occurrences === 1 ? " ocorrência" : " ocorrências")}</span>
              <span>{diagnosticDateRange(item)}</span>
            </div>
          </div>
        ))}
        {hiddenCount > 0 ? (
          <p className="text-sm text-muted-foreground">
            Mais {formatCountPtBr(hiddenCount, hiddenCount === 1 ? " grupo" : " grupos")} aparecem no retorno técnico do relatório.
          </p>
        ) : null}
      </div>
    </details>
  );
}
