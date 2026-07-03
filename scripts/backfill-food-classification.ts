import "dotenv/config";
import mysql from "mysql2/promise";
import { normalizeCatalogText } from "../server/modules/foods/catalog";
import { classifyFoodNameWithAi } from "../server/mealAiExtraction";

type UnclassifiedItemRow = {
  id: number;
  foodName: string;
  canonicalName: string;
  portionText: string;
  estimatedGrams: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  unit: string;
};

type CatalogRow = {
  id: number;
  name: string;
  aliases: string | null;
};

const DRY_RUN = process.argv.includes("--dry-run");
const LIMIT_ARG = process.argv.find(arg => arg.startsWith("--limit="));
const AI_CALL_LIMIT = LIMIT_ARG ? Number(LIMIT_ARG.split("=")[1]) : Infinity;
const AI_CALL_CONCURRENCY = 3;

function buildConnectionOptions() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to backfill food classification.");
  }

  const useSsl = process.env.TIDB_ENABLE_SSL === "true" || databaseUrl.includes("tidbcloud.com");
  if (!useSsl) {
    return databaseUrl;
  }

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
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function buildSlug(name: string) {
  const base = normalizeCatalogText(name).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "alimento";
  return `backfill-${base}-${Date.now()}-${Math.round(Math.random() * 1e6)}`.slice(0, 128);
}

async function main() {
  const connection = await mysql.createConnection(buildConnectionOptions());
  try {
    const [itemRows] = await connection.execute(
      `SELECT id, foodName, canonicalName, portionText, estimatedGrams, calories, protein, carbs, fat, unit
       FROM mealItems
       WHERE foodCatalogId IS NULL`,
    );
    const items = itemRows as UnclassifiedItemRow[];

    if (!items.length) {
      console.log("[Backfill] Nenhum item sem classificação encontrado. Nada a fazer.");
      return;
    }

    const [catalogRows] = await connection.execute(
      `SELECT id, name, aliases FROM foodCatalog`,
    );
    const catalogIndex = new Map<string, number>();
    for (const row of catalogRows as CatalogRow[]) {
      const keys = [row.name, ...parseJsonArray(row.aliases)].map(normalizeCatalogText);
      for (const key of keys) {
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

    console.log(`[Backfill] ${items.length} itens sem classificação, agrupados em ${groups.size} nomes distintos.`);

    let matchedViaCatalog = 0;
    let classifiedViaAi = 0;
    let failed = 0;
    let aiCallsMade = 0;

    const groupEntries = Array.from(groups.entries());
    const pendingAiGroups: Array<[string, UnclassifiedItemRow[]]> = [];

    for (const [key, groupItems] of groupEntries) {
      const existingCatalogId = catalogIndex.get(key);
      if (existingCatalogId) {
        matchedViaCatalog += groupItems.length;
        console.log(`[Backfill] "${key}" já existe no catálogo (id ${existingCatalogId}) — atualizando ${groupItems.length} item(ns).`);
        if (!DRY_RUN) {
          const ids = groupItems.map(item => item.id);
          await connection.query(
            `UPDATE mealItems SET foodCatalogId = ? WHERE id IN (${ids.map(() => "?").join(",")})`,
            [existingCatalogId, ...ids],
          );
        }
        continue;
      }

      pendingAiGroups.push([key, groupItems]);
    }

    console.log(`[Backfill] ${pendingAiGroups.length} nomes distintos precisam de classificação via IA (limite desta execução: ${AI_CALL_LIMIT === Infinity ? "sem limite" : AI_CALL_LIMIT}).`);

    if (DRY_RUN) {
      const wouldCall = Math.min(pendingAiGroups.length, AI_CALL_LIMIT);
      const itemsAffected = pendingAiGroups.slice(0, wouldCall).reduce((total, [, groupItems]) => total + groupItems.length, 0);
      console.log(`[Backfill] --dry-run: nenhuma chamada de IA foi feita. Chamaria a IA para ${wouldCall} nome(s) distinto(s), afetando ${itemsAffected} item(ns).`);
      for (const [key, groupItems] of pendingAiGroups.slice(0, wouldCall)) {
        console.log(`  - "${key}" (${groupItems.length} item(ns))`);
      }
      classifiedViaAi = itemsAffected;
    } else {
      let nextIndex = 0;
      const worker = async () => {
        while (nextIndex < pendingAiGroups.length && aiCallsMade < AI_CALL_LIMIT) {
          const currentIndex = nextIndex;
          nextIndex += 1;
          const [key, groupItems] = pendingAiGroups[currentIndex];
          const representative = groupItems[0];
          aiCallsMade += 1;

          try {
            const classification = await classifyFoodNameWithAi(representative.canonicalName || representative.foodName, representative.portionText);
            if (!classification) {
              failed += 1;
              console.warn(`[Backfill] IA não conseguiu classificar "${key}" — deixando sem classificação.`);
              continue;
            }

            console.log(`[Backfill] "${key}" classificado como ${classification.processingLevel} (fruta=${classification.isFruit}, vegetal=${classification.isVegetable}, fibra=${classification.fiberGrams}g) — ${groupItems.length} item(ns).`);

            const slug = buildSlug(representative.canonicalName || representative.foodName);
            const aliases = JSON.stringify(Array.from(new Set(groupItems.map(item => item.foodName))));
            const [insertResult] = await connection.query(
              `INSERT INTO foodCatalog
                (slug, name, aliases, foodType, dataSource, servingLabel, servingUnit, gramsPerServing, calories, protein, carbs, fat, fiber, isFruit, isVegetable, isUltraProcessed, processingLevel, classificationSource, classificationConfidence, isUserCreated, createdByUserId)
               VALUES (?, ?, ?, 'generic', 'ai_backfill', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ai_backfill', NULL, 1, NULL)`,
              [
                slug,
                representative.canonicalName || representative.foodName,
                aliases,
                representative.portionText || `${representative.estimatedGrams} g`,
                representative.unit || "g",
                representative.estimatedGrams || 100,
                representative.calories,
                representative.protein,
                representative.carbs,
                representative.fat,
                classification.fiberGrams,
                classification.isFruit ? 1 : 0,
                classification.isVegetable ? 1 : 0,
                classification.processingLevel === "ultra_processed" ? 1 : 0,
                classification.processingLevel,
              ],
            );
            const newCatalogId = (insertResult as mysql.ResultSetHeader).insertId;
            catalogIndex.set(key, newCatalogId);

            const ids = groupItems.map(item => item.id);
            await connection.query(
              `UPDATE mealItems SET foodCatalogId = ? WHERE id IN (${ids.map(() => "?").join(",")})`,
              [newCatalogId, ...ids],
            );
            classifiedViaAi += groupItems.length;
          } catch (error) {
            failed += 1;
            console.error(`[Backfill] Falha ao classificar "${key}":`, error instanceof Error ? error.message : error);
          }
        }
      };

      await Promise.all(Array.from({ length: Math.min(AI_CALL_CONCURRENCY, pendingAiGroups.length) }, worker));
    }

    console.log("\n[Backfill] Resumo:");
    console.log(`  Itens já resolvidos por correspondência direta no catálogo: ${matchedViaCatalog}`);
    console.log(`  Itens classificados via IA: ${classifiedViaAi}`);
    console.log(`  Nomes que falharam ou ficaram pendentes (fora do limite desta execução): ${failed + Math.max(pendingAiGroups.length - aiCallsMade, 0)}`);
    if (DRY_RUN) {
      console.log("  (modo --dry-run: nenhuma escrita foi feita no banco)");
    }
  } finally {
    await connection.end();
  }
}

main().catch(error => {
  console.error("[Backfill] Execução falhou:", error);
  process.exit(1);
});
