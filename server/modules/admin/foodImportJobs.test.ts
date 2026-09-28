import { beforeEach, describe, expect, it, vi } from "vitest";

const { importFoodsMock } = vi.hoisted(() => ({
  importFoodsMock: vi.fn(),
}));

vi.mock("../../../scripts/import-foods/run_food_import.ts", () => ({
  importFoods: importFoodsMock,
}));

import { runFoodImportJob } from "./foodImportJobs";
import { runFoodImportJobSchema } from "./schemas";

const report = {
  sourceSlug: "taco",
  sourceVersion: "2026.1",
  sourceContentHash: "hash",
  importId: 1,
  inserted: 1,
  updated: 0,
  ignored: 0,
  aliasesInserted: 0,
  portionsInserted: 0,
  possibleDuplicates: [],
  errors: [],
};

describe("runFoodImportJob", () => {
  beforeEach(() => {
    importFoodsMock.mockReset();
    importFoodsMock.mockResolvedValue(report);
  });

  it("usa referência administrativa segura e preserva o ator no executor", async () => {
    await runFoodImportJob(
      {
        job: "import_taco",
        csvContent: "nome,kcal,proteina,carboidratos,gordura\nArroz,128,2,28,1",
        fileName: "upload.csv",
        sourceVersion: "2026.1",
      },
      { initiatedBy: "admin:user:42" }
    );

    expect(importFoodsMock).toHaveBeenCalledWith(expect.anything(), {
      initiatedBy: "admin:user:42",
      transactionBatchSize: 50,
    });
    const [payload] = importFoodsMock.mock.calls[0];
    expect(payload.source.sourceReference).toBe("admin-upload");
    expect(payload.source.sourceUrl).toBeUndefined();
  });

  it("limita a versão administrativa ao tamanho suportado pela fonte", () => {
    for (const job of ["import_taco", "import_tbca"] as const) {
      const base = {
        job,
        csvContent: "nome,kcal\nArroz,128",
      };
      expect(
        runFoodImportJobSchema.safeParse({
          ...base,
          sourceVersion: "v".repeat(80),
        }).success
      ).toBe(true);
      expect(
        runFoodImportJobSchema.safeParse({
          ...base,
          sourceVersion: "v".repeat(81),
        }).success
      ).toBe(false);
    }
  });
});
