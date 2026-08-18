import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const typescriptModule = process.env.QUESTION_BENCH_TYPESCRIPT_PATH?.trim() || "typescript";
const ts = require(typescriptModule);
const sourceRoot = path.resolve(process.env.QUESTION_BENCH_SOURCE_ROOT || process.cwd());

const mockModules = new Map([
  ["server/db.ts", `
export function logInferenceEvent(event) {
  globalThis.__questionLatencyBench.events.push(event);
}
`],
  ["server/modules/whatsapp/intentContext.ts", `
export async function buildWhatsappIntentContext() {
  const state = globalThis.__questionLatencyBench;
  state.contextLoads.history += 1;
  await state.sleep(state.delays.history);
  return { recentTurns: [] };
}
`],
  ["server/modules/whatsapp/timeZoneContext.ts", `
export async function getWhatsAppOperationTimeZone() {
  return "America/Sao_Paulo";
}
`],
  ["server/modules/insights/service.ts", `
export async function getDashboardTodayOverview() {
  const state = globalThis.__questionLatencyBench;
  state.contextLoads.today += 1;
  await state.sleep(state.delays.today);
  return {
    today: {
      date: "2026-08-17",
      goal: 2000,
      consumed: 1200,
      burned: 0,
      water: { logs: [] },
      remaining: 800,
      net: 1200,
      quality: "ok",
    },
    meals: [],
    exercises: [],
    water: { logs: [] },
  };
}

export async function getWeeklyReportBundle() {
  const state = globalThis.__questionLatencyBench;
  state.contextLoads.currentWeek += 1;
  await state.sleep(state.delays.currentWeek);
  return {
    progress: { summary: {}, weight: {} },
    quality: {},
    weekly: [],
    mealsByDate: [],
  };
}

export async function getPeriodReportBundle() {
  const state = globalThis.__questionLatencyBench;
  state.contextLoads.last30Days += 1;
  await state.sleep(state.delays.last30Days);
  return {
    range: { startDate: "2026-07-19", endDate: "2026-08-17" },
    goal: {},
    totals: {},
    quality: {},
    habitAnalytics: {},
    weightTrend: {},
    daily: [],
  };
}
`],
  ["server/_core/ai/providerResolver.ts", `
export const DEFAULT_AI_PROVIDER_FACTORIES = {};

export function getAiProviderById() {
  return {
    async createTextResponse(request) {
      const state = globalThis.__questionLatencyBench;
      state.providerCalls += 1;
      await state.sleep(state.delays.llm);
      const offeredWebSearch = Array.isArray(request?.tools)
        && request.tools.some(tool => tool?.type === "web_search");
      state.offeredWebSearch = state.offeredWebSearch || offeredWebSearch;
      if (state.failureMode === "error") {
        const error = new Error("synthetic provider failure");
        error.code = "external_error";
        throw error;
      }
      if (state.failureMode === "timeout") {
        const error = new Error("synthetic provider timeout");
        error.code = "timeout";
        throw error;
      }
      return {
        id: "question-latency-benchmark",
        outputText: "Resposta segura",
        webSearch: offeredWebSearch ? { executed: false, sources: [] } : undefined,
      };
    },
    async createEmbeddings() { throw new Error("unexpected embedding call"); },
    async createAudioTranscription() { throw new Error("unexpected transcription call"); },
    async createImageGeneration() { throw new Error("unexpected image call"); },
  };
}
`],
]);

async function existingModulePath(basePath) {
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}.js`,
    `${basePath}.mjs`,
    path.join(basePath, "index.ts"),
    path.join(basePath, "index.tsx"),
    path.join(basePath, "index.js"),
  ];
  for (const candidate of candidates) {
    try {
      if ((await fs.stat(candidate)).isFile()) return candidate;
    } catch {
      // Continue to the next deterministic resolution candidate.
    }
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("node:")) return nextResolve(specifier, context);
  if (context.parentURL?.startsWith("file:") && specifier.startsWith(".")) {
    const parentPath = fileURLToPath(context.parentURL);
    const candidate = await existingModulePath(
      path.resolve(path.dirname(parentPath), specifier),
    );
    if (candidate) {
      return { url: pathToFileURL(candidate).href, shortCircuit: true };
    }
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (!url.startsWith("file:")) return nextLoad(url, context);
  const filename = fileURLToPath(url);
  const relativePath = path.relative(sourceRoot, filename).split(path.sep).join("/");
  const mockedSource = mockModules.get(relativePath);
  if (mockedSource !== undefined) {
    return { format: "module", source: mockedSource, shortCircuit: true };
  }
  if (filename.endsWith(".ts") || filename.endsWith(".tsx")) {
    const source = await fs.readFile(filename, "utf8");
    const output = ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
        verbatimModuleSyntax: false,
      },
      fileName: filename,
    }).outputText;
    return { format: "module", source: output, shortCircuit: true };
  }
  return nextLoad(url, context);
}
