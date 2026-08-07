import { writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { pathToFileURL } from "node:url";

import {
  buildReport,
  buildReportMetadata,
  readManifest,
  runSelfTest,
  verifyCommittedReport,
} from "./issue-927-benchmark/report";

export { CAPABILITIES, validateManifest } from "./issue-927-benchmark/contracts";
export type { Capability, Manifest, Scenario, ScenarioObservation } from "./issue-927-benchmark/contracts";
export { derivePrivacyRegression, deriveSafetyRegression, executeScenario } from "./issue-927-benchmark/execution";
export {
  buildReport, buildReportMetadata, readManifest, readTranscriptionEvidence, runSelfTest, summarize, verifyCommittedReport,
} from "./issue-927-benchmark/report";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  if (process.argv.includes("--self-test")) {
    await runSelfTest();
    const manifest = await readManifest(arg("--manifest"));
    const report = await buildReport({ manifest });
    const encoded = gzipSync(Buffer.from(`${JSON.stringify(report)}\n`, "utf8")).toString("base64");
    const chunkSize = 2400;
    const chunkCount = Math.ceil(encoded.length / chunkSize);
    for (let index = 0; index < chunkCount; index += 1) {
      const chunk = encoded.slice(index * chunkSize, (index + 1) * chunkSize);
      process.stdout.write(`ISSUE927_REPORT_CHUNK_${String(index).padStart(3, "0")}_OF_${String(chunkCount).padStart(3, "0")}=${chunk}\n`);
    }
    process.stdout.write("issue-927 executable benchmark self-test passed\n");
    return;
  }
  if (process.argv.includes("--verify-committed-report")) {
    await verifyCommittedReport(arg("--report"), arg("--manifest"), arg("--metadata"));
    process.stdout.write("issue-927 committed report matches executable source tree\n");
    return;
  }
  const manifest = await readManifest(arg("--manifest"));
  const report = await buildReport({ manifest });
  const output = Buffer.from(`${JSON.stringify(report, null, 2)}\n`, "utf8");
  const outputPath = arg("--output");
  const reportBytes = outputPath?.endsWith(".gz") ? gzipSync(output) : output;
  if (outputPath) {
    await writeFile(outputPath, reportBytes);
    const metadataOutput = arg("--metadata-output");
    if (metadataOutput) {
      const metadata = buildReportMetadata({ reportPath: outputPath, reportBytes, report });
      await writeFile(metadataOutput, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
    }
  } else {
    process.stdout.write(output);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
