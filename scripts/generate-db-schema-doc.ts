import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const sourcePath = path.join(root, "drizzle/schema.ts");
const outputPath = path.join(root, "docs/generated/db-schema.md");
const checkOnly = process.argv.includes("--check");

type ColumnInfo = { propertyName: string; columnName: string };
type TableInfo = { exportName: string; tableName: string; columns: ColumnInfo[] };

const tableFragments = ["user", "profile", "goal", "favorite", "badge", "recipe", "meal", "habit", "summary", "exercise", "weight", "water", "preference", "restriction", "whatsapp", "inference", "log", "media"];
const columnFragments = ["email", "name", "age", "birth", "height", "weight", "objective", "activity", "routine", "difficulty", "timezone", "text", "transcript", "note", "media", "reason", "json", "url", "detail", "preference", "restriction", "label", "severity", "occurred", "measured"];

function readRequiredFile(filePath: string) {
  if (!existsSync(filePath)) throw new Error(`Arquivo não encontrado: ${path.relative(root, filePath)}`);
  return readFileSync(filePath, "utf8");
}

function findMatchingBrace(source: string, start: number) {
  let depth = 0;
  let quote: string | null = null;
  let escaped = false;

  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0 && char === "}") return index;
  }
  throw new Error(`Bloco sem fechamento em ${start}.`);
}

function parseColumns(source: string): ColumnInfo[] {
  return Array.from(source.matchAll(/^\s*(\w+):\s*(?:int|double|text|timestamp|varchar|mysqlEnum)\("([^"]+)"/gm))
    .map(match => ({ propertyName: match[1], columnName: match[2] }));
}

function parseTables(source: string): TableInfo[] {
  const tables: TableInfo[] = [];
  const tableRegex = /export const (\w+) = mysqlTable\("([^"]+)"/g;
  for (const match of source.matchAll(tableRegex)) {
    const columnsStart = source.indexOf("{", match.index ?? 0);
    const columnsEnd = findMatchingBrace(source, columnsStart);
    tables.push({
      exportName: match[1],
      tableName: match[2],
      columns: parseColumns(source.slice(columnsStart + 1, columnsEnd)),
    });
  }
  return tables;
}

function hasFragment(value: string, fragments: string[]) {
  const normalized = value.toLowerCase();
  return fragments.some(fragment => normalized.includes(fragment));
}

function tableClass(table: TableInfo) {
  return hasFragment(table.tableName, tableFragments) ? "Requer atenção" : "Baixa";
}

function selectedColumns(table: TableInfo) {
  return table.columns.filter(column => hasFragment(column.propertyName, columnFragments) || hasFragment(column.columnName, columnFragments));
}

function generateMarkdown(tables: TableInfo[]) {
  const lines = [
    "# Documentação gerada: schema do banco",
    "",
    "> Arquivo gerado automaticamente por `pnpm docs:generate:db`. Não edite manualmente.",
    "",
    "Fonte: `drizzle/schema.ts`.",
    "",
    "## Tabelas",
    "",
    "| Export | Tabela física | Colunas | Classificação |",
    "|---|---|---:|---|",
  ];

  for (const table of tables) {
    lines.push(`| \`${table.exportName}\` | \`${table.tableName}\` | ${table.columns.length} | ${tableClass(table)} |`);
  }

  lines.push("", "## Tabelas sensíveis conhecidas", "");
  for (const table of tables.filter(item => tableClass(item) !== "Baixa")) {
    lines.push(`- \`${table.tableName}\` via export \`${table.exportName}\`.`);
  }

  lines.push("", "## Campos sensíveis conhecidos", "");
  lines.push("| Tabela física | Campos detectados |");
  lines.push("|---|---|");
  for (const table of tables) {
    const fields = selectedColumns(table).map(column => `\`${column.columnName}\``);
    if (fields.length) lines.push(`| \`${table.tableName}\` | ${fields.join(", ")} |`);
  }

  lines.push("", "## Relações críticas", "");
  lines.push("- A maioria dos dados de domínio referencia `users.id`.");
  lines.push("- `meals` possui `mealItems`, `mealMedia` e pode ser referenciada por `mealInferences`.");
  lines.push("- `mealFavorites`, `foodFavorites`, `userGamificationSettings` e `userBadges` alimentam personalização e engajamento.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

const generated = generateMarkdown(parseTables(readRequiredFile(sourcePath)));
if (checkOnly) {
  const current = readRequiredFile(outputPath);
  if (current !== generated) {
    console.error("docs/generated/db-schema.md está desatualizado. Rode `pnpm docs:generate:db` e commit as mudanças.");
    process.exit(1);
  }
  console.log("docs/generated/db-schema.md está atualizado.");
} else {
  writeFileSync(outputPath, generated, "utf8");
  console.log("docs/generated/db-schema.md atualizado.");
}
