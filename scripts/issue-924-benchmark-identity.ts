import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const COMMIT_SHA_PATTERN = /^[a-f0-9]{40}$/u;

function validateCommitSha(value: string, variableName: string): string {
  if (!COMMIT_SHA_PATTERN.test(value)) {
    throw new Error(`${variableName} must contain the exact 40-character commit SHA.`);
  }
  return value;
}

export async function resolveGitHead(cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
    cwd,
    encoding: "utf8",
  });
  const gitSha = stdout.trim();
  if (!COMMIT_SHA_PATTERN.test(gitSha)) {
    throw new Error("Unable to resolve the exact commit SHA for the benchmark result.");
  }
  return gitSha;
}

export async function assertCleanWorkingTree(cwd: string): Promise<void> {
  const { stdout } = await execFileAsync(
    "git",
    ["status", "--porcelain=v1", "--untracked-files=all"],
    { cwd, encoding: "utf8" },
  );
  if (stdout.trim()) {
    throw new Error(
      "Transcription benchmark requires a clean working tree before provider access.",
    );
  }
}

/**
 * Every environment-provided identity is an assertion about the checked-out
 * source, never a substitute for inspecting the repository itself.
 */
export async function resolveTestedSha(
  env: NodeJS.ProcessEnv,
  cwd: string,
): Promise<string> {
  const gitSha = await resolveGitHead(cwd);
  const exactHeadSha = env.TRANSCRIPTION_BENCHMARK_TESTED_SHA?.trim();
  const githubSha = env.GITHUB_SHA?.trim();

  if (exactHeadSha) {
    validateCommitSha(exactHeadSha, "TRANSCRIPTION_BENCHMARK_TESTED_SHA");
    if (exactHeadSha !== gitSha) {
      throw new Error(
        "TRANSCRIPTION_BENCHMARK_TESTED_SHA must match the checked-out HEAD.",
      );
    }
  }

  if (githubSha) {
    validateCommitSha(githubSha, "GITHUB_SHA");
    if (githubSha !== gitSha) {
      throw new Error("GITHUB_SHA must match the checked-out HEAD.");
    }
  }

  return exactHeadSha ?? githubSha ?? gitSha;
}
