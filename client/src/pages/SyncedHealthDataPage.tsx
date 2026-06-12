import DashboardLayout from "@/components/DashboardLayout";
import UXState from "@/components/UXState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toDateInputValue, zonedDateTimeLocalToIso } from "@/lib/dateTime";
import { formatCalories, formatCountPtBr, formatIntegerPtBr, formatNumberPtBr } from "@/lib/numberFormat";
import { trpc } from "@/lib/trpc";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Database } from "lucide-react";
import React, { useState } from "react";

const DATA_TYPES = [
  { value: "all", label: "Todos" },
  { value: "steps", label: "Passos" },
  { value: "weight", label: "Peso" },
  { value: "activity", label: "Atividade" },
  { value: "energy_burned", label: "Calorias" },
  { value: "sleep", label: "Sono" },
] as const;

const PAGE_SIZE = 20;
const TECHNICAL_METADATA_KEYS = new Set(["externalId", "gearId", "id"]);

const ACTIVITY_TYPE_LABELS: Record<string, string> = {
  alpine_ski: "Esqui alpino",
  alpineski: "Esqui alpino",
  backcountry_ski: "Esqui fora de pista",
  backcountryski: "Esqui fora de pista",
  badminton: "Badminton",
  basketball: "Basquete",
  canoeing: "Canoagem",
  commute: "Deslocamento",
  crossfit: "CrossFit",
  ebikeride: "Pedalada com bicicleta elétrica",
  elliptical: "Elíptico",
  emountainbikeride: "Mountain bike elétrica",
  gravelride: "Pedalada em gravel",
  handcycle: "Handbike",
  hike: "Caminhada em trilha",
  iceskate: "Patinação no gelo",
  kayaking: "Caiaque",
  kitesurf: "Kitesurf",
  mountainbikeride: "Mountain bike",
  nordicski: "Esqui nórdico",
  pickleball: "Pickleball",
  pilates: "Pilates",
  ride: "Pedalada",
  rockclimbing: "Escalada",
  rollerski: "Ski sobre rodas",
  rowing: "Remo",
  run: "Corrida",
  sailing: "Vela",
  skateboard: "Skate",
  snowboarding: "Snowboard",
  snowshoe: "Caminhada na neve",
  soccer: "Futebol",
  stairstepper: "Simulador de escada",
  standuppaddling: "Stand up paddle",
  strength: "Musculação",
  strengthtraining: "Musculação",
  surfing: "Surfe",
  swim: "Natação",
  tabletennis: "Tênis de mesa",
  tennis: "Tênis",
  trailrun: "Corrida em trilha",
  velomobile: "Velomóvel",
  virtualride: "Pedalada virtual",
  virtualrow: "Remo virtual",
  virtualrun: "Corrida virtual",
  walk: "Caminhada",
  weighttraining: "Musculação",
  wheelchair: "Cadeira de rodas",
  workout: "Treino",
  yoga: "Yoga",
};

const METADATA_LABELS: Record<string, string> = {
  achievementCount: "Conquistas",
  averageCadence: "Cadência média",
  commute: "Deslocamento",
  deviceName: "Dispositivo",
  elapsedTimeSeconds: "Tempo total",
  hasHeartrate: "Possui frequência cardíaca",
  manual: "Registro manual",
  maxHeartRate: "FC máxima",
  maxSpeedMetersPerSecond: "Velocidade máxima",
  perceivedEffort: "Esforço percebido",
  sourceStatus: "Status da sincronização",
  sportType: "Tipo de atividade",
  startDateLocal: "Data e hora local",
  timezone: "Fuso horário",
  trainer: "Treino indoor",
  workoutType: "Tipo de treino",
};

const METADATA_VALUE_LABELS: Record<string, string> = {
  active: "Ativo",
  commute: "Deslocamento",
  easy: "Leve",
  false: "Não",
  hard: "Intenso",
  indoor: "Ambiente interno",
  manual: "Manual",
  moderate: "Moderado",
  outdoor: "Ambiente externo",
  private: "Privado",
  public: "Público",
  synced: "Sincronizado",
  true: "Sim",
};

const UNIT_LABELS: Record<string, string> = {
  bpm: "bpm",
  count: "",
  hour: "h",
  hours: "h",
  kcal: "kcal",
  kg: "kg",
  kilometer: "km",
  kilometers: "km",
  km: "km",
  meter: "m",
  meters: "m",
  minute: "min",
  minutes: "min",
  second: "s",
  seconds: "s",
};

type HealthProvider = "apple_health" | "health_connect" | "google_fit" | "strava" | "garmin_connect" | "mock";
type HealthDataType = "steps" | "weight" | "activity" | "energy_burned" | "sleep";

type RecordMetadata = Record<string, unknown>;

type SyncedHealthRecord = {
  id: string;
  source: string;
  dataType: string;
  measuredAt: string;
  value: number;
  unit: string;
  activityType?: string;
  metadata?: RecordMetadata | null;
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
                options={[{ value: "all", label: "Todas" }, ...sources.map(item => ({ value: item, label: formatSource(item) }))]}
                onChange={updateSource}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Metric label="Passos" value={formatCountPtBr(syncedRecords.data?.totals.steps ?? 0)} />
              <Metric label="Atividade" value={formatCountPtBr(syncedRecords.data?.totals.activityMinutes ?? 0, " min")} />
              <Metric label="Calorias sincronizadas" value={formatCalories(syncedRecords.data?.totals.energyBurnedCalories ?? 0)} />
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
                              {formatMeasuredAt(record.measuredAt)} · Origem: {formatSource(record.source)}
                            </p>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="outline" className="rounded-full px-3 py-1">{formatRecordValue(record)}</Badge>
                            {record.dataType === "activity" ? (
                              <Badge variant={getRecordCalories(record) ? "secondary" : "outline"} className="rounded-full px-3 py-1">
                                {formatCaloriesBadge(record)}
                              </Badge>
                            ) : null}
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
  const details = buildUserFacingDetails(record);

  return (
    <div className="mt-4 rounded-2xl border bg-muted/20 p-4">
      <p className="text-sm font-semibold tracking-tight">Detalhes da atividade</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {details.map(detail => (
          <Detail key={detail.label} label={detail.label} value={detail.value} />
        ))}
      </div>
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

function getMetadata(record: SyncedHealthRecord): RecordMetadata {
  return record.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata) ? record.metadata : {};
}

function normalizeDictionaryKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase();
}

function formatActivityType(value: string | null | undefined) {
  if (!value?.trim()) return null;
  return ACTIVITY_TYPE_LABELS[normalizeDictionaryKey(value)] ?? null;
}

function getRecordActivityLabel(record: SyncedHealthRecord) {
  return formatActivityType(record.activityType)
    ?? formatActivityType(getStringMetadata(record, "sportType"))
    ?? formatActivityType(getStringMetadata(record, "workoutType"));
}

function getRecordTitle(record: SyncedHealthRecord) {
  if (record.dataType === "activity") {
    return getRecordActivityLabel(record) ?? "Atividade importada";
  }

  const metadata = getMetadata(record);
  const name = metadata.name;
  return typeof name === "string" && name.trim() ? name : formatDataType(record.dataType);
}

function formatDataType(dataType: string) {
  const match = DATA_TYPES.find(item => item.value === dataType);
  return match?.label ?? formatMetadataLabel(dataType);
}

function formatSource(source: string) {
  const labels: Record<string, string> = {
    apple_health: "Apple Health",
    garmin_connect: "Garmin Connect",
    google_fit: "Google Fit",
    health_connect: "Health Connect",
    mock: "Mock",
    strava: "Strava",
  };
  return labels[source] ?? source;
}

function formatMeasuredAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Data não informada";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function getNumberMetadata(record: SyncedHealthRecord, key: string) {
  const value = getMetadata(record)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function getBooleanMetadata(record: SyncedHealthRecord, key: string) {
  const value = getMetadata(record)[key];
  return typeof value === "boolean" ? value : null;
}

function getStringMetadata(record: SyncedHealthRecord, key: string) {
  const value = getMetadata(record)[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getRecordCalories(record: SyncedHealthRecord) {
  const calories = getNumberMetadata(record, "calories");
  if (calories && calories > 0) return calories;
  return record.dataType === "energy_burned" && record.value > 0 ? record.value : null;
}

function formatCaloriesBadge(record: SyncedHealthRecord) {
  const calories = getRecordCalories(record);
  if (!calories) return "Calorias não informadas";
  return formatCalories(calories);
}

function formatUnit(unit: string) {
  return UNIT_LABELS[normalizeDictionaryKey(unit)] ?? formatMetadataLabel(unit).toLowerCase();
}

function formatRecordValue(record: SyncedHealthRecord) {
  if (record.unit === "minutes") return `${formatIntegerPtBr(Math.round(record.value))} min`;
  if (record.unit === "kcal") return formatCalories(record.value);
  if (record.unit === "kg") return `${formatNumberPtBr(record.value, { maximumFractionDigits: 1 })} kg`;
  if (record.unit === "count") return formatIntegerPtBr(record.value);

  const unit = formatUnit(record.unit);
  return unit ? `${formatNumberPtBr(record.value)} ${unit}` : formatNumberPtBr(record.value);
}

function formatDuration(seconds: number | null, fallbackMinutes?: number) {
  const totalSeconds = seconds && seconds > 0 ? Math.round(seconds) : Math.round((fallbackMinutes ?? 0) * 60);
  if (totalSeconds <= 0) return null;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainingSeconds = totalSeconds % 60;
  if (hours > 0) return `${hours} h ${String(minutes).padStart(2, "0")} min`;
  if (minutes > 0) return `${minutes} min`;
  return `${remainingSeconds} s`;
}

function formatDistanceMeters(value: number | null) {
  if (!value || value <= 0) return null;
  if (value >= 1000) return `${formatNumberPtBr(value / 1000, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} km`;
  return `${formatIntegerPtBr(Math.round(value))} m`;
}

function formatSpeedKmH(value: number | null) {
  if (!value || value <= 0) return null;
  return `${formatNumberPtBr(value * 3.6, { maximumFractionDigits: 1 })} km/h`;
}

function formatPace(value: number | null) {
  if (!value || value <= 0) return null;
  const secondsPerKm = Math.round(1000 / value);
  const minutes = Math.floor(secondsPerKm / 60);
  const seconds = String(secondsPerKm % 60).padStart(2, "0");
  return `${minutes}:${seconds}/km`;
}

function formatCaloriesSource(record: SyncedHealthRecord) {
  const source = getStringMetadata(record, "caloriesSource");
  const estimated = getBooleanMetadata(record, "estimatedCalories");
  if (source === "strava") return "Strava";
  if (source === "kilojoules") return "Strava, convertido de kJ";
  if (source === "synced_energy") return "Registro sincronizado";
  if (source === "estimated_strength") return "Estimativa local de musculação; Strava não retornou calorias oficiais";
  if (source === "estimated_activity" || estimated) return "Estimativa local; Strava não retornou calorias oficiais";
  return null;
}

function addDetail(details: Array<{ label: string; value: string }>, label: string, value: string | null | undefined) {
  if (value) details.push({ label, value });
}

function buildUserFacingDetails(record: SyncedHealthRecord) {
  const details: Array<{ label: string; value: string }> = [];
  const calories = getRecordCalories(record);
  const caloriesSource = formatCaloriesSource(record);
  const averageSpeed = getNumberMetadata(record, "averageSpeedMetersPerSecond");

  addDetail(details, "Tipo", getRecordActivityLabel(record) ?? formatDataType(record.dataType));
  addDetail(details, "Origem", formatSource(record.source));
  addDetail(details, "Data e hora", formatMeasuredAt(record.measuredAt));
  addDetail(details, "Duração", formatDuration(getNumberMetadata(record, "movingTimeSeconds"), record.unit === "minutes" ? record.value : undefined));
  addDetail(details, "Distância", formatDistanceMeters(getNumberMetadata(record, "distanceMeters")));
  addDetail(details, "Ritmo médio", formatPace(averageSpeed));
  addDetail(details, "Velocidade média", formatSpeedKmH(averageSpeed));
  addDetail(details, "Calorias", calories ? formatCalories(calories) : "Não informado pela integração");
  addDetail(details, "Fonte das calorias", caloriesSource);
  addDetail(details, "Ganho de elevação", formatDistanceMeters(getNumberMetadata(record, "totalElevationGainMeters")));
  addDetail(details, "FC média", getNumberMetadata(record, "averageHeartRate") ? `${formatIntegerPtBr(Math.round(getNumberMetadata(record, "averageHeartRate") ?? 0))} bpm` : null);

  for (const [key, value] of Object.entries(getMetadata(record))) {
    if (details.length >= 12) break;
    if (TECHNICAL_METADATA_KEYS.has(key) || isKnownFormattedMetadataKey(key)) continue;
    addDetail(details, formatMetadataLabel(key), formatMetadataValue(value));
  }

  return details;
}

function isKnownFormattedMetadataKey(key: string) {
  return [
    "averageHeartRate",
    "averageSpeedMetersPerSecond",
    "calories",
    "caloriesSource",
    "distanceMeters",
    "elapsedTimeSeconds",
    "estimatedCalories",
    "estimatedCaloriesMet",
    "estimatedCaloriesWeightKg",
    "kilojoules",
    "maxHeartRate",
    "maxSpeedMetersPerSecond",
    "movingTimeSeconds",
    "name",
    "sportType",
    "startDateLocal",
    "timezone",
    "totalElevationGainMeters",
  ].includes(key);
}

function formatMetadataLabel(value: string) {
  const translated = METADATA_LABELS[value];
  if (translated) return translated;

  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/^./, char => char.toUpperCase());
}

function formatStringMetadataValue(value: string) {
  const activityLabel = formatActivityType(value);
  if (activityLabel) return activityLabel;

  const translated = METADATA_VALUE_LABELS[normalizeDictionaryKey(value)];
  if (translated) return translated;

  const date = new Date(value);
  if (!Number.isNaN(date.getTime()) && /\d{4}-\d{2}-\d{2}/.test(value)) return formatMeasuredAt(value);

  return value;
}

function formatMetadataValue(value: unknown) {
  if (typeof value === "number") return formatNumberPtBr(value, { maximumFractionDigits: Number.isInteger(value) ? 0 : 2 });
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  if (typeof value === "string") return formatStringMetadataValue(value);
  if (value === null || value === undefined) return null;
  return JSON.stringify(value);
}
