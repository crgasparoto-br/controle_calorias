import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { isFoodArchitectureSourcePath, readFoodFilesAtGitRef } from "./food-architecture-baseline";

vi.mock("node:child_process", async importOriginal => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, execFileSync: vi.fn(actual.execFileSync) };
});

function withRepository(verify: (cwd: string, git: (...args: string[]) => string) => void) {
  const cwd = mkdtempSync(path.join(tmpdir(), "food-baseline-batch-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
  try {
    git("init", "-q", "--template=");
    git("config", "user.email", "test@example.invalid");
    git("config", "user.name", "Synthetic");
    verify(cwd, git);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

function oldRead(ref: string, git: (...args: string[]) => string) {
  return git("ls-tree", "-r", "--name-only", ref).split(/\r?\n/).filter(isFoodArchitectureSourcePath)
    .map(file => ({ path: file, content: git("show", ref + ":" + file) }));
}

describe("immutable baseline reads in bounded Git batches", () => {
  it("keeps order, repeated objects, empty/multiline/binary UTF-8, modes and historical path selection", () => {
    withRepository((cwd, git) => {
      mkdirSync(path.join(cwd, "server"));
      const payloads: [string, string | Buffer][] = [
        ["a.ts", "same content\nnext line\n"], ["a with space.json", "same content\nnext line\n"],
        ["empty.ts", ""], ["binary.mts", Buffer.from([0xff, 0, 0x0a, 0x0d, 0xe3])],
        ["acentuádo.ts", "export const a = 1;"], ["quoted\nname.ts", "export const a = 2;"],
        ["excluded.md", "x"],
      ];
      for (const [file, content] of payloads) writeFileSync(path.join(cwd, "server", file), content);
      symlinkSync("a.ts", path.join(cwd, "server", "link.ts"));
      git("add", ".");
      git("commit", "-qm", "first");
      const original = git("rev-parse", "HEAD").trim();
      git("update-index", "--add", "--cacheinfo", "160000," + original + ",generated.ts");
      git("commit", "-qm", "non-blob entry");
      for (const ref of [original, "HEAD"]) {
        expect(readFoodFilesAtGitRef(ref, cwd)).toEqual(oldRead(ref, git));
      }
      expect(readFoodFilesAtGitRef(original, cwd).map(item => item.path)).toContain("server/a with space.json");
      expect(readFoodFilesAtGitRef("HEAD", cwd).find(item => item.path === "generated.ts")?.content).toContain("first");
    });
  });

  it("keeps object order across batch boundaries", () => {
    withRepository((cwd, git) => {
      const expected = Array.from({ length: 130 }, (_, index) => {
        const file = String(index).padStart(3, "0") + ".ts";
        const content = index % 2 === 0 ? "" : "line "+ index + "\n";
        writeFileSync(path.join(cwd, file), content);
        return { path: file, content };
      });
      git("add", ".");
      git("commit", "-qm", "batch boundary");
      expect(readFoodFilesAtGitRef("HEAD", cwd)).toEqual(expected);
    });
  });

  it("fails on a missing object even though Git's batch process can exit successfully", () => {
    withRepository((cwd, git) => {
      writeFileSync(path.join(cwd, "missing.ts"), "synthetic-unique-blob");
      git("add", ".");
      git("commit", "-qm", "blob present when frozen");
      const blob = git("rev-parse", "HEAD:missing.ts").trim();
      rmSync(path.join(cwd, ".git", "objects", blob.slice(0, 2), blob.slice(2)));
      expect(() => oldRead("HEAD", git)).toThrow();
      expect(() => readFoodFilesAtGitRef("HEAD", cwd)).toThrow("Invalid or missing baseline Git object");
    });
  });

  it("rejects a batch header whose high bit would otherwise alias valid ASCII", async () => {
    const git = vi.mocked(execFileSync);
    const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
    const header = Buffer.from("a".repeat(40) + " blob 3\nfoo\n");
    header[0] = 0xe1;
    git.mockReturnValueOnce("source.ts\n").mockReturnValueOnce(header);
    try {
      expect(() => readFoodFilesAtGitRef("HEAD", "/unused")).toThrow("Invalid or missing baseline Git object");
    } finally {
      git.mockReset().mockImplementation(actual.execFileSync);
    }
  });

  it("does not silently accept missing refs, invalid refs or an empty eligible tree", () => {
    withRepository((cwd, git) => {
      git("commit", "--allow-empty", "-qm", "empty");
      expect(() => readFoodFilesAtGitRef("HEAD", cwd)).toThrow("no production TypeScript files");
      expect(() => readFoodFilesAtGitRef("does-not-exist", cwd)).toThrow();
      expect(() => readFoodFilesAtGitRef("HEAD~1", cwd)).toThrow("Invalid baseline Git ref");
    });
  });
});
