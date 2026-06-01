import 'dotenv/config';
import mysql from 'mysql2/promise';

function envFlagEnabled(value) {
  return ['1', 'true', 'yes', 'on'].includes(value?.toLowerCase() ?? '');
}

function envFlagDisabled(value) {
  return ['0', 'false', 'no', 'off'].includes(value?.toLowerCase() ?? '');
}

function shouldEnableDatabaseSsl(connectionString) {
  const explicitValue = process.env.TIDB_ENABLE_SSL;
  if (envFlagEnabled(explicitValue)) return true;
  if (envFlagDisabled(explicitValue)) return false;

  return connectionString.includes('tidbcloud.com');
}

function createConnectionOptions(connectionString) {
  if (!shouldEnableDatabaseSsl(connectionString)) {
    return connectionString;
  }

  return {
    uri: connectionString,
    ssl: {
      minVersion: 'TLSv1.2',
    },
  };
}

async function getTableColumns(connection, tableName) {
  const [rows] = await connection.query(`show columns from \`${tableName}\``);
  return new Set(rows.map(row => row.Field));
}

function optionalInferenceSelect(columns, columnName, expression) {
  return columns.has(columnName) ? `${expression} as ${columnName}Length` : `null as ${columnName}Length`;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL não configurada');
  }

  const connection = await mysql.createConnection(createConnectionOptions(process.env.DATABASE_URL));
  const inferenceColumns = await getTableColumns(connection, 'mealInferences');

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
    select
      id,
      ${inferenceColumns.has('draftId') ? 'draftId' : 'null as draftId'},
      userId,
      source,
      ${optionalInferenceSelect(inferenceColumns, 'requestSummary', 'char_length(requestSummary)')},
      ${optionalInferenceSelect(inferenceColumns, 'sourceText', 'char_length(sourceText)')},
      ${optionalInferenceSelect(inferenceColumns, 'transcript', 'char_length(transcript)')},
      confidence,
      createdAt
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
