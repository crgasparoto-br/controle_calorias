import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
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
/**
 * Every source reachable from a productive entrypoint must be in the input
 * tree, even when its directory was introduced after this gate was written.
 * Only inert/tooling directories and the explicitly isolated V2 corpus support
 * files are excluded; runtime reachability is otherwise decided by
 * findFoodStaticCandidates, not by this filesystem predicate.
 */
export function isFoodArchitectureSourcePath(file: string): boolean {
  const normalized = file.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!/\.(?:[cm]?[jt]sx?|json)$/.test(normalized)) return false;
  // The V2 corpus is explicitly isolated by `noProductionConsumer.test.ts`:
  // its support files are doubles/fixtures, not productive sources, although
  // they share the `server/` tree.
  if (
    /^server\/modules\/foodIntelligenceV2\/corpus\/.*\.test\.support\.[cm]?tsx?$/.test(
      normalized
    )
  ) {
    return false;
  }
  // A docs/example.ts, a script or even a root-level module is inert until
  // loaded from runtime. Excluding its directory here would create an escape.
  const segments = normalized.split("/");
  return !segments.some(segment => ["node_modules", ".git", ".next", ".turbo",
    "coverage", "playwright-report", "test-results"].includes(segment));
}

export function readFoodWorkingFiles(cwd: string): FoodArchitectureFile[] {
  const result: FoodArchitectureFile[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(path.join(cwd, directory), { withFileTypes: true })) {
      const location = path.posix.join(directory, entry.name);
      if (entry.isDirectory()) {
        // Even dist/build can contain imported production code. Only inert paths
        // may be skipped here; graph reachability decides the actual scope.
        if (["node_modules", ".git", ".next", ".turbo", "coverage",
          "playwright-report", "test-results"].includes(entry.name)) continue;
        walk(location);
      } else if (entry.isFile() && isFoodArchitectureSourcePath(location)) {
        result.push({ path: location, content: readFileSync(path.join(cwd, location), "utf8") });
      }
    }
  };
  walk("");
  return result;
}

export function readFoodFilesAtGitRef(ref: string, cwd: string): FoodArchitectureFile[] {
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,200}$/.test(ref) || ref.startsWith("-") ||
      ref.includes("..") || ref.includes("//")) {
    throw new Error("Invalid baseline Git ref");
  }
  const git = (...args: string[]) => execFileSync("git", args, {
    cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024,
  });
  const names = git("ls-tree", "-r", "--name-only", ref)
    .split(/\r?\n/).filter(isFoodArchitectureSourcePath);
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
