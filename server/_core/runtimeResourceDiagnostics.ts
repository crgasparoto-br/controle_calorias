import { readFileSync } from "node:fs";

const MIB = 1024 * 1024;
const DEFAULT_SAMPLE_INTERVAL_MS = 1_000;
const DEFAULT_REPORT_INTERVAL_MS = 30_000;
const RESET_PRESSURE_RATIO = 0.75;

const CGROUP_LIMIT_PATHS = [
  "/sys/fs/cgroup/memory.max",
  "/sys/fs/cgroup/memory/memory.limit_in_bytes",
] as const;

const CGROUP_USAGE_PATHS = [
  "/sys/fs/cgroup/memory.current",
  "/sys/fs/cgroup/memory/memory.usage_in_bytes",
] as const;

type ReadText = (path: string) => string;

export type RuntimeMemorySample = {
  rssBytes: number;
  heapUsedBytes: number;
  heapTotalBytes: number;
  externalBytes: number;
  arrayBuffersBytes: number;
  containerBytes: number | null;
};

export type RuntimeMemoryPressure = {
  band: "normal" | "elevated" | "critical";
  ratio: number | null;
  usedBytes: number;
};

type RuntimeResourceLogger = (
  message: string,
  detail: Record<string, unknown>,
) => void;

function readTextFile(path: string) {
  return readFileSync(path, "utf8");
}

function readBoundedPositiveNumber(raw: string) {
  const value = raw.trim();
  if (!value || value === "max") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  // cgroup v1 represents "unlimited" with values close to max int64.
  if (parsed > 16 * 1024 * 1024 * 1024 * 1024) return null;
  return parsed;
}

function readFirstCgroupValue(paths: readonly string[], readText: ReadText) {
  for (const path of paths) {
    try {
      const value = readBoundedPositiveNumber(readText(path));
      if (value !== null) return value;
    } catch {
      // Probe the next known cgroup layout.
    }
  }
  return null;
}

export function detectCgroupMemoryLimitBytes(
  readText: ReadText = readTextFile,
) {
  return readFirstCgroupValue(CGROUP_LIMIT_PATHS, readText);
}

export function readCgroupMemoryUsageBytes(
  readText: ReadText = readTextFile,
) {
  return readFirstCgroupValue(CGROUP_USAGE_PATHS, readText);
}

export function readRuntimeMemorySample(input: {
  memoryUsage?: () => NodeJS.MemoryUsage;
  readContainerUsageBytes?: () => number | null;
} = {}): RuntimeMemorySample {
  const usage = (input.memoryUsage ?? (() => process.memoryUsage()))();
  const containerBytes =
    (input.readContainerUsageBytes ?? (() => readCgroupMemoryUsageBytes()))();

  return {
    rssBytes: usage.rss,
    heapUsedBytes: usage.heapUsed,
    heapTotalBytes: usage.heapTotal,
    externalBytes: usage.external,
    arrayBuffersBytes: usage.arrayBuffers,
    containerBytes,
  };
}

export function classifyRuntimeMemoryPressure(
  sample: RuntimeMemorySample,
  memoryLimitBytes: number | null,
): RuntimeMemoryPressure {
  const usedBytes = sample.containerBytes ?? sample.rssBytes;
  if (!memoryLimitBytes || memoryLimitBytes <= 0) {
    return { band: "normal", ratio: null, usedBytes };
  }
  const ratio = usedBytes / memoryLimitBytes;
  if (ratio >= 0.9) return { band: "critical", ratio, usedBytes };
  if (ratio >= 0.8) return { band: "elevated", ratio, usedBytes };
  return { band: "normal", ratio, usedBytes };
}

function roundMiB(bytes: number | null) {
  if (bytes === null) return null;
  return Math.round((bytes / MIB) * 10) / 10;
}

function roundRatio(ratio: number | null) {
  if (ratio === null) return null;
  return Math.round(ratio * 1_000) / 1_000;
}

function maxNullable(current: number | null, next: number | null) {
  if (current === null) return next;
  if (next === null) return current;
  return Math.max(current, next);
}

export function createRuntimeResourceTracker(input: {
  bootId: string;
  bootStartedAt: number;
  commit: string | null;
  memoryLimitBytes: number | null;
  now?: () => number;
  logInfo?: RuntimeResourceLogger;
  logWarn?: RuntimeResourceLogger;
}) {
  const now = input.now ?? Date.now;
  const logInfo = input.logInfo ?? console.info;
  const logWarn = input.logWarn ?? console.warn;
  let maxSample: RuntimeMemorySample | null = null;
  let lastAlertBand: RuntimeMemoryPressure["band"] = "normal";

  const updateMax = (sample: RuntimeMemorySample) => {
    maxSample = maxSample
      ? {
          rssBytes: Math.max(maxSample.rssBytes, sample.rssBytes),
          heapUsedBytes: Math.max(maxSample.heapUsedBytes, sample.heapUsedBytes),
          heapTotalBytes: Math.max(maxSample.heapTotalBytes, sample.heapTotalBytes),
          externalBytes: Math.max(maxSample.externalBytes, sample.externalBytes),
          arrayBuffersBytes: Math.max(
            maxSample.arrayBuffersBytes,
            sample.arrayBuffersBytes,
          ),
          containerBytes: maxNullable(
            maxSample.containerBytes,
            sample.containerBytes,
          ),
        }
      : { ...sample };
  };

  const detailFor = (
    sample: RuntimeMemorySample,
    reason: string,
    pressure = classifyRuntimeMemoryPressure(
      sample,
      input.memoryLimitBytes,
    ),
  ) => ({
    bootId: input.bootId,
    commit: input.commit,
    uptimeMs: Math.max(0, now() - input.bootStartedAt),
    reason,
    rssMiB: roundMiB(sample.rssBytes),
    heapUsedMiB: roundMiB(sample.heapUsedBytes),
    heapTotalMiB: roundMiB(sample.heapTotalBytes),
    externalMiB: roundMiB(sample.externalBytes),
    arrayBuffersMiB: roundMiB(sample.arrayBuffersBytes),
    containerMiB: roundMiB(sample.containerBytes),
    memoryLimitMiB: roundMiB(input.memoryLimitBytes),
    pressureRatio: roundRatio(pressure.ratio),
    pressureBand: pressure.band,
  });

  const observe = (
    sample: RuntimeMemorySample,
    reason: string,
    emitCheckpoint = false,
  ) => {
    updateMax(sample);
    const pressure = classifyRuntimeMemoryPressure(
      sample,
      input.memoryLimitBytes,
    );

    const escalated =
      pressure.band === "critical"
        ? lastAlertBand !== "critical"
        : pressure.band === "elevated" && lastAlertBand === "normal";

    if (escalated) {
      logWarn("[Runtime] memory_pressure", detailFor(sample, reason, pressure));
      lastAlertBand = pressure.band;
    } else if (
      pressure.ratio !== null &&
      pressure.ratio < RESET_PRESSURE_RATIO
    ) {
      lastAlertBand = "normal";
    }

    if (emitCheckpoint) {
      logInfo(
        "[Runtime] memory_checkpoint",
        detailFor(sample, reason, pressure),
      );
    }
    return pressure;
  };

  const reportWindow = (sample: RuntimeMemorySample) => {
    observe(sample, "periodic-window");
    const highWater = maxSample ?? sample;
    logInfo("[Runtime] memory_window", {
      ...detailFor(sample, "periodic-window"),
      highWaterRssMiB: roundMiB(highWater.rssBytes),
      highWaterHeapUsedMiB: roundMiB(highWater.heapUsedBytes),
      highWaterContainerMiB: roundMiB(highWater.containerBytes),
    });
    maxSample = { ...sample };
  };

  return {
    observe,
    reportWindow,
  };
}

function unrefTimer(timer: ReturnType<typeof setInterval>) {
  if (typeof timer === "object" && timer && "unref" in timer) {
    timer.unref();
  }
}

export function installRuntimeResourceDiagnostics(input: {
  bootId: string;
  bootStartedAt: number;
  commit: string | null;
  memoryLimitBytes?: number | null;
  sampleIntervalMs?: number;
  reportIntervalMs?: number;
  memoryUsage?: () => NodeJS.MemoryUsage;
  readContainerUsageBytes?: () => number | null;
  now?: () => number;
  logInfo?: RuntimeResourceLogger;
  logWarn?: RuntimeResourceLogger;
}) {
  const memoryLimitBytes =
    input.memoryLimitBytes === undefined
      ? detectCgroupMemoryLimitBytes()
      : input.memoryLimitBytes;
  const readSample = () =>
    readRuntimeMemorySample({
      memoryUsage: input.memoryUsage,
      readContainerUsageBytes: input.readContainerUsageBytes,
    });
  const tracker = createRuntimeResourceTracker({
    bootId: input.bootId,
    bootStartedAt: input.bootStartedAt,
    commit: input.commit,
    memoryLimitBytes,
    now: input.now,
    logInfo: input.logInfo,
    logWarn: input.logWarn,
  });

  tracker.observe(readSample(), "installed", true);

  const sampleTimer = setInterval(
    () => tracker.observe(readSample(), "periodic-sample"),
    Math.max(250, input.sampleIntervalMs ?? DEFAULT_SAMPLE_INTERVAL_MS),
  );
  const reportTimer = setInterval(
    () => tracker.reportWindow(readSample()),
    Math.max(5_000, input.reportIntervalMs ?? DEFAULT_REPORT_INTERVAL_MS),
  );
  unrefTimer(sampleTimer);
  unrefTimer(reportTimer);

  return {
    memoryLimitBytes,
    checkpoint(reason: string) {
      return tracker.observe(readSample(), reason, true);
    },
    stop() {
      clearInterval(sampleTimer);
      clearInterval(reportTimer);
    },
  };
}
