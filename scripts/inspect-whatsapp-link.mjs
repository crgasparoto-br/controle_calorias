import 'dotenv/config';
import mysql from 'mysql2/promise';

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL não configurada');
  }

  const connection = await mysql.createConnection(process.env.DATABASE_URL);

  const [users] = await connection.query(`
    select id, openId, name, role, createdAt, updatedAt
    from users
    order by updatedAt desc
    limit 10
  `);

  const [connections] = await connection.query(`
    select id, userId, phoneNumber, displayName, status, createdAt, updatedAt
    from whatsappConnections
    order by updatedAt desc
    limit 20
  `);

  const [recentInferences] = await connection.query(`
    select id, draftId, userId, source, requestSummary, sourceText, transcript, confidence, createdAt
    from mealInferences
    where source = 'whatsapp'
    order by createdAt desc
    limit 20
  `);

  const [recentMeals] = await connection.query(`
    select id, userId, mealLabel, source, occurredAt, createdAt, updatedAt
    from meals
    where source = 'whatsapp'
    order by updatedAt desc
    limit 20
  `);

  const [recentLogs] = await connection.query(`
    select id, userId, origin, status, eventType, detail, createdAt
    from inferenceLogs
    where origin = 'whatsapp'
    order by createdAt desc
    limit 30
  `);

  console.log(JSON.stringify({ users, connections, recentInferences, recentMeals, recentLogs }, null, 2));
  await connection.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
