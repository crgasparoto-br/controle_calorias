import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCalories, formatGrams } from "@/lib/numberFormat";
import { trpc } from "@/lib/trpc";
import { Check, Target, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { useLocation } from "wouter";

type GoalSuggestion = {
  id: string;
  professionalUserId: number;
  rationale: string;
  status: "draft" | "sent" | "accepted" | "refused" | "cancelled";
  createdAt: number;
  respondedAt: number | null;
  professional?: { displayName?: string | null; registrationNumber?: string | null } | null;
  goal: {
    startDate?: string;
    defaultGoal: {
      calories: number;
      proteinGrams: number;
      carbsGrams: number;
      fatGrams: number;
    };
    exceptions: Array<{
      weekday: number;
      durationType: string;
      startDate?: string;
      calories: number;
      proteinGrams: number;
      carbsGrams: number;
      fatGrams: number;
    }>;
  };
};

const SLOT_ATTRIBUTE = "data-patient-goal-suggestions-root";

const STATUS_LABELS: Record<GoalSuggestion["status"], string> = {
  draft: "Rascunho",
  sent: "Pendente",
  accepted: "Aceita",
  refused: "Recusada",
  cancelled: "Cancelada",
};

function elementText(element: Element) {
  return element.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

function findGoalsPageTitle() {
  return Array.from(document.querySelectorAll("h1, h2, [role='heading'], div, p")).find(element =>
    elementText(element) === "Metas nutricionais",
  ) as HTMLElement | undefined;
}

function findGoalsPageContainer() {
  const title = findGoalsPageTitle();
  let current = title?.parentElement ?? null;

  while (current?.parentElement) {
    if (current.classList.contains("space-y-6") || current.parentElement.classList.contains("space-y-6")) {
      return current.classList.contains("space-y-6") ? current : current.parentElement;
    }
    current = current.parentElement;
  }

  return document.querySelector<HTMLElement>("main .space-y-6")
    ?? document.querySelector<HTMLElement>("[class*='space-y-6']");
}

function findPortalSlot() {
  if (typeof document === "undefined") return null;
  const existingSlot = document.querySelector<HTMLDivElement>(`[${SLOT_ATTRIBUTE}='true']`);
  if (existingSlot) return existingSlot;

  const container = findGoalsPageContainer();
  if (!container) return null;

  const slot = document.createElement("div");
  slot.setAttribute(SLOT_ATTRIBUTE, "true");
  container.insertBefore(slot, container.children[1] ?? null);
  return slot;
}

function formatDateTime(value: number | null | undefined) {
  return value ? new Date(value).toLocaleString("pt-BR") : "Sem data";
}

function macroSummary(goal: GoalSuggestion["goal"]["defaultGoal"]) {
  return `${formatGrams(goal.proteinGrams)} proteína | ${formatGrams(goal.carbsGrams)} carbo | ${formatGrams(goal.fatGrams)} gordura`;
}

function professionalLabel(suggestion: GoalSuggestion) {
  return suggestion.professional?.displayName || `Profissional #${suggestion.professionalUserId}`;
}

function statusClass(status: GoalSuggestion["status"]) {
  if (status === "accepted") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "refused" || status === "cancelled") return "border-muted bg-muted/30 text-muted-foreground";
  return "border-amber-200 bg-amber-50 text-amber-800";
}

export default function PatientGoalSuggestionsEmbed() {
  const [location] = useLocation();
  const shouldRender = location === "/goals";
  const utils = trpc.useUtils();
  const [slot, setSlot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!shouldRender) {
      setSlot(null);
      return;
    }

    const updateSlot = () => setSlot(findPortalSlot());
    updateSlot();
    const observer = new MutationObserver(updateSlot);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [shouldRender]);

  const suggestionsQuery = trpc.nutrition.professionals.patientGoalSuggestions.useQuery(undefined, {
    enabled: shouldRender && Boolean(slot),
    retry: false,
  });
  const respondSuggestion = trpc.nutrition.professionals.respondGoalSuggestion.useMutation({
    onSuccess: async suggestion => {
      await Promise.all([
        utils.nutrition.professionals.patientGoalSuggestions.invalidate(),
        utils.nutrition.goals.get.invalidate(),
        utils.nutrition.dashboard.overview.invalidate(),
        utils.nutrition.dashboard.today.invalidate(),
        utils.nutrition.reports.weekly.invalidate(),
      ]);
      toast.success(suggestion.status === "accepted" ? "Sugestão aceita e meta atualizada." : "Sugestão recusada.");
    },
    onError: error => toast.error(error.message || "Não foi possível responder à sugestão."),
  });

  if (!shouldRender || !slot) return null;

  const suggestions = ((suggestionsQuery.data ?? []) as GoalSuggestion[]);
  const pendingSuggestions = suggestions.filter(suggestion => suggestion.status === "sent");
  const answeredSuggestions = suggestions.filter(suggestion => suggestion.status !== "sent").slice(0, 3);

  return createPortal(
    <Card className="border-0 shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl">
          <Target className="h-5 w-5 text-primary" />
          Sugestões de meta recebidas
        </CardTitle>
        <CardDescription>
          Revise as metas sugeridas pelo profissional. Ao aceitar, sua meta nutricional será atualizada com os valores sugeridos.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {suggestionsQuery.isLoading ? (
          <div className="rounded-2xl border bg-muted/20 p-4 text-sm text-muted-foreground" role="status" aria-live="polite">
            Carregando sugestões recebidas...
          </div>
        ) : null}

        {suggestionsQuery.isError ? (
          <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
            Não foi possível carregar as sugestões recebidas. Tente novamente em instantes.
          </div>
        ) : null}

        {!suggestionsQuery.isLoading && !suggestionsQuery.isError && !suggestions.length ? (
          <div className="rounded-2xl border border-dashed bg-muted/20 p-5 text-sm leading-6 text-muted-foreground">
            Nenhuma sugestão de meta recebida até agora. Quando um profissional enviar uma sugestão, ela aparecerá aqui para você aceitar ou recusar.
          </div>
        ) : null}

        {pendingSuggestions.map(suggestion => (
          <SuggestionItem
            key={suggestion.id}
            suggestion={suggestion}
            isPending={respondSuggestion.isPending}
            onAccept={() => respondSuggestion.mutate({ suggestionId: suggestion.id, decision: "accepted" })}
            onRefuse={() => respondSuggestion.mutate({ suggestionId: suggestion.id, decision: "refused" })}
          />
        ))}

        {answeredSuggestions.length ? (
          <div className="space-y-3">
            <p className="text-sm font-medium text-muted-foreground">Respondidas recentemente</p>
            {answeredSuggestions.map(suggestion => (
              <SuggestionItem key={suggestion.id} suggestion={suggestion} isPending={respondSuggestion.isPending} />
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>,
    slot,
  );
}

function SuggestionItem({
  suggestion,
  isPending,
  onAccept,
  onRefuse,
}: {
  suggestion: GoalSuggestion;
  isPending: boolean;
  onAccept?: () => void;
  onRefuse?: () => void;
}) {
  const goal = suggestion.goal.defaultGoal;
  const canRespond = suggestion.status === "sent" && onAccept && onRefuse;

  return (
    <div className="rounded-2xl border bg-background p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium tracking-tight">{professionalLabel(suggestion)}</p>
            <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${statusClass(suggestion.status)}`}>
              {STATUS_LABELS[suggestion.status]}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">Enviada em {formatDateTime(suggestion.createdAt)}</p>
          {suggestion.respondedAt ? <p className="text-xs text-muted-foreground">Respondida em {formatDateTime(suggestion.respondedAt)}</p> : null}
        </div>
        {canRespond ? (
          <div className="flex flex-wrap gap-2">
            <Button type="button" className="rounded-full" disabled={isPending} onClick={onAccept}>
              <Check className="mr-2 h-4 w-4" />
              Aceitar
            </Button>
            <Button type="button" variant="outline" className="rounded-full" disabled={isPending} onClick={onRefuse}>
              <X className="mr-2 h-4 w-4" />
              Recusar
            </Button>
          </div>
        ) : null}
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-4">
        <SummaryTile label="Calorias" value={formatCalories(goal.calories)} />
        <SummaryTile label="Proteínas" value={formatGrams(goal.proteinGrams)} />
        <SummaryTile label="Carboidratos" value={formatGrams(goal.carbsGrams)} />
        <SummaryTile label="Gorduras" value={formatGrams(goal.fatGrams)} />
      </div>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">{macroSummary(goal)}</p>
      <p className="mt-3 rounded-xl border bg-muted/20 px-3 py-2 text-sm leading-6 text-foreground">
        {suggestion.rationale}
      </p>
      {suggestion.goal.exceptions.length ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Inclui {suggestion.goal.exceptions.length} exceção(ões) de meta programada(s).
        </p>
      ) : null}
    </div>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-muted/20 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-semibold tracking-tight">{value}</p>
    </div>
  );
}
