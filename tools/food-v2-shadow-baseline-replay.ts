/**
 * Manual read-only C4 diagnostic. No production sink, credential, network
 * request, Gate A approval, CI upload or activation is performed here.
 */
import { readFile, stat } from "node:fs/promises";
import { replaySanitizedFoodShadowEvents } from "../server/modules/foodIntelligenceV2/shadowBaselineReplay";

const MAX_INPUT_BYTES = 8 * 1024 * 1024;

async function main() {
  if (process.argv.length !== 3 || !process.argv[2] || process.argv[2].startsWith("-")) {
    throw new Error("usage: pnpm exec tsx tools/food-v2-shadow-baseline-replay.ts <sanitized-events.json>");
  }
  const path = process.argv[2];
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.size < 1 || metadata.size > MAX_INPUT_BYTES) {
    throw new Error("shadow replay input exceeds size/safety limits");
  }
  const data: unknown = JSON.parse(await readFile(path, "utf8"));
  const report = replaySanitizedFoodShadowEvents(data);
  // Aggregates only; never log raw data, the source path or per-request trace IDs.
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
}

main().catch(() => {
  // Avoid leaking sensitive input or filesystem paths through parse errors.
  process.stderr.write("shadow-baseline-replay: rejected or unavailable sanitized input\n");
  process.exitCode = 2;
});
