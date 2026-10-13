import { execFileSync } from "node:child_process";
import { findFoodStaticCandidates, type FoodArchitectureFile, type FoodFinding } from "./food-intelligence-architecture";

export function compareFoodArchitectureFindings(current: FoodFinding[], baseline: FoodFinding[]) {
  const before = new Set(baseline.map(f => f.fingerprint));
  const after = new Set(current.map(f => f.fingerprint));
  return {
    added: current.filter(f => !before.has(f.fingerprint)),
    retained: current.filter(f => before.has(f.fingerprint)),
    removed: baseline.filter(f => !after.has(f.fingerprint)),
  };
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
