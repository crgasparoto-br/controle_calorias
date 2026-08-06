import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { buildReport, readManifest, runSelfTest, verifyCommittedReport } from "./issue-927-benchmark/report";

export { CAPABILITIES, validateManifest } from "./issue-927-benchmark/contracts";
export type { Capability, Manifest, Scenario, ScenarioObservation } from "./issue-927-benchmark/contracts";
export { executeScenario } from "./issue-927-benchmark/execution";
export {
  buildReport, readManifest, readTranscriptionEvidence, runSelfTest, summarize, verifyCommittedReport,
} from "./issue-927-benchmark/report";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  if (process.argv.includes("--self-test")) {
    await runSelfTest();
    process.stdout.write("issue-927 executable benchmark self-test passed\n");
    return;
  }
  if (process.argv.includes("--verify-committed-report")) {
    await verifyCommittedReport(arg("--report"), arg("--manifest"));
    process.stdout.write("issue-927 committed report matches executable source tree\n");
    return;
  }
  const manifest = await readManifest(arg("--manifest"));
  const report = await buildReport({ manifest });
  const output = `${JSON.stringify(report, null, 2)}\n`;
  const outputPath = arg("--output");
  if (outputPath) await writeFile(outputPath, output, "utf8");
  else process.stdout.write(output);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
