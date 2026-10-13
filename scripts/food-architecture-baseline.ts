import { execFileSync } from "node:child_process";
import { findFoodStaticCandidates, type FoodArchitectureFile, type FoodFinding } from "./food-intelligence-architecture";

export function compareFoodArchitectureFindings(current: FoodFinding[], baseline: FoodFinding[]) {
  // Multiset comparison, not Set comparison. An identical rule added in a
  // second scope remains a new violation and cannot hide behind legacy.
  const remaining = new Map<string, number>();
  for (const finding of baseline) {
    remaining.set(finding.fingerprint, (remaining.get(finding.fingerprint) ?? 0) + 1);
  }
  const added: FoodFinding[] = [];
  const retained: FoodFinding[] = [];
  for (const finding of current) {
    const count = remaining.get(finding.fingerprint) ?? 0;
    if (count > 0) {
      retained.push(finding);
      remaining.set(finding.fingerprint, count - 1);
    } else {
      added.push(finding);
    }
  }
  const removed = baseline.filter(finding => {
    const count = remaining.get(finding.fingerprint) ?? 0;
    if (!count) return false;
    remaining.set(finding.fingerprint, count - 1);
    return true;
  });
  return { added, retained, removed };
}

/**
 * Uses an immutable Git tree, not a mutable best-effort search index. This
 * comparison is evidence, not an automatic interpretation of ADR §25 item 25.
 */
export function readFoodFilesAtGitRef(ref: string, cwd: string): FoodArchitectureFile[] {
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,200}$/.test(ref) || ref.startsWith("-") ||
      ref.includes("..") || ref.includes("//")) {
    throw new Error("Invalid baseline Git ref");
  }
  const git = (...args: string[]) => execFileSync("git", args, {
    cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024,
  });
  const names = git("ls-tree", "-r", "--name-only", ref, "--", "server", "shared", "client/src")
    .split(/\r?\n/).filter(Boolean)
    .filter(name => /^(?:server|shared|client\/src)\/.+\.[cm]?tsx?$/.test(name));
  if (!names.length) throw new Error("Baseline Git tree contains no production TypeScript files: " + ref);
  return names.map(file => ({
    path: file,
    content: git("show", ref + ":" + file),
  }));
}

export function findFoodBaselineDelta(
  currentFiles: FoodArchitectureFile[], baselineRef: string, cwd: string,
) {
  const baseline = findFoodStaticCandidates(readFoodFilesAtGitRef(baselineRef, cwd));
  const current = findFoodStaticCandidates(currentFiles);
  return compareFoodArchitectureFindings(current, baseline);
}
