import mysql from 'mysql2/promise';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL não está configurada no ambiente.');
}

const connection = await mysql.createConnection(process.env.DATABASE_URL);

try {
  const [columns] = await connection.query(`
    SELECT COLUMN_NAME, IS_NULLABLE, COLUMN_TYPE
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'mealInferences'
      AND COLUMN_NAME IN ('draftId', 'sourceText', 'transcript', 'mediaJson')
    ORDER BY ORDINAL_POSITION
  `);

  const [indexes] = await connection.query(`
    SELECT INDEX_NAME, COLUMN_NAME, NON_UNIQUE
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'mealInferences'
      AND INDEX_NAME = 'mealInferences_draftId_unique'
  `);

  const [legacyRows] = await connection.query(`
    SELECT id, draftId FROM mealInferences ORDER BY id DESC LIMIT 5
  `);

  console.log(JSON.stringify({ columns, indexes, sampleRows: legacyRows }, null, 2));
} finally {
  await connection.end();
}
