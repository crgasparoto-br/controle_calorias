import 'dotenv/config';
import mysql from 'mysql2/promise';

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL não configurada');
  }

  const connection = await mysql.createConnection(process.env.DATABASE_URL);

  const [recentMeals] = await connection.query(`
    select id, userId, mealLabel, source, sourceText, occurredAt, createdAt, updatedAt
    from meals
    where source = 'whatsapp'
    order by occurredAt desc
    limit 10
  `);

  const [recentInferences] = await connection.query(`
    select id, draftId, userId, source, sourceText, requestSummary, confidence, createdAt
    from mealInferences
    where source = 'whatsapp'
    order by createdAt desc
    limit 10
  `);

  const [recentLogs] = await connection.query(`
    select id, userId, origin, status, eventType, detail, createdAt
    from inferenceLogs
    where origin = 'whatsapp'
    order by createdAt desc
    limit 15
  `);

  console.log(JSON.stringify({ recentMeals, recentInferences, recentLogs }, null, 2));
  await connection.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
