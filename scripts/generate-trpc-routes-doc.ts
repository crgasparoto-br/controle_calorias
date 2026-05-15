import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const sourcePath = path.join(root, "server/nutritionRouter.ts");
const outputPath = path.join(root, "docs/generated/trpc-routes.md");
const checkOnly = process.argv.includes("--check");

type ProcedureInfo = {
  name: string;
  scope: string;
  operation: string;
};

type GroupInfo = {
  name: string;
  procedures: ProcedureInfo[];
};

const groupDescriptions: Record<string, string> = {
  privacy: "Exportação de dados e solicitação de exclusão",
  assistant: "Sugestões alimentares assistidas",
  foodPhotoAnalysis: "Análise, consulta, rejeição e confirmação de fotos",
  healthIntegrations: "Conexão, desconexão e sincronização de integrações de saúde",
  professionals: "Perfil profissional, acessos, pacientes, comentários e sugestões",
  onboarding: "Conclusão de onboarding nutricional",
  dashboard: "Visão consolidada diária",
  goals: "Leitura e atualização de metas",
  gamification: "Configurações e estado de gamificação",
  foods: "Catálogo, favoritos e busca de alimentos",
  meals: "CRUD, rascunho, confirmação, favoritos e totais de refeições",
  exercises: "Registro de exercícios",
  water: "Meta e registros de água",
  reports: "Relatórios semanais e insights",
  admin: "Visão operacional administrativa",
  whatsapp: "Status, vínculo e simulação inbound",
};

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

function parseOperation(source: string) {
  if (source.includes(".mutation(")) return "mutation";
  if (source.includes(".query(")) return "query";
  return "unknown";
}

function parseProcedures(groupSource: string): ProcedureInfo[] {
  const procedureRegex = /^\s{4}(\w+):\s*(protectedProcedure|adminProcedure)/gm;
  const matches = Array.from(groupSource.matchAll(procedureRegex));

  return matches.map((match, index) => {
    const start = match.index ?? 0;
    const end = index + 1 < matches.length ? matches[index + 1].index ?? groupSource.length : groupSource.length;
    const procedureSource = groupSource.slice(start, end);
    return {
      name: match[1],
      scope: match[2].replace("Procedure", ""),
      operation: parseOperation(procedureSource),
    };
  });
}

function parseGroups(source: string): GroupInfo[] {
  const groups: GroupInfo[] = [];
  const groupRegex = /^\s{2}(\w+): router\(\{/gm;

  for (const match of source.matchAll(groupRegex)) {
    const name = match[1];
    const braceStart = source.indexOf("{", match.index ?? 0);
    const braceEnd = findMatchingBrace(source, braceStart);
    const groupSource = source.slice(braceStart + 1, braceEnd);
    groups.push({ name, procedures: parseProcedures(groupSource) });
  }

  return groups;
}

function dominantScope(group: GroupInfo) {
  const counts = new Map<string, number>();
  for (const procedure of group.procedures) {
    counts.set(procedure.scope, (counts.get(procedure.scope) ?? 0) + 1);
  }

  return Array.from(counts.entries()).sort((left, right) => right[1] - left[1])[0]?.[0] ?? "unknown";
}

function countByOperation(group: GroupInfo, operation: string) {
  return group.procedures.filter(procedure => procedure.operation === operation).length;
}

function descriptionFor(group: GroupInfo) {
  return groupDescriptions[group.name] ?? "Grupo de procedures tRPC";
}

function generateMarkdown(groups: GroupInfo[]) {
  const lines: string[] = [
    "# Documentação gerada: rotas tRPC",
    "",
    "> Arquivo gerado automaticamente por `pnpm docs:generate:trpc`. Não edite manualmente.",
    "",
    "Fonte: `server/nutritionRouter.ts`.",
    "",
    "## Grupos",
    "",
    "| Grupo | Procedures | Queries | Mutations | Escopo predominante | Responsabilidade |",
    "|---|---:|---:|---:|---|---|",
  ];

  for (const group of groups) {
    lines.push(`| \`${group.name}\` | ${group.procedures.length} | ${countByOperation(group, "query")} | ${countByOperation(group, "mutation")} | ${dominantScope(group)} | ${descriptionFor(group)} |`);
  }

  lines.push("", "## Procedures por grupo", "");

  for (const group of groups) {
    lines.push(`### ${group.name}`, "");
    lines.push("| Procedure | Operação | Escopo |");
    lines.push("|---|---|---|");
    for (const procedure of group.procedures) {
      lines.push(`| \`${procedure.name}\` | ${procedure.operation} | ${procedure.scope} |`);
    }
    lines.push("");
  }

  lines.push("## Regras para novas procedures", "");
  lines.push("- Use `protectedProcedure` por padrão.");
  lines.push("- Use `adminProcedure` apenas para operação administrativa real.");
  lines.push("- Toda input deve ter schema Zod em `server/modules/<dominio>/schemas.ts`.");
  lines.push("- Erros conhecidos devem ser traduzidos para `TRPCError` com mensagem segura.");
  lines.push("- Eventos de analytics devem conter categorias e contadores, nunca dados crus de saúde.");
  lines.push("");

  return `${lines.join("\n")}\n`;
}

const generated = generateMarkdown(parseGroups(readRequiredFile(sourcePath)));

if (checkOnly) {
  const current = readRequiredFile(outputPath);
  if (current !== generated) {
    console.error("docs/generated/trpc-routes.md está desatualizado. Rode `pnpm docs:generate:trpc` e commit as mudanças.");
    process.exit(1);
  }
  console.log("docs/generated/trpc-routes.md está atualizado.");
} else {
  writeFileSync(outputPath, generated, "utf8");
  console.log("docs/generated/trpc-routes.md atualizado.");
}
