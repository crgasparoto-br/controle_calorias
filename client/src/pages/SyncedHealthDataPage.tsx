import DashboardLayout from "@/components/DashboardLayout";
import PageIntro from "@/components/PageIntro";
import UXState from "@/components/UXState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatCalories, formatCountPtBr } from "@/lib/numberFormat";
import { trpc } from "@/lib/trpc";
import { ChevronDown, Database } from "lucide-react";
import { useMemo, useState } from "react";

const DATA_TYPES = [
  { value: "all", label: "Todos" },
  { value: "steps", label: "Passos" },
  { value: "weight", label: "Peso" },
  { value: "activity", label: "Atividade" },
  { value: "energy_burned", label: "Gasto" },
  { value: "sleep", label: "Sono" },
] as const;

type SyncedHealthRecord = {
  id: string;
  source: string;
  dataType: string;
  measuredAt: string;
  value: number;
  unit: string;
  activityType?: string;
  metadata?: Record<string, unknown> | null;
};

export default function SyncedHealthDataPage() {
  const status = trpc.nutrition.healthIntegrations.status.useQuery();
  const [dataType, setDataType] = useState("all");
  const [source, setSource] = useState("all");
  const [query, setQuery] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const records = (status.data?.recentRecords ?? []) as SyncedHealthRecord[];
  const sources = useMemo(() => Array.from(new Set(records.map(record => record.source))).sort(), [records]);
  const filteredRecords = useMemo(() => {
    const normalizedQuery = normalize(query);
    return records.filter(record => {
      const matchesType = dataType === "all" || record.dataType === dataType;
      const matchesSource = source === "all" || record.source === source;
      const searchable = normalize([
        record.source,
        record.dataType,
        record.activityType,
        typeof record.metadata?.name === "string" ? record.metadata.name : null,
        typeof record.metadata?.sportType === "string" ? record.metadata.sportType : null,
      ].filter(Boolean).join(" "));
      return matchesType && matchesSource && (!normalizedQuery || searchable.includes(normalizedQuery));
    });
  }, [dataType, query, records, source]);

  const stravaActivityRecords = filteredRecords.filter(record => record.source === "strava" && record.dataType === "activity");
  const stravaDistanceKm = stravaActivityRecords.reduce((sum, record) => {
    const distance = record.metadata?.distanceMeters;
    return sum + (typeof distance === "number" ? distance / 1000 : 0);
  }, 0);

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-7xl space-y-6">
        <PageIntro
          eyebrow="Dados sincronizados"
          title="Dados sincronizados"
          description="Consulte registros importados das integrações com filtros por origem, tipo e busca textual. Abra um registro para conferir os detalhes enviados pelo provider."
          stats={
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <IntroStat label="Registros filtrados" value={String(filteredRecords.length)} helper="na consulta atual" />
              <IntroStat label="Atividades Strava" value={String(stravaActivityRecords.length)} helper="com detalhes de treino" />
              <IntroStat label="Distância Strava" value={stravaDistanceKm > 0 ? `${formatNumber(stravaDistanceKm, 2)} km` : "0 km"} helper="nos registros visíveis" />
              <IntroStat label="Origens" value={String(sources.length)} helper="providers com dados" />
            </div>
          }
        />

        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="h-5 w-5 text-primary" />
              Consulta de dados importados
            </CardTitle>
            <CardDescription>
              Esta tela mantém a auditoria dos dados sincronizados separada das ações de conexão e autorização.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-3 xl:grid-cols-[1fr,auto,auto]">
              <Input
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder="Buscar por atividade, origem ou tipo"
                className="h-11"
              />
              <SegmentedFilter
                label="Tipo"
                value={dataType}
                options={DATA_TYPES}
                onChange={setDataType}
              />
              <SegmentedFilter
                label="Origem"
                value={source}
                options={[{ value: "all", label: "Todas" }, ...sources.map(item => ({ value: item, label: item }))]}
                onChange={setSource}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Metric label="Passos" value={formatCountPtBr(status.data?.totals.steps ?? 0)} />
              <Metric label="Atividade" value={formatCountPtBr(status.data?.totals.activityMinutes ?? 0, " min")} />
              <Metric label="Gasto externo" value={formatCalories(status.data?.totals.energyBurnedCalories ?? 0)} />
              <Metric label="Sono" value={formatCountPtBr(status.data?.totals.sleepMinutes ?? 0, " min")} />
            </div>

            {status.isLoading ? (
              <UXState
                variant="loading"
                title="Carregando dados sincronizados"
                description="Estou reunindo os registros recentes para preencher a consulta."
              />
            ) : status.error ? (
              <UXState
                variant="error"
                title="Não foi possível carregar os dados"
                description={status.error.message || "Tente novamente em instantes para revisar os registros sincronizados."}
              />
            ) : filteredRecords.length ? (
              <div className="grid gap-3">
                {filteredRecords.map(record => {
                  const expanded = expandedId === record.id;
                  return (
                    <article key={record.id} className="rounded-2xl border bg-background p-4 shadow-sm">
                      <button
                        type="button"
                        className="flex w-full flex-wrap items-center justify-between gap-3 text-left"
                        onClick={() => setExpandedId(expanded ? null : record.id)}
                      >
                        <div className="min-w-0">
                          <p className="truncate font-semibold tracking-tight">{getRecordTitle(record)}</p>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {new Date(record.measuredAt).toLocaleString("pt-BR")} · origem: {record.source}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline" className="rounded-full px-3 py-1">{record.value} {record.unit}</Badge>
                          <Badge variant="secondary" className="rounded-full px-3 py-1">{formatDataType(record.dataType)}</Badge>
                          <ChevronDown className={`h-4 w-4 text-muted-foreground transition ${expanded ? "rotate-180" : ""}`} />
                        </div>
                      </button>
                      {expanded ? <RecordDetails record={record} /> : null}
                    </article>
                  );
                })}
              </div>
            ) : (
              <UXState
                variant="empty"
                title="Nenhum registro encontrado"
                description="Ajuste os filtros ou sincronize o Strava para consultar dados importados das integrações."
              />
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}

function RecordDetails({ record }: { record: SyncedHealthRecord }) {
  const metadataEntries = Object.entries(record.metadata ?? {}).filter(([, value]) => value !== null && value !== undefined && value !== "");

  return (
    <div className="mt-4 space-y-4">
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <Detail label="ID" value={record.id} />
        <Detail label="Tipo" value={formatDataType(record.dataType)} />
        <Detail label="Origem" value={record.source} />
        <Detail label="Unidade" value={record.unit} />
      </div>
      {metadataEntries.length ? (
        <div className="rounded-2xl border bg-muted/20 p-4">
          <p className="text-sm font-semibold tracking-tight">Detalhes do provider</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {metadataEntries.slice(0, 18).map(([key, value]) => (
              <Detail key={key} label={formatMetadataLabel(key)} value={formatMetadataValue(value)} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SegmentedFilter({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl border bg-background p-1">
      <span className="px-2 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">{label}</span>
      {options.map(option => (
        <Button
          key={option.value}
          type="button"
          variant={value === option.value ? "default" : "ghost"}
          size="sm"
          className="rounded-xl"
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}

function IntroStat({ label, value, helper }: { label: string; value: string; helper: string }) {
  return (
    <div className="rounded-2xl border bg-background p-4 shadow-sm">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{helper}</p>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border bg-background p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 text-xl font-semibold tracking-tight">{value}</p>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border bg-background px-3 py-2 text-sm">
      <p className="text-muted-foreground">{label}</p>
      <p className="mt-1 break-words font-medium text-foreground">{value}</p>
    </div>
  );
}

function getRecordTitle(record: SyncedHealthRecord) {
  const name = record.metadata?.name;
  return typeof name === "string" && name.trim() ? name : formatDataType(record.dataType);
}

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function formatDataType(dataType: string) {
  const match = DATA_TYPES.find(item => item.value === dataType);
  return match?.label ?? dataType;
}

function formatMetadataLabel(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/^./, char => char.toUpperCase());
}

function formatMetadataValue(value: unknown) {
  if (typeof value === "number") return formatNumber(value, Number.isInteger(value) ? 0 : 2);
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function formatNumber(value: number, fractionDigits = 1) {
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}
