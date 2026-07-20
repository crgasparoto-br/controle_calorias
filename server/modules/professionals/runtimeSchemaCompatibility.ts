import mysql from "mysql2/promise";

type Connection = mysql.Connection;
type CompatibilityMode = "repair" | "verify";
type CompatibilityIssueKind = "missing_column" | "missing_table";

type RequiredTable = {
  name: string;
  createSql: string;
  indexes: string[];
  requiredColumns: string[];
};

export type ProfessionalSchemaCompatibilityIssue = {
  kind: CompatibilityIssueKind;
  table: string;
  column?: string;
  description: string;
  action: string;
};

export type ProfessionalSchemaCompatibilityResult = {
  mode: CompatibilityMode;
  added: string[];
  pending: ProfessionalSchemaCompatibilityIssue[];
};

const MIGRATION_REQUIRED_MESSAGE =
  "The professional workspace database schema is incomplete. Run pnpm db:push before starting the server.";

const FOUNDATION_TABLES = [
  "users",
  "professionalPatientAuthorizations",
  "professionalPatientTrackings",
] as const;

const TRACKING_COLUMNS = [
  {
    name: "nextReviewAt",
    sql: "`nextReviewAt` timestamp NULL AFTER `lastTransitionReason`",
  },
  {
    name: "nextWeighingAt",
    sql: "`nextWeighingAt` timestamp NULL AFTER `nextReviewAt`",
  },
] as const;

const OPERATIONAL_TABLES: RequiredTable[] = [
  {
    name: "professionalOperationalRequests",
    requiredColumns: [
      "id",
      "authorizationId",
      "professionalUserId",
      "patientUserId",
      "type",
      "title",
      "dueAt",
      "state",
      "answeredAt",
      "closedAt",
      "closedByUserId",
      "closureReason",
      "responseReference",
      "createdAt",
      "updatedAt",
    ],
    createSql: `
      CREATE TABLE \`professionalOperationalRequests\` (
        \`id\` varchar(64) NOT NULL,
        \`authorizationId\` varchar(64) NOT NULL,
        \`professionalUserId\` int NOT NULL,
        \`patientUserId\` int NOT NULL,
        \`type\` enum('weigh_in','professional_request') NOT NULL,
        \`title\` varchar(160) NOT NULL,
        \`dueAt\` timestamp NOT NULL,
        \`state\` enum('open','answered','cancelled','dismissed') NOT NULL DEFAULT 'open',
        \`answeredAt\` timestamp,
        \`closedAt\` timestamp,
        \`closedByUserId\` int,
        \`closureReason\` enum('response','weight_recorded','cancelled','dismissed','manual_resolution'),
        \`responseReference\` varchar(191),
        \`createdAt\` timestamp NOT NULL DEFAULT (now()),
        \`updatedAt\` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT \`professionalOperationalRequests_id\` PRIMARY KEY (\`id\`),
        CONSTRAINT \`professionalOperationalRequests_authorization_fk\` FOREIGN KEY (\`authorizationId\`) REFERENCES \`professionalPatientAuthorizations\` (\`id\`) ON DELETE restrict ON UPDATE no action,
        CONSTRAINT \`professionalOperationalRequests_professional_fk\` FOREIGN KEY (\`professionalUserId\`) REFERENCES \`users\` (\`id\`) ON DELETE restrict ON UPDATE no action,
        CONSTRAINT \`professionalOperationalRequests_patient_fk\` FOREIGN KEY (\`patientUserId\`) REFERENCES \`users\` (\`id\`) ON DELETE restrict ON UPDATE no action,
        CONSTRAINT \`professionalOperationalRequests_closed_by_fk\` FOREIGN KEY (\`closedByUserId\`) REFERENCES \`users\` (\`id\`) ON DELETE set null ON UPDATE no action
      )
    `,
    indexes: [
      "CREATE INDEX `professionalOperationalRequests_scope_idx` ON `professionalOperationalRequests` (`professionalUserId`,`patientUserId`,`state`,`dueAt`)",
      "CREATE INDEX `professionalOperationalRequests_patient_open_idx` ON `professionalOperationalRequests` (`patientUserId`,`state`,`createdAt`)",
    ],
  },
  {
    name: "professionalReviewSignals",
    requiredColumns: [
      "id",
      "authorizationId",
      "professionalUserId",
      "patientUserId",
      "originType",
      "originId",
      "reason",
      "state",
      "createdAt",
      "updatedAt",
    ],
    createSql: `
      CREATE TABLE \`professionalReviewSignals\` (
        \`id\` varchar(64) NOT NULL,
        \`authorizationId\` varchar(64) NOT NULL,
        \`professionalUserId\` int NOT NULL,
        \`patientUserId\` int NOT NULL,
        \`originType\` varchar(80) NOT NULL,
        \`originId\` varchar(128) NOT NULL,
        \`reason\` varchar(500) NOT NULL,
        \`state\` enum('open','corrected','invalidated') NOT NULL DEFAULT 'open',
        \`createdAt\` timestamp NOT NULL DEFAULT (now()),
        \`updatedAt\` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT \`professionalReviewSignals_id\` PRIMARY KEY (\`id\`),
        CONSTRAINT \`professionalReviewSignals_origin_uq\` UNIQUE (\`authorizationId\`,\`originType\`,\`originId\`),
        CONSTRAINT \`professionalReviewSignals_authorization_fk\` FOREIGN KEY (\`authorizationId\`) REFERENCES \`professionalPatientAuthorizations\` (\`id\`) ON DELETE restrict ON UPDATE no action
      )
    `,
    indexes: [
      "CREATE INDEX `professionalReviewSignals_scope_idx` ON `professionalReviewSignals` (`professionalUserId`,`patientUserId`,`state`,`createdAt`)",
    ],
  },
  {
    name: "professionalOperationalAlerts",
    requiredColumns: [
      "id",
      "dedupeKey",
      "type",
      "professionalUserId",
      "patientUserId",
      "authorizationId",
      "originType",
      "originId",
      "periodStart",
      "periodEnd",
      "reason",
      "severity",
      "state",
      "suggestedAction",
      "resolvedByUserId",
      "resolvedAt",
      "resolutionNote",
      "createdAt",
      "updatedAt",
    ],
    createSql: `
      CREATE TABLE \`professionalOperationalAlerts\` (
        \`id\` varchar(64) NOT NULL,
        \`dedupeKey\` varchar(191) NOT NULL,
        \`type\` enum('no_food_records','weigh_in_overdue','goal_review_due','professional_request_overdue','record_requires_review') NOT NULL,
        \`professionalUserId\` int NOT NULL,
        \`patientUserId\` int NOT NULL,
        \`authorizationId\` varchar(64) NOT NULL,
        \`originType\` varchar(80) NOT NULL,
        \`originId\` varchar(128),
        \`periodStart\` timestamp,
        \`periodEnd\` timestamp,
        \`reason\` varchar(500) NOT NULL,
        \`severity\` enum('info','attention','urgent') NOT NULL DEFAULT 'attention',
        \`state\` enum('open','resolved','dismissed','inactive') NOT NULL DEFAULT 'open',
        \`suggestedAction\` varchar(300) NOT NULL,
        \`resolvedByUserId\` int,
        \`resolvedAt\` timestamp,
        \`resolutionNote\` varchar(500),
        \`createdAt\` timestamp NOT NULL DEFAULT (now()),
        \`updatedAt\` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT \`professionalOperationalAlerts_id\` PRIMARY KEY (\`id\`),
        CONSTRAINT \`professionalOperationalAlerts_dedupe_uq\` UNIQUE (\`dedupeKey\`),
        CONSTRAINT \`professionalOperationalAlerts_authorization_fk\` FOREIGN KEY (\`authorizationId\`) REFERENCES \`professionalPatientAuthorizations\` (\`id\`) ON DELETE restrict ON UPDATE no action
      )
    `,
    indexes: [
      "CREATE INDEX `professionalOperationalAlerts_professional_state_idx` ON `professionalOperationalAlerts` (`professionalUserId`,`state`,`updatedAt`)",
      "CREATE INDEX `professionalOperationalAlerts_patient_state_idx` ON `professionalOperationalAlerts` (`patientUserId`,`state`,`updatedAt`)",
    ],
  },
];

export class ProfessionalRuntimeSchemaCompatibilityError extends Error {
  readonly issues: ProfessionalSchemaCompatibilityIssue[];

  constructor(issues: ProfessionalSchemaCompatibilityIssue[]) {
    super(
      `${MIGRATION_REQUIRED_MESSAGE} Pending change(s): ${issues
        .map(issue =>
          issue.column ? `${issue.table}.${issue.column}` : issue.table
        )
        .join(", ")}`
    );
    this.name = "ProfessionalRuntimeSchemaCompatibilityError";
    this.issues = issues;
  }
}

function getMode(): CompatibilityMode {
  return process.env.NODE_ENV === "production" ? "verify" : "repair";
}

function issue(
  kind: CompatibilityIssueKind,
  table: string,
  description: string,
  column?: string
): ProfessionalSchemaCompatibilityIssue {
  return {
    kind,
    table,
    column,
    description,
    action: "Run pnpm db:push with the target DATABASE_URL before starting the server.",
  };
}

async function tableExists(connection: Connection, tableName: string) {
  const [rows] = await connection.execute<mysql.RowDataPacket[]>(
    "SELECT COUNT(*) AS total FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?",
    [tableName]
  );
  return Number(rows[0]?.total ?? 0) > 0;
}

async function columnExists(
  connection: Connection,
  tableName: string,
  columnName: string
) {
  const [rows] = await connection.execute<mysql.RowDataPacket[]>(
    "SELECT COUNT(*) AS total FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?",
    [tableName, columnName]
  );
  return Number(rows[0]?.total ?? 0) > 0;
}

function createConnectionOptions(databaseUrl: string): mysql.ConnectionOptions {
  const parsedUrl = new URL(databaseUrl);
  return {
    host: parsedUrl.hostname,
    port: parsedUrl.port ? Number(parsedUrl.port) : 4000,
    user: decodeURIComponent(parsedUrl.username),
    password: decodeURIComponent(parsedUrl.password),
    database: parsedUrl.pathname.replace(/^\//, ""),
    ssl: { minVersion: "TLSv1.2" },
  };
}

function createConnection(databaseUrl: string) {
  if (process.env.TIDB_ENABLE_SSL !== "true") {
    return mysql.createConnection(databaseUrl);
  }
  return mysql.createConnection(createConnectionOptions(databaseUrl));
}

async function inspectFoundationTables(connection: Connection) {
  const pending: ProfessionalSchemaCompatibilityIssue[] = [];
  for (const table of FOUNDATION_TABLES) {
    if (!(await tableExists(connection, table))) {
      pending.push(
        issue(
          "missing_table",
          table,
          `Table ${table} is required by the professional workspace foundation.`
        )
      );
    }
  }
  return pending;
}

async function ensureTrackingColumns(
  connection: Connection,
  mode: CompatibilityMode
): Promise<Pick<ProfessionalSchemaCompatibilityResult, "added" | "pending">> {
  const added: string[] = [];
  const pending: ProfessionalSchemaCompatibilityIssue[] = [];

  for (const column of TRACKING_COLUMNS) {
    if (
      await columnExists(
        connection,
        "professionalPatientTrackings",
        column.name
      )
    ) {
      continue;
    }

    if (mode === "verify") {
      pending.push(
        issue(
          "missing_column",
          "professionalPatientTrackings",
          `Column professionalPatientTrackings.${column.name} is required by the patient portfolio.`,
          column.name
        )
      );
      continue;
    }

    await connection.execute(
      `ALTER TABLE \`professionalPatientTrackings\` ADD COLUMN ${column.sql}`
    );
    added.push(`professionalPatientTrackings.${column.name}`);
  }

  return { added, pending };
}

async function ensureOperationalTable(
  connection: Connection,
  table: RequiredTable,
  mode: CompatibilityMode
): Promise<Pick<ProfessionalSchemaCompatibilityResult, "added" | "pending">> {
  if (!(await tableExists(connection, table.name))) {
    if (mode === "verify") {
      return {
        added: [],
        pending: [
          issue(
            "missing_table",
            table.name,
            `Table ${table.name} is required by professional operational alerts.`
          ),
        ],
      };
    }

    await connection.execute(table.createSql);
    for (const indexSql of table.indexes) {
      await connection.execute(indexSql);
    }
    return { added: [table.name], pending: [] };
  }

  const pending: ProfessionalSchemaCompatibilityIssue[] = [];
  for (const column of table.requiredColumns) {
    if (!(await columnExists(connection, table.name, column))) {
      pending.push(
        issue(
          "missing_column",
          table.name,
          `Column ${table.name}.${column} is required by professional operational alerts. Apply the versioned migration instead of repairing a partially created table at runtime.`,
          column
        )
      );
    }
  }

  return { added: [], pending };
}

export async function ensureProfessionalRuntimeSchemaCompatibility(): Promise<ProfessionalSchemaCompatibilityResult> {
  const databaseUrl = process.env.DATABASE_URL;
  const mode = getMode();
  const result: ProfessionalSchemaCompatibilityResult = {
    mode,
    added: [],
    pending: [],
  };

  if (!databaseUrl) return result;

  const connection = await createConnection(databaseUrl);
  try {
    result.pending.push(...(await inspectFoundationTables(connection)));
    if (result.pending.length > 0) {
      throw new ProfessionalRuntimeSchemaCompatibilityError(result.pending);
    }

    const tracking = await ensureTrackingColumns(connection, mode);
    result.added.push(...tracking.added);
    result.pending.push(...tracking.pending);

    for (const table of OPERATIONAL_TABLES) {
      const operational = await ensureOperationalTable(connection, table, mode);
      result.added.push(...operational.added);
      result.pending.push(...operational.pending);
    }

    if (result.pending.length > 0) {
      throw new ProfessionalRuntimeSchemaCompatibilityError(result.pending);
    }

    return result;
  } finally {
    await connection.end();
  }
}
