import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const RESULT_PREFIX = "docs/benchmarks/multi-provider/results/";
const AUDIT_PREFIX = ".audit/";
const MANIFEST_PATH = "docs/benchmarks/multi-provider/fixtures/manifest.json";

function gitOutput(root: string, args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}

function gitText(root: string, args: string[]): string {
  return gitOutput(root, args).trim();
}

function gitBuffer(root: string, args: string[]): Buffer {
  return execFileSync("git", args, { cwd: root });
}

function repoRelative(root: string, filePath: string): string {
  const relative = path.relative(root, path.resolve(filePath));
  assert(
    relative.length > 0
      && relative !== ".."
      && !relative.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relative),
    `artifact path is outside the repository: ${filePath}`,
  );
  return relative.split(path.sep).join("/");
}

function isTracked(root: string, relative: string): boolean {
  try {
    execFileSync("git", ["ls-files", "--error-unmatch", "--", relative], {
      cwd: root,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

export function verificationHeadSha(root = DEFAULT_ROOT): string {
  return process.env.VERIFICATION_HEAD_SHA ?? gitText(root, ["rev-parse", "HEAD"]);
}

export function isTrackedResultArtifact(filePath: string, root = DEFAULT_ROOT): boolean {
  try {
    const relative = repoRelative(root, filePath);
    return relative.startsWith(RESULT_PREFIX) && isTracked(root, relative);
  } catch {
    return false;
  }
}

export async function hashExecutableSourceTree(input: {
  root?: string;
  ref?: string;
} = {}): Promise<string> {
  const root = input.root ?? DEFAULT_ROOT;
  const trackedOutput = input.ref
    ? gitOutput(root, ["ls-tree", "-r", "-z", "--name-only", input.ref])
    : gitOutput(root, ["ls-files", "-z"]);
  const tracked = trackedOutput.split("\0").filter(Boolean).filter(file => (
    !file.startsWith(RESULT_PREFIX)
    && !file.startsWith(AUDIT_PREFIX)
    && file !== MANIFEST_PATH
  ));
  tracked.push(MANIFEST_PATH);

  const hash = createHash("sha256");
  for (const relative of [...new Set(tracked)].sort()) {
    hash.update(relative);
    hash.update("\0");
    if (input.ref) {
      try {
        hash.update(gitBuffer(root, ["show", `${input.ref}:${relative}`]));
        hash.update("\0");
      } catch {
        hash.update(`${relative}\0<deleted>\0`);
      }
      continue;
    }

    const absolute = path.join(root, relative);
    try {
      if (!(await stat(absolute)).isFile()) continue;
      hash.update(await readFile(absolute));
      hash.update("\0");
    } catch {
      hash.update(`${relative}\0<deleted>\0`);
    }
  }
  return hash.digest("hex");
}

export async function verifyPublishedResultArtifactLineage(input: {
  artifactPaths: string[];
  testedSha: string;
  verifiedHead: string;
  root?: string;
}): Promise<{ artifactCommit: string; delta: string[] }> {
  const root = input.root ?? DEFAULT_ROOT;
  assert.match(input.testedSha, /^[0-9a-f]{40}$/u, "artifact lacks a tested commit SHA");
  assert.match(input.verifiedHead, /^[0-9a-f]{40}$/u, "verification head is not a commit SHA");
  assert(input.artifactPaths.length > 0, "at least one result artifact is required");

  const relatives = input.artifactPaths.map(filePath => repoRelative(root, filePath));
  for (const relative of relatives) {
    assert(relative.startsWith(RESULT_PREFIX), `artifact is outside ${RESULT_PREFIX}: ${relative}`);
    assert.equal(isTracked(root, relative), true, `artifact is not tracked: ${relative}`);
  }

  const artifactCommits = relatives.map(relative => gitText(root, ["log", "-1", "--format=%H", "--", relative]));
  const artifactCommit = artifactCommits[0] ?? "";
  assert.match(artifactCommit, /^[0-9a-f]{40}$/u, "result artifact has no publication commit");
  assert.equal(
    artifactCommits.every(commit => commit === artifactCommit),
    true,
    `result artifacts were not published together: ${artifactCommits.join(", ")}`,
  );

  execFileSync("git", ["merge-base", "--is-ancestor", input.testedSha, artifactCommit], { cwd: root });
  execFileSync("git", ["merge-base", "--is-ancestor", artifactCommit, input.verifiedHead], { cwd: root });
  const delta = gitOutput(root, ["diff", "--name-only", "-z", `${input.testedSha}..${artifactCommit}`])
    .split("\0")
    .filter(Boolean);
  assert.equal(
    delta.every(file => file.startsWith(RESULT_PREFIX)),
    true,
    `result artifact publication changed executable sources: ${delta.join(", ")}`,
  );

  for (let index = 0; index < relatives.length; index += 1) {
    const currentBytes = await readFile(input.artifactPaths[index]!);
    const publishedBytes = gitBuffer(root, ["show", `${artifactCommit}:${relatives[index]}`]);
    assert.deepEqual(
      currentBytes,
      publishedBytes,
      `result artifact bytes changed after publication: ${relatives[index]}`,
    );
  }

  return { artifactCommit, delta };
}
