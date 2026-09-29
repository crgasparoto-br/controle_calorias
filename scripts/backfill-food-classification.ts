import "dotenv/config";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import mysql from "mysql2/promise";
import { normalizeCatalogText } from "../server/modules/foods/catalog";

export type UnclassifiedItemRow = {
  id: number;
  userId: number;
  foodName: string;
  canonicalName: string;
  foodCatalogId?: number | null;
};

export type CatalogRow = {
  id: number;
  name: string;
  aliases: string | null;
  status?: "active" | "deprecated" | null;
  createdByUserId?: number | null;
};

export type PlannedBackfillLink = {
  userId: number;
  catalogId: number;
  items: UnclassifiedItemRow[];
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

export function parseJsonArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function isActive(row: CatalogRow) {
  return (row.status ?? "active") === "active";
}

function rowIdentityKeys(row: CatalogRow) {
  return [row.name, ...parseJsonArray(row.aliases)]
    .map(normalizeCatalogText)
    .filter(Boolean);
}

function itemIdentityKeys(item: Pick<UnclassifiedItemRow, "canonicalName" | "foodName">) {
  return [item.canonicalName, item.foodName]
    .map(value => normalizeCatalogText(value || ""))
    .filter(Boolean);
}

/**
 * Returns only keys that identify one active catalog row. Duplicate aliases
 * are deliberately omitted instead of being resolved by insertion order.
 */
export function buildDeterministicCatalogIndex(rows: CatalogRow[]) {
  const candidates = new Map<string, Set<number>>();
  for (const row of rows.filter(isActive)) {
    for (const key of rowIdentityKeys(row)) {
      const ids = candidates.get(key) ?? new Set<number>();
      ids.add(row.id);
      candidates.set(key, ids);
    }
  }

  return new Map(
    Array.from(candidates.entries())
      .filter(([, ids]) => ids.size === 1)
      .map(([key, ids]) => [key, Array.from(ids)[0]!] as const),
  );
}

export function resolveDeterministicCatalogId(
  item: Pick<UnclassifiedItemRow, "canonicalName" | "foodName">,
  userId: number,
  rows: CatalogRow[],
) {
  const visibleRows = rows.filter(
    row => isActive(row) && (row.createdByUserId == null || row.createdByUserId === userId),
  );
  const index = buildDeterministicCatalogIndex(visibleRows);
  const candidateIds = new Set<number>();
  for (const key of itemIdentityKeys(item)) {
    const catalogId = index.get(key);
    if (catalogId) candidateIds.add(catalogId);
  }

  return candidateIds.size === 1 ? Array.from(candidateIds)[0]! : null;
}

export function planDeterministicBackfill(items: UnclassifiedItemRow[], rows: CatalogRow[]) {
  const planned = new Map<string, PlannedBackfillLink>();
  const pendingByKey = new Map<string, { userId: number; key: string; count: number }>();

  for (const item of items) {
    if (item.foodCatalogId) continue;
    const key = normalizeCatalogText(item.canonicalName || item.foodName || "");
    const catalogId = resolveDeterministicCatalogId(item, item.userId, rows);
    if (!catalogId) {
      const pendingKey = `${item.userId}:${key}`;
      const existingPending = pendingByKey.get(pendingKey);
      if (existingPending) existingPending.count += 1;
      else pendingByKey.set(pendingKey, { userId: item.userId, key, count: 1 });
      continue;
    }

    const planKey = `${item.userId}:${catalogId}`;
    const existing = planned.get(planKey);
    if (existing) {
      existing.items.push(item);
    } else {
      planned.set(planKey, { userId: item.userId, catalogId, items: [item] });
    }
  }

  return { links: Array.from(planned.values()), pending: Array.from(pendingByKey.values()) };
}

async function main() {
  const connection = await mysql.createConnection(buildConnectionOptions());
  try {
    const [itemRows] = await connection.execute(
      `SELECT mi.id, m.userId, mi.foodName, mi.canonicalName
       FROM mealItems mi
       INNER JOIN meals m ON m.id = mi.mealId
       WHERE mi.foodCatalogId IS NULL
         AND m.status = 'confirmed'`,
    );
    const items = itemRows as UnclassifiedItemRow[];

    if (!items.length) {
      console.log("[Backfill] Nenhum item confirmado sem vínculo de catálogo encontrado. Nada a fazer.");
      return;
    }

    const [catalogRows] = await connection.execute(
      `SELECT id, name, aliases, status, createdByUserId
       FROM foodCatalog
       WHERE status = 'active'`,
    );
    const catalog = catalogRows as CatalogRow[];
    const { links, pending } = planDeterministicBackfill(items, catalog);
    let matchedViaCatalog = 0;

    for (const link of links) {
      matchedViaCatalog += link.items.length;
      console.log(`[Backfill] usuário ${link.userId}: ${link.items.length} item(ns) correspondem ao catálogo (id ${link.catalogId}).`);
      if (!DRY_RUN) {
        const ids = link.items.map(item => item.id);
        await connection.query(
          `UPDATE mealItems
           SET foodCatalogId = ?
           WHERE foodCatalogId IS NULL
             AND id IN (${ids.map(() => "?").join(",")})`,
          [link.catalogId, ...ids],
        );
      }
    }

    console.log("\n[Backfill] Resumo:");
    console.log(`  Itens vinculados por correspondência determinística: ${matchedViaCatalog}`);
    console.log(`  Nomes encaminhados para revisão/curadoria: ${pending.length}`);
    for (const item of pending) {
      console.log(`  - usuário ${item.userId}: "${item.key}" (${item.count} item(ns))`);
    }
    console.log("  Nenhuma inferência externa de FOOD_CLASSIFICATION foi executada.");
    if (DRY_RUN) console.log("  (modo --dry-run: nenhuma escrita foi feita no banco)");
  } finally {
    await connection.end();
  }
}

const invokedScript = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedScript && import.meta.url === pathToFileURL(invokedScript).href) {
  main().catch(error => {
    console.error("[Backfill] Execução falhou:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
