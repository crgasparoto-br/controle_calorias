import { createHash } from "node:crypto";
import {
  classifyRuntimeMemoryPressure,
  detectCgroupMemoryLimitBytes,
  readRuntimeMemorySample,
  type RuntimeMemorySample,
} from "./runtimeResourceDiagnostics";

const MIB = 1024 * 1024;
type SafeOperationMetric = number | boolean | null;
type RuntimeMemoryOperationInput = {
  operation: string;
  stage: string;
  correlationValue?: string | null;
  metrics?: Record<string, SafeOperationMetric>;
  always?: boolean;
};
type RuntimeMemoryOperationDeps = {
  memoryLimitBytes?: number | null;
  memoryUsage?: () => NodeJS.MemoryUsage;
  readContainerUsageBytes?: () => number | null;
};
function roundMiB(bytes: number | null) {
  if (bytes === null) return null;
  return Math.round((bytes / MIB) * 10) / 10;
}
function roundRatio(ratio: number | null) {
  if (ratio === null) return null;
  return Math.round(ratio * 1_000) / 1_000;
}
export function hashRuntimeOperationCorrelation(value?: string | null) {
  if (!value) return null;
  return createHash("sha256").update(value).digest("hex").slice(0, 20);
}
export function buildRuntimeMemoryOperationSnapshot(
  input: RuntimeMemoryOperationInput,
  deps: RuntimeMemoryOperationDeps = {},
) {
  const sample: RuntimeMemorySample = readRuntimeMemorySample({
    memoryUsage: deps.memoryUsage,
    readContainerUsageBytes: deps.readContainerUsageBytes,
  });
  const memoryLimitBytes =
    deps.memoryLimitBytes === undefined
      ? detectCgroupMemoryLimitBytes()
      : deps.memoryLimitBytes;
  const pressure = classifyRuntimeMemoryPressure(sample, memoryLimitBytes);
  return {
    operation: input.operation,
    stage: input.stage,
    correlationId: hashRuntimeOperationCorrelation(input.correlationValue),
    rssMiB: roundMiB(sample.rssBytes),
    heapUsedMiB: roundMiB(sample.heapUsedBytes),
    heapTotalMiB: roundMiB(sample.heapTotalBytes),
    externalMiB: roundMiB(sample.externalBytes),
    arrayBuffersMiB: roundMiB(sample.arrayBuffersBytes),
    containerMiB: roundMiB(sample.containerBytes),
    memoryLimitMiB: roundMiB(memoryLimitBytes),
    pressureRatio: roundRatio(pressure.ratio),
    pressureBand: pressure.band,
    ...(input.metrics ?? {}),
  };
}
export function logRuntimeMemoryOperation(input: RuntimeMemoryOperationInput) {
  const detail = buildRuntimeMemoryOperationSnapshot(input);
  if (input.always || detail.pressureBand !== "normal") {
    console.info("[Runtime] memory_operation", detail);
  }
  return detail;
}
