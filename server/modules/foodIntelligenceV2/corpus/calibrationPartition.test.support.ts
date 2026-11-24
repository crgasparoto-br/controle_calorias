/** The split authority comes from preregistered corpus identities, not results. */
import { createHash } from "node:crypto";
import type { GoldenCorpusCase } from "./contracts";
import { goldenFoodCorpus } from "./data";

export type CalibrationSplit = "calibration" | "holdout";
const splits = ["calibration", "holdout"] as const;

export type CalibrationPartitionMember = Readonly<{
  caseId: string;
  semanticGroups: readonly string[];
}>;

export type CalibrationPartitionManifest = Readonly<
  {
    schemaVersion: 1;
    corpusVersion: string;
  } & Record<CalibrationSplit, readonly CalibrationPartitionMember[]>
>;

type CorpusIdentity = Pick<
  GoldenCorpusCase,
  "caseId" | "split" | "metamorphicGroup" | "learningScenarioId"
>;

function identity(value: string): boolean {
  return (
    typeof value === "string" && value.length > 0 && value.trim() === value
  );
}

function ordered(rows: readonly CalibrationPartitionMember[]) {
  return rows
    .map(({ caseId, semanticGroups }) => ({
      caseId,
      semanticGroups: [...semanticGroups].sort(),
    }))
    .sort((a, b) => a.caseId.localeCompare(b.caseId));
}

function disjoint(
  manifest: CalibrationPartitionManifest,
  corpusVersion: string
) {
  if (
    !manifest ||
    manifest.schemaVersion !== 1 ||
    manifest.corpusVersion !== corpusVersion ||
    !identity(corpusVersion)
  )
    throw new Error("calibration: missing or mismatched partition manifest");
  const seenIds = new Set<string>();
  const groupOwners = new Map<string, CalibrationSplit>();
  for (const split of splits) {
    const members = manifest[split];
    if (!Array.isArray(members) || members.length === 0) {
      throw new Error("calibration: empty or invalid partition manifest");
    }
    for (const row of members) {
      if (
        !row ||
        !identity(row.caseId) ||
        !Array.isArray(row.semanticGroups) ||
        new Set(row.semanticGroups).size !== row.semanticGroups.length ||
        row.semanticGroups.some((group: string) => !identity(group))
      ) {
        throw new Error("calibration: invalid manifest case or semantic group");
      }
      if (seenIds.has(row.caseId))
        throw new Error("calibration: case reused across partition membership");
      seenIds.add(row.caseId);
      for (const group of row.semanticGroups) {
        const owner = groupOwners.get(group);
        if (owner && owner !== split)
          throw new Error(
            "calibration: semantic group crosses calibration and holdout"
          );
        groupOwners.set(group, split);
      }
    }
  }
}

export function calibrationPartitionMember(
  entry: CorpusIdentity
): CalibrationPartitionMember {
  return {
    caseId: entry.caseId,
    // Both declarations matter, including a case which belongs to both types.
    semanticGroups: [
      ...(entry.metamorphicGroup
        ? ["metamorphic:" + entry.metamorphicGroup]
        : []),
      ...(entry.learningScenarioId
        ? ["learning:" + entry.learningScenarioId]
        : []),
    ],
  };
}

export function createCalibrationPartitionManifest(
  corpusVersion: string,
  entries: readonly CorpusIdentity[]
): CalibrationPartitionManifest {
  const members = (split: CalibrationSplit) =>
    Object.freeze(
      ordered(
        entries
          .filter(entry => entry.split === split)
          .map(calibrationPartitionMember)
      ).map(row =>
        Object.freeze({
          ...row,
          semanticGroups: Object.freeze(row.semanticGroups),
        })
      )
    );
  const manifest = Object.freeze({
    schemaVersion: 1 as const,
    corpusVersion,
    calibration: members("calibration"),
    holdout: members("holdout"),
  });
  disjoint(manifest, corpusVersion);
  return manifest;
}

function manifestDigest(manifest: CalibrationPartitionManifest): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        schemaVersion: manifest.schemaVersion,
        corpusVersion: manifest.corpusVersion,
        calibration: ordered(manifest.calibration),
        holdout: ordered(manifest.holdout),
      })
    )
    .digest("hex");
}

export const GOLDEN_CALIBRATION_PARTITIONS = createCalibrationPartitionManifest(
  goldenFoodCorpus.corpusVersion,
  goldenFoodCorpus.cases
);
const goldenDigest = manifestDigest(GOLDEN_CALIBRATION_PARTITIONS);

export function verifyCalibrationPartitions(
  manifest: CalibrationPartitionManifest,
  corpusVersion: string
): string {
  disjoint(manifest, corpusVersion);
  const digest = manifestDigest(manifest);
  if (
    corpusVersion !== GOLDEN_CALIBRATION_PARTITIONS.corpusVersion ||
    digest !== goldenDigest
  ) {
    throw new Error(
      "calibration: partition differs from the canonical Golden Food Corpus"
    );
  }
  return digest;
}

export function assertCalibrationMembership(
  manifest: CalibrationPartitionManifest,
  split: CalibrationSplit,
  facts: readonly CalibrationPartitionMember[]
): void {
  if (
    JSON.stringify(ordered(manifest[split])) !== JSON.stringify(ordered(facts))
  ) {
    throw new Error(
      "calibration: split membership mismatch (case or semantic group)"
    );
  }
}
