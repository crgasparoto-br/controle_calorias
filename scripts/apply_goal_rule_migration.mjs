import mysql from "mysql2/promise";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("DATABASE_URL não está definida.");
  process.exit(1);
}

const connection = await mysql.createConnection(databaseUrl);

async function tableExists(tableName) {
  const [rows] = await connection.query("SHOW TABLES LIKE ?", [tableName]);
  return rows.length > 0;
}

async function columnExists(tableName, columnName) {
  const [rows] = await connection.query(
    `
      SELECT COUNT(*) AS total
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = ?
        AND column_name = ?
    `,
    [tableName, columnName],
  );
  return Number(rows[0]?.total ?? 0) > 0;
}

async function indexExists(tableName, indexName) {
  const [rows] = await connection.query(
    `
      SELECT COUNT(*) AS total
      FROM information_schema.statistics
      WHERE table_schema = DATABASE()
        AND table_name = ?
        AND index_name = ?
    `,
    [tableName, indexName],
  );
  return Number(rows[0]?.total ?? 0) > 0;
}

function sameTargets(a, b) {
  return (
    Number(a.calories) === Number(b.calories) &&
    Number(a.proteinGrams) === Number(b.proteinGrams) &&
    Number(a.carbsGrams) === Number(b.carbsGrams) &&
    Number(a.fatGrams) === Number(b.fatGrams)
  );
}

async function applyStructuralMigration() {
  if (!(await tableExists("nutritionGoals"))) {
    console.log("Tabela nutritionGoals não encontrada. Nada para migrar.");
    return;
  }

  if (await indexExists("nutritionGoals", "nutritionGoals_user_weekday_idx")) {
    await connection.query("ALTER TABLE `nutritionGoals` DROP INDEX `nutritionGoals_user_weekday_idx`");
    console.log("Índice legado nutritionGoals_user_weekday_idx removido.");
  }

  if (!(await columnExists("nutritionGoals", "ruleType"))) {
    await connection.query("ALTER TABLE `nutritionGoals` ADD `ruleType` enum('default','exception') DEFAULT 'default' NOT NULL");
    console.log("Coluna ruleType criada.");
  }

  if (!(await columnExists("nutritionGoals", "durationType"))) {
    await connection.query("ALTER TABLE `nutritionGoals` ADD `durationType` enum('1_week','2_weeks','3_weeks','always') DEFAULT 'always' NOT NULL");
    console.log("Coluna durationType criada.");
  }

  if (!(await columnExists("nutritionGoals", "effectiveUntil"))) {
    await connection.query("ALTER TABLE `nutritionGoals` ADD `effectiveUntil` timestamp NULL");
    console.log("Coluna effectiveUntil criada.");
  }

  await connection.query("ALTER TABLE `nutritionGoals` MODIFY COLUMN `weekday` int NOT NULL DEFAULT -1");
  console.log("Coluna weekday ajustada para default -1.");

  if (!(await indexExists("nutritionGoals", "nutritionGoals_user_rule_window_idx"))) {
    await connection.query(
      "ALTER TABLE `nutritionGoals` ADD CONSTRAINT `nutritionGoals_user_rule_window_idx` UNIQUE(`userId`,`ruleType`,`weekday`,`effectiveFrom`)",
    );
    console.log("Índice único nutritionGoals_user_rule_window_idx criado.");
  }
}

async function migrateLegacyData() {
  const [rows] = await connection.query(`
    SELECT
      id,
      userId,
      ruleType,
      weekday,
      durationType,
      calories,
      proteinGrams,
      carbsGrams,
      fatGrams,
      effectiveFrom,
      effectiveUntil,
      createdAt,
      updatedAt
    FROM nutritionGoals
    ORDER BY userId ASC, updatedAt DESC, id DESC
  `);

  const byUser = new Map();
  for (const row of rows) {
    const list = byUser.get(row.userId) ?? [];
    list.push(row);
    byUser.set(row.userId, list);
  }

  for (const [userId, userRows] of byUser.entries()) {
    const defaultRule = userRows.find(row => row.ruleType === "default" && Number(row.weekday) === -1);
    const legacyRows = userRows.filter(row => row.ruleType === "default" && Number(row.weekday) >= 0 && Number(row.weekday) <= 6);

    if (!legacyRows.length) {
      continue;
    }

    const fallback = defaultRule ?? legacyRows.find(row => Number(row.weekday) === 0) ?? legacyRows[0];

    await connection.beginTransaction();
    try {
      if (!defaultRule) {
        await connection.query(
          `
            INSERT INTO nutritionGoals (
              userId,
              ruleType,
              weekday,
              durationType,
              calories,
              proteinGrams,
              carbsGrams,
              fatGrams,
              effectiveFrom,
              effectiveUntil,
              createdAt,
              updatedAt
            ) VALUES (?, 'default', -1, 'always', ?, ?, ?, ?, ?, NULL, ?, ?)
          `,
          [
            userId,
            fallback.calories,
            fallback.proteinGrams,
            fallback.carbsGrams,
            fallback.fatGrams,
            fallback.effectiveFrom,
            fallback.createdAt,
            fallback.updatedAt,
          ],
        );
      }

      for (const legacy of legacyRows) {
        const needsException = !sameTargets(legacy, fallback);

        if (needsException) {
          const [existingException] = await connection.query(
            `
              SELECT id
              FROM nutritionGoals
              WHERE userId = ?
                AND ruleType = 'exception'
                AND weekday = ?
                AND effectiveFrom = ?
              LIMIT 1
            `,
            [userId, legacy.weekday, legacy.effectiveFrom],
          );

          if (!existingException.length) {
            await connection.query(
              `
                INSERT INTO nutritionGoals (
                  userId,
                  ruleType,
                  weekday,
                  durationType,
                  calories,
                  proteinGrams,
                  carbsGrams,
                  fatGrams,
                  effectiveFrom,
                  effectiveUntil,
                  createdAt,
                  updatedAt
                ) VALUES (?, 'exception', ?, 'always', ?, ?, ?, ?, ?, NULL, ?, ?)
              `,
              [
                userId,
                legacy.weekday,
                legacy.calories,
                legacy.proteinGrams,
                legacy.carbsGrams,
                legacy.fatGrams,
                legacy.effectiveFrom,
                legacy.createdAt,
                legacy.updatedAt,
              ],
            );
          }
        }

        await connection.query("DELETE FROM nutritionGoals WHERE id = ?", [legacy.id]);
      }

      await connection.commit();
      console.log(`Usuário ${userId}: ${legacyRows.length} regra(s) legada(s) convertida(s).`);
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  }
}

try {
  await applyStructuralMigration();
  await migrateLegacyData();
  console.log("Migração 0004 aplicada com sucesso.");
} catch (error) {
  console.error("Falha ao aplicar a migração 0004.");
  console.error(error);
  process.exitCode = 1;
} finally {
  await connection.end();
}
