import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Fase A1 (§21.1, item 1): nenhum entrypoint produtivo é migrado nesta entrega.
 *
 * Os contratos V2 existem apenas como declaração executável, adapters e testes.
 * Este controle trava a fronteira: qualquer import do módulo a partir de
 * handler, router, serviço ou UI deve falhar aqui antes de chegar à revisão.
 */
const REPOSITORY_ROOT = resolve(__dirname, "../../..");
const MODULE_DIRECTORY = resolve(__dirname);

const SCANNED_ROOTS = ["server", "client/src", "shared", "scripts"] as const;

const SOURCE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
];

const IGNORED_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  "artifacts",
]);

async function collectSourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRECTORIES.has(entry.name)) continue;
      files.push(...(await collectSourceFiles(join(directory, entry.name))));
      continue;
    }
    if (SOURCE_EXTENSIONS.some(extension => entry.name.endsWith(extension))) {
      files.push(join(directory, entry.name));
    }
  }

  return files;
}

describe("fronteira da Fase A1", () => {
  it("não tem consumidor produtivo fora do próprio módulo", async () => {
    const offenders: string[] = [];

    for (const root of SCANNED_ROOTS) {
      const absoluteRoot = join(REPOSITORY_ROOT, root);
      let files: string[];
      try {
        files = await collectSourceFiles(absoluteRoot);
      } catch {
        continue;
      }

      for (const file of files) {
        if (file.startsWith(`${MODULE_DIRECTORY}${sep}`)) continue;
        const source = await readFile(file, "utf8");
        if (/foodIntelligenceV2/.test(source)) {
          offenders.push(relative(REPOSITORY_ROOT, file));
        }
      }
    }

    expect(offenders).toStrictEqual([]);
  });
});
