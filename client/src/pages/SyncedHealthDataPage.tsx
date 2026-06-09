import DashboardLayout from "@/components/DashboardLayout";
import UXState from "@/components/UXState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toDateInputValue, zonedDateTimeLocalToIso } from "@/lib/dateTime";
import { formatCalories, formatCountPtBr } from "@/lib/numberFormat";
import { trpc } from "@/lib/trpc";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Database } from "lucide-react";
import { useState } from "react";

const DATA_TYPES = [
  { value: "all", label: "Todos" },
  { value: "steps", label: "Passos" },
  { value: "weight", label: "Peso" },
  { value: "activity", label: "Atividade" },
  { value: "energy_burned", label: "Gasto" },
  { value: "sleep", label: "Sono" },
] as const;

const PAGE_SIZE = 20;

type HealthProvider = "apple_health" | "health_connect" | "google_fit" | "strava" | "garmin_connect" | "mock";
type HealthDataType = "steps" | "weight" | "activity" | "energy_burned" | "sleep";

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

function startOfDate(value: string) {
  return zonedDateTimeLocalToIso(`${value}T00:00`);
}

function endOfDate(value: string) {
  const end = new Date(zonedDateTimeLocalToIso(`${value}T23:59`));
  end.setSeconds(59, 999);
  return end.toISOString();
}

function toUtcNoonDate(dateKey: string) {
  return new Date(`${dateKey}T12:00:00Z`);
}

function addDaysToDateKey(dateKey: string, days: number) {
  const date = toUtcNoonDate(dateKey);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dateKeyToCalendarDate(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function calendarDateToDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatSelectedDateLabel(dateKey: string, todayKey: string) {
  if (dateKey === todayKey) return "Hoje";
  if (dateKey === addDaysToDateKey(todayKey, -1)) return "Ontem";
  if (dateKey === addDaysToDateKey(todayKey, 1)) return "Amanhã";

  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "UTC",
    weekday: "long",
  }).format(toUtcNoonDate(dateKey));
}

function formatSelectedDateSubtitle(dateKey: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "UTC",
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(toUtcNoonDate(dateKey));
}

export default function SyncedHealthDataPage() {
  const todayKey = toDateInputValue();
  const [selectedDate, setSelectedDate] = useState(todayKey);
  const [dataType, setDataType] = useState("all");
  const [source, setSource] = useState("all");
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const syncedRecords = trpc.nutrition.healthIntegrations.syncedRecords.useQuery({
    provider: source === "all" ? undefined : source as HealthProvider,
    dataType: dataType === "all" ? undefined : dataType as HealthDataType,
    from: startOfDate(selectedDate),
    to: endOfDate(selectedDate),
    q: query.trim() || undefined,
    limit: PAGE_SIZE,
    offset,
  });

  const records = (syncedRecords.data?.items ?? []) as SyncedHealthRecord[];
  const sources = syncedRecords.data?.sources ?? [];

  const resetPagedView = () => {
    setOffset(0);
    setExpandedId(null);
  };

  const updateSelectedDate = (nextDate: string) => {
    setSelectedDate(nextDate);
    resetPagedView();
  };

  const updateDataType = (nextDataType: string) => {
    setDataType(nextDataType);
    resetPagedView();
  };

  const updateSource = (nextSource: string) => {
    setSource(nextSource);
    resetPagedView();
  };

  const updateQuery = (nextQuery: string) => {
    setQuery(nextQuery);
    resetPagedView();
  };

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">Dados sincronizados</h1>
        </div>

        <DateNavigator
          selectedDate={selectedDate}
          todayKey={todayKey}
          isViewingToday={selectedDate === todayKey}
          onPreviousDay={() => updateSelectedDate(addDaysToDateKey(selectedDate, -1))}
          onNextDay={() => updateSelectedDate(addDaysToDateKey(selectedDate, 1))}
          onToday={() => updateSelectedDate(todayKey)}
          onDateSelect={updateSelectedDate}
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
            <div className="grid gap-3 xl:grid-cols-[minmax(16rem,1fr),auto,auto]">
              <Input
                value={query}
                onChange={event => updateQuery(event.target.value)}
                placeholder="Buscar por atividade, origem ou tipo"
                className="h-11"
              />
              <SegmentedFilter
                label="TIPO:"
                value={dataType}
                options={DATA_TYPES}
                onChange={updateDataType}
              />
              <SegmentedFilter
                label="ORIGEM:"
                value={source}
                options={[{ value: "all", label: "Todas" }, ...sources.map(item => ({ value: item, label: item }))]}
                onChange={updateSource}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Metric label="Passos" value={formatCountPtBr(syncedRecords.data?.totals.steps ?? 0)} />
              <Metric label="Atividade" value={formatCountPtBr(syncedRecords.data?.totals.activityMinutes ?? 0, " min")} />
              <Metric label="Gasto externo" value={formatCalories(syncedRecords.data?.totals.energyBurnedCalories ?? 0)} />
              <Metric label="Sono" value={formatCountPtBr(syncedRecords.data?.totals.sleepMinutes ?? 0, " min")} />
            </div>

            {syncedRecords.isLoading ? (
              <UXState
                variant="loading"
                title="Carregando dados sincronizados"
                description="Estou reunindo os registros recentes para preencher a consulta."
              />
            ) : syncedRecords.error ? (
              <UXState
                variant="error"
                title="Não foi possível carregar os dados"
                description={syncedRecords.error.message || "Tente novamente em instantes para revisar os registros sincronizados."}
              />
            ) : records.length ? (
              <div className="space-y-4">
                <div className="grid gap-3">
                  {records.map(record => {
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
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-muted-foreground">
                    Exibindo {offset + 1}-{offset + records.length} de {syncedRecords.data?.total ?? records.length}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="rounded-full"
                      disabled={offset === 0 || syncedRecords.isFetching}
                      onClick={() => {
                        setOffset(Math.max(offset - PAGE_SIZE, 0));
                        setExpandedId(null);
                      }}
                    >
                      Anterior
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="rounded-full"
                      disabled={!syncedRecords.data?.nextOffset || syncedRecords.isFetching}
                      onClick={() => {
                        setOffset(syncedRecords.data?.nextOffset ?? offset);
                        setExpandedId(null);
                      }}
                    >
                      Próxima
                    </Button>
                  </div>
                </div>
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

function DateNavigator({
  selectedDate,
  todayKey,
  isViewingToday,
  onPreviousDay,
  onNextDay,
  onToday,
  onDateSelect,
}: {
  selectedDate: string;
  todayKey: string;
  isViewingToday: boolean;
  onPreviousDay: () => void;
  onNextDay: () => void;
  onToday: () => void;
  onDateSelect: (dateKey: string) => void;
}) {
  const [calendarOpen, setCalendarOpen] = useState(false);

  const handleCalendarSelect = (date?: Date) => {
    if (!date) return;
    onDateSelect(calendarDateToDateKey(date));
    setCalendarOpen(false);
  };

  return (
    <div className="flex flex-col items-center justify-center gap-3 text-center sm:flex-row sm:justify-between sm:text-left">
      <div>
        <p className="text-sm font-medium text-muted-foreground">Dia selecionado</p>
        <h2 className="text-2xl font-semibold tracking-tight capitalize">{formatSelectedDateLabel(selectedDate, todayKey)}</h2>
        <p className="text-sm text-muted-foreground">{formatSelectedDateSubtitle(selectedDate)}</p>
      </div>
      <div className="flex items-center gap-2 rounded-full border bg-background p-1 shadow-sm">
        <Button type="button" variant="ghost" className="h-10 w-10 rounded-full p-0" onClick={onPreviousDay} aria-label="Dia anterior">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        {isViewingToday ? (
          <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
            <PopoverTrigger asChild>
              <Button type="button" variant="secondary" className="rounded-full px-4" aria-label="Escolher dia no calendário">
                <CalendarDays className="mr-2 h-4 w-4" />
                Hoje
              </Button>
            </PopoverTrigger>
            <PopoverContent align="center" className="w-auto p-0">
              <Calendar
                mode="single"
                selected={dateKeyToCalendarDate(selectedDate)}
                defaultMonth={dateKeyToCalendarDate(selectedDate)}
                onSelect={handleCalendarSelect}
                captionLayout="dropdown"
              />
            </PopoverContent>
          </Popover>
        ) : (
          <Button type="button" variant="ghost" className="rounded-full px-4" onClick={onToday}>
            Hoje
          </Button>
        )}
        <Button type="button" variant="ghost" className="h-10 w-10 rounded-full p-0" onClick={onNextDay} aria-label="Próximo dia">
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
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
      <span className="px-2 text-xs font-bold uppercase tracking-[0.16em] text-foreground">{label}</span>
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
