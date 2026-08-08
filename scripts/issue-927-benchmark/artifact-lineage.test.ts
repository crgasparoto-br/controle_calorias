import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  hashExecutableSourceTree,
  verifyPublishedResultArtifactLineage,
} from "./artifact-lineage";

function git(root: string, args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

async function createRepository() {
  const root = await mkdtemp(path.join(os.tmpdir(), "issue-927-lineage-"));
  git(root, ["init", "--quiet"]);
  git(root, ["config", "user.email", "issue-927@example.invalid"]);
  git(root, ["config", "user.name", "Issue 927 Test"]);
  await mkdir(path.join(root, "src"), { recursive: true });
  await mkdir(path.join(root, "docs/benchmarks/multi-provider/fixtures"), { recursive: true });
  await writeFile(path.join(root, "src/app.ts"), "export const value = 1;\n");
  await writeFile(
    path.join(root, "docs/benchmarks/multi-provider/fixtures/manifest.json"),
    "{\"rubricVersion\":\"test\"}\n",
  );
  git(root, ["add", "."]);
  git(root, ["commit", "--quiet", "-m", "tested executable tree"]);
  return { root, testedSha: git(root, ["rev-parse", "HEAD"]) };
}

async function writeArtifacts(root: string, report = "{\"passed\":true}\n") {
  const directory = path.join(root, "docs/benchmarks/multi-provider/results");
  await mkdir(directory, { recursive: true });
  const reportPath = path.join(directory, "report.json");
  const metadataPath = path.join(directory, "report.metadata.json");
  await writeFile(reportPath, report);
  await writeFile(metadataPath, "{\"reportSha256\":\"synthetic\"}\n");
  return { reportPath, metadataPath };
}

describe("issue 927 result artifact lineage", () => {
  it("keeps historical evidence valid after later executable changes", async () => {
    const { root, testedSha } = await createRepository();
    try {
      const historicalHash = await hashExecutableSourceTree({ root, ref: testedSha });
      const { reportPath, metadataPath } = await writeArtifacts(root);
      git(root, ["add", "docs/benchmarks/multi-provider/results"]);
      git(root, ["commit", "--quiet", "-m", "publish benchmark evidence"]);
      const artifactCommit = git(root, ["rev-parse", "HEAD"]);

      await writeFile(path.join(root, "src/app.ts"), "export const value = 2;\n");
      git(root, ["add", "src/app.ts"]);
      git(root, ["commit", "--quiet", "-m", "future product change"]);
      const verifiedHead = git(root, ["rev-parse", "HEAD"]);

      await expect(verifyPublishedResultArtifactLineage({
        root,
        artifactPaths: [reportPath, metadataPath],
        testedSha,
        verifiedHead,
      })).resolves.toEqual({ artifactCommit, delta: [
        "docs/benchmarks/multi-provider/results/report.json",
        "docs/benchmarks/multi-provider/results/report.metadata.json",
      ] });
      expect(await hashExecutableSourceTree({ root, ref: testedSha })).toBe(historicalHash);
      expect(await hashExecutableSourceTree({ root })).not.toBe(historicalHash);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects evidence published together with executable changes", async () => {
    const { root, testedSha } = await createRepository();
    try {
      const { reportPath, metadataPath } = await writeArtifacts(root);
      await writeFile(path.join(root, "src/app.ts"), "export const value = 2;\n");
      git(root, ["add", "."]);
      git(root, ["commit", "--quiet", "-m", "mix evidence and product change"]);
      const verifiedHead = git(root, ["rev-parse", "HEAD"]);

      await expect(verifyPublishedResultArtifactLineage({
        root,
        artifactPaths: [reportPath, metadataPath],
        testedSha,
        verifiedHead,
      })).rejects.toThrow(/changed executable sources/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects result bytes changed after their publication commit", async () => {
    const { root, testedSha } = await createRepository();
    try {
      const { reportPath, metadataPath } = await writeArtifacts(root);
      git(root, ["add", "docs/benchmarks/multi-provider/results"]);
      git(root, ["commit", "--quiet", "-m", "publish benchmark evidence"]);
      const verifiedHead = git(root, ["rev-parse", "HEAD"]);
      await writeFile(reportPath, "{\"passed\":false}\n");

      await expect(verifyPublishedResultArtifactLineage({
        root,
        artifactPaths: [reportPath, metadataPath],
        testedSha,
        verifiedHead,
      })).rejects.toThrow(/bytes changed after publication/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects report and metadata published in different commits", async () => {
    const { root, testedSha } = await createRepository();
    try {
      const directory = path.join(root, "docs/benchmarks/multi-provider/results");
      await mkdir(directory, { recursive: true });
      const reportPath = path.join(directory, "report.json");
      const metadataPath = path.join(directory, "report.metadata.json");
      await writeFile(reportPath, "{\"passed\":true}\n");
      git(root, ["add", "docs/benchmarks/multi-provider/results/report.json"]);
      git(root, ["commit", "--quiet", "-m", "publish report"]);
      await writeFile(metadataPath, "{\"reportSha256\":\"synthetic\"}\n");
      git(root, ["add", "docs/benchmarks/multi-provider/results/report.metadata.json"]);
      git(root, ["commit", "--quiet", "-m", "publish metadata later"]);
      const verifiedHead = git(root, ["rev-parse", "HEAD"]);

      await expect(verifyPublishedResultArtifactLineage({
        root,
        artifactPaths: [reportPath, metadataPath],
        testedSha,
        verifiedHead,
      })).rejects.toThrow(/were not published together/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
