import fs from 'node:fs/promises';
import mysql from 'mysql2/promise';

const migrationPath = new URL('../drizzle/0002_purple_stature.sql', import.meta.url);
const sql = await fs.readFile(migrationPath, 'utf8');
const statements = sql
  .split('--> statement-breakpoint')
  .map((part) => part.trim())
  .filter(Boolean);

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL não está configurada no ambiente.');
}

const connection = await mysql.createConnection(process.env.DATABASE_URL);

async function backfillLegacyDraftIds() {
  const fixSql = `
    UPDATE mealInferences
    SET draftId = CONCAT('legacy-', id)
    WHERE draftId IS NULL OR draftId = '' OR draftId = '?'
  `;
  const [result] = await connection.execute(fixSql);
  console.log(`[backfill] draftId ajustado em ${result.affectedRows ?? 0} registro(s) legados`);
}

try {
  for (const statement of statements) {
    try {
      await connection.execute(statement);
      console.log(`[applied] ${statement}`);
    } catch (error) {
      const code = error?.code ?? 'UNKNOWN';
      const message = error?.message ?? String(error);
      const ignorable = new Set(['ER_DUP_FIELDNAME', 'ER_DUP_KEYNAME', 'ER_MULTIPLE_PRI_KEY']);
      const isDuplicateName = /Duplicate column name|Duplicate key name/i.test(message);

      if (ignorable.has(code) || isDuplicateName) {
        console.log(`[skipped:${code}] ${statement}`);
        continue;
      }

      const isUniqueDraftConstraint =
        code === 'ER_DUP_ENTRY' && /mealInferences_draftId_unique/i.test(message);

      if (isUniqueDraftConstraint) {
        await backfillLegacyDraftIds();
        await connection.execute(statement);
        console.log(`[applied-after-backfill] ${statement}`);
        continue;
      }

      throw error;
    }
  }
} finally {
  await connection.end();
}
