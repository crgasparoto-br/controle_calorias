import "dotenv/config";
import mysql from "mysql2/promise";
import { normalizeCatalogText } from "../server/modules/foods/catalog";

type UnclassifiedItemRow = {
  id: number;
  foodName: string;
  canonicalName: string;
};

type CatalogRow = {
  id: number;
  name: string;
  aliases: string | null;
};

const DRY_RUN = process.argv.includes("--dry-run");

function buildConnectionOptions() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to backfill food classification links.");
  }

  const useSsl = process.env.TIDB_ENABLE_SSL === "true" || databaseUrl.includes("tidbcloud.com");
  if (!useSsl) return databaseUrl;

  const url = new URL(databaseUrl);
  return {
    host: url.hostname,
    port: Number(url.port || 4000),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ""),
    ssl: { minVersion: "TLSv1.2" as const },
  };
}

function parseJsonArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

async function main() {
  const connection = await mysql.createConnection(buildConnectionOptions());
  try {
    const [itemRows] = await connection.execute(
      `SELECT id, foodName, canonicalName
       FROM mealItems
       WHERE foodCatalogId IS NULL`,
    );
    const items = itemRows as UnclassifiedItemRow[];

    if (!items.length) {
      console.log("[Backfill] Nenhum item sem vínculo de catálogo encontrado. Nada a fazer.");
      return;
    }

    const [catalogRows] = await connection.execute(
      `SELECT id, name, aliases FROM foodCatalog`,
    );
    const catalogIndex = new Map<string, number>();
    for (const row of catalogRows as CatalogRow[]) {
      for (const key of [row.name, ...parseJsonArray(row.aliases)].map(value => normalizeCatalogText(value))) {
        if (key) catalogIndex.set(key, row.id);
      }
    }

    const groups = new Map<string, UnclassifiedItemRow[]>();
    for (const item of items) {
      const key = normalizeCatalogText(item.canonicalName || item.foodName);
      const bucket = groups.get(key) ?? [];
      bucket.push(item);
      groups.set(key, bucket);
    }

    let matchedViaCatalog = 0;
    const pendingReview: Array<{ key: string; count: number }> = [];

    for (const [key, groupItems] of groups) {
      const existingCatalogId = catalogIndex.get(key);
      if (!existingCatalogId) {
        pendingReview.push({ key, count: groupItems.length });
        continue;
      }

      matchedViaCatalog += groupItems.length;
      console.log(`[Backfill] "${key}" corresponde ao catálogo (id ${existingCatalogId}) — ${groupItems.length} item(ns).`);
      if (!DRY_RUN) {
        const ids = groupItems.map(item => item.id);
        await connection.query(
          `UPDATE mealItems SET foodCatalogId = ? WHERE id IN (${ids.map(() => "?").join(",")})`,
          [existingCatalogId, ...ids],
        );
      }
    }

    console.log("\n[Backfill] Resumo:");
    console.log(`  Itens vinculados por correspondência determinística: ${matchedViaCatalog}`);
    console.log(`  Nomes encaminhados para revisão/curadoria: ${pendingReview.length}`);
    for (const pending of pendingReview) {
      console.log(`  - "${pending.key}" (${pending.count} item(ns))`);
    }
    console.log("  Nenhuma inferência externa de FOOD_CLASSIFICATION foi executada.");
    if (DRY_RUN) console.log("  (modo --dry-run: nenhuma escrita foi feita no banco)");
  } finally {
    await connection.end();
  }
}

main().catch(error => {
  console.error("[Backfill] Execução falhou:", error instanceof Error ? error.message : error);
  process.exit(1);
});
