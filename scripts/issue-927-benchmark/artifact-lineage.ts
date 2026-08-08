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
const GIT_BATCH_MAX_BUFFER = 128 * 1024 * 1024;

type HistoricalTreeEntry = {
  path: string;
  objectSha: string;
};

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

function parseHistoricalTreeEntries(root: string, ref: string): HistoricalTreeEntry[] {
  const tree = execFileSync("git", ["ls-tree", "-r", "-z", "--full-tree", ref], {
    cwd: root,
    encoding: "buffer",
  });
  const entries: HistoricalTreeEntry[] = [];
  let recordStart = 0;
  for (let index = 0; index <= tree.length; index += 1) {
    if (index !== tree.length && tree[index] !== 0) continue;
    if (index === recordStart) {
      recordStart = index + 1;
      continue;
    }
    const record = tree.subarray(recordStart, index).toString("utf8");
    recordStart = index + 1;
    const tab = record.indexOf("\t");
    assert(tab > 0, `invalid git ls-tree record: ${record}`);
    const [mode, type, objectSha] = record.slice(0, tab).split(" ");
    const relative = record.slice(tab + 1);
    assert(mode && type && objectSha && relative, `incomplete git ls-tree record: ${record}`);
    if (type !== "blob") continue;
    if (
      relative.startsWith(RESULT_PREFIX)
      || relative.startsWith(AUDIT_PREFIX)
      || relative === MANIFEST_PATH
    ) continue;
    entries.push({ path: relative, objectSha });
  }

  const manifestRecord = gitText(root, ["ls-tree", ref, "--", MANIFEST_PATH]);
  if (manifestRecord) {
    const tab = manifestRecord.indexOf("\t");
    assert(tab > 0, `invalid manifest ls-tree record: ${manifestRecord}`);
    const [, type, objectSha] = manifestRecord.slice(0, tab).split(" ");
    assert.equal(type, "blob", `manifest is not a blob at ${ref}`);
    assert(objectSha, `manifest object missing at ${ref}`);
    entries.push({ path: MANIFEST_PATH, objectSha });
  }

  return entries.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
}

function readHistoricalBlobs(root: string, objectShas: string[]): Map<string, Buffer> {
  const uniqueObjectShas = [...new Set(objectShas)];
  if (!uniqueObjectShas.length) return new Map();
  const batch = execFileSync("git", ["cat-file", "--batch"], {
    cwd: root,
    input: Buffer.from(`${uniqueObjectShas.join("\n")}\n`, "utf8"),
    maxBuffer: GIT_BATCH_MAX_BUFFER,
  });
  const blobs = new Map<string, Buffer>();
  let offset = 0;

  for (const requestedSha of uniqueObjectShas) {
    const headerEnd = batch.indexOf(10, offset);
    assert(headerEnd >= 0, `missing git cat-file header for ${requestedSha}`);
    const header = batch.subarray(offset, headerEnd).toString("utf8");
    const [objectSha, type, sizeText] = header.split(" ");
    assert.notEqual(type, "missing", `git object missing: ${requestedSha}`);
    assert.equal(type, "blob", `git object is not a blob: ${requestedSha}`);
    assert.match(objectSha ?? "", /^[0-9a-f]{40,64}$/u, `invalid git object SHA: ${header}`);
    const size = Number(sizeText);
    assert(Number.isSafeInteger(size) && size >= 0, `invalid git blob size: ${header}`);
    const contentStart = headerEnd + 1;
    const contentEnd = contentStart + size;
    assert(contentEnd < batch.length, `truncated git blob: ${requestedSha}`);
    blobs.set(requestedSha, batch.subarray(contentStart, contentEnd));
    offset = contentEnd + 1;
  }

  return blobs;
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
  const hash = createHash("sha256");

  if (input.ref) {
    const entries = parseHistoricalTreeEntries(root, input.ref);
    const blobs = readHistoricalBlobs(root, entries.map(entry => entry.objectSha));
    for (const entry of entries) {
      hash.update(entry.path);
      hash.update("\0");
      const blob = blobs.get(entry.objectSha);
      assert(blob, `historical blob was not loaded: ${entry.path}`);
      hash.update(blob);
      hash.update("\0");
    }
    if (!entries.some(entry => entry.path === MANIFEST_PATH)) {
      hash.update(MANIFEST_PATH);
      hash.update("\0");
      hash.update(`${MANIFEST_PATH}\0<deleted>\0`);
    }
    return hash.digest("hex");
  }

  const tracked = gitOutput(root, ["ls-files", "-z"])
    .split("\0")
    .filter(Boolean)
    .filter(file => (
      !file.startsWith(RESULT_PREFIX)
      && !file.startsWith(AUDIT_PREFIX)
      && file !== MANIFEST_PATH
    ));
  tracked.push(MANIFEST_PATH);

  for (const relative of [...new Set(tracked)].sort()) {
    const absolute = path.join(root, relative);
    hash.update(relative);
    hash.update("\0");
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
