import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures: string[] = [];

function fail(message: string) {
  failures.push(message);
}

function read(relativePath: string) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

const requiredDocs = [
  "AGENTS.md",
  "ARCHITECTURE.md",
  "docs/product-specs/meal-registration.md",
  "docs/product-specs/whatsapp-flow.md",
  "docs/product-specs/goals-and-reports.md",
  "docs/product-specs/professionals.md",
  "docs/product-specs/privacy-export-deletion.md",
  "docs/design-docs/nutrition-engine.md",
  "docs/design-docs/whatsapp-ingestion.md",
  "docs/design-docs/database-persistence.md",
  "docs/design-docs/usage-governance.md",
  "docs/generated/db-schema.md",
  "docs/generated/trpc-routes.md",
  "docs/PRIVACY_LGPD.md",
  "docs/SECURITY.md",
  "docs/RELIABILITY.md",
];

for (const doc of requiredDocs) {
  if (!existsSync(path.join(root, doc))) {
    fail(`Documento obrigatório ausente: ${doc}`);
  }
}

if (existsSync(path.join(root, "drizzle/schema.ts")) && existsSync(path.join(root, "docs/generated/db-schema.md"))) {
  const schema = read("drizzle/schema.ts");
  const dbDoc = read("docs/generated/db-schema.md");
  const tableNames = Array.from(schema.matchAll(/export const (\w+) = mysqlTable\("([^"]+)"/g)).map(match => match[2]);

  for (const tableName of tableNames) {
    if (!dbDoc.includes(`\`${tableName}\``)) {
      fail(`Tabela não documentada em docs/generated/db-schema.md: ${tableName}`);
    }
  }
}

if (existsSync(path.join(root, "server/nutritionRouter.ts")) && existsSync(path.join(root, "docs/generated/trpc-routes.md"))) {
  const router = read("server/nutritionRouter.ts");
  const routeDoc = read("docs/generated/trpc-routes.md");
  const groupNames = Array.from(router.matchAll(/^\s{2}(\w+): router\(/gm)).map(match => match[1]);

  for (const groupName of groupNames) {
    if (!routeDoc.includes(`\`${groupName}\``)) {
      fail(`Grupo tRPC não documentado em docs/generated/trpc-routes.md: ${groupName}`);
    }
  }
}

const agents = existsSync(path.join(root, "AGENTS.md")) ? read("AGENTS.md") : "";
for (const referencedDoc of ["ARCHITECTURE.md", "docs/PRIVACY_LGPD.md", "docs/generated/db-schema.md", "docs/generated/trpc-routes.md"]) {
  if (!agents.includes(referencedDoc)) {
    fail(`AGENTS.md deve apontar para ${referencedDoc}`);
  }
}

function collectMarkdownFiles(relativePath: string): string[] {
  const absolutePath = path.join(root, relativePath);
  if (!existsSync(absolutePath)) return [];
  if (!statSync(absolutePath).isDirectory()) {
    return absolutePath.endsWith(".md") ? [relativePath] : [];
  }
  const ignoredDirectories = new Set([".git", ".audit", "node_modules", "dist", "coverage"]);
  const entries = readdirSync(absolutePath, { withFileTypes: true });
  return entries.flatMap(entry => {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) return [];
    const child = path.join(relativePath, entry.name);
    if (entry.isDirectory()) return collectMarkdownFiles(child);
    return entry.isFile() && entry.name.endsWith(".md") ? [child] : [];
  });
}

const staleUsageGovernanceClaims = [
  {
    label: "governança de consumo marcada como ausente/pendente",
    pattern: /(?:gest[aã]o|governan[cç]a)\s+de\s+(?:uso|consumo)\s+de\s+IA.{0,160}(?:n[aã]o\s+implementad[ao]|pendente|indispon[ií]vel)/i,
  },
  {
    label: "rota usageGovernance marcada como inexistente/indisponível",
    pattern: /usageGovernance.{0,160}(?:n[aã]o\s+existe|n[aã]o\s+implementad[ao]|indispon[ií]vel|pendente)/i,
  },
  {
    label: "fair use descrito como cobrança ou bloqueio automático",
    pattern: /(?:fair\s+use|or[cç]amento|threshold).{0,160}(?:bloque(?:ia|io)\s+automaticamente|cobra(?:n[cç]a)?\s+automaticamente|cobran[cç]a\s+autom[aá]tica)/i,
  },
];

for (const doc of ["README.md", "ARCHITECTURE.md", "AGENTS.md", ...collectMarkdownFiles("docs")]) {
  if (!existsSync(path.join(root, doc))) continue;
  const normalized = read(doc).replace(/\s+/g, " ");
  for (const staleClaim of staleUsageGovernanceClaims) {
    if (staleClaim.pattern.test(normalized)) {
      fail(`Alegação documental obsoleta (${staleClaim.label}): ${doc}`);
    }
  }
}

if (failures.length > 0) {
  console.error("\nFalhas de documentação encontradas:\n");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Documentação validada com sucesso.");
