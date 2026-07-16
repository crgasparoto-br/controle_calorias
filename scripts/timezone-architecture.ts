export type TimeZoneArchitectureFile = {
  path: string;
  content: string;
};

const CENTRAL_TIME_ZONE_MODULE = "shared/timeZone.ts";
const AUTHORIZED_COMPATIBILITY_ADAPTERS = new Set([
  "server/modules/whatsapp/intent/dateTime.ts",
  "client/src/lib/dateTime.ts",
]);

function normalizedPath(value: string) {
  return value.replaceAll("\\", "/");
}

function isTestOrFixture(filePath: string) {
  return /(?:^|\/)(?:__tests__|fixtures)(?:\/|$)/.test(filePath)
    || /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(filePath)
    || /(?:regressionDataset|conversationRegression|negativeEvaluation)\.ts$/.test(filePath);
}

function isProductionTimeZoneFile(filePath: string) {
  return /^(?:client\/src|server|shared)\//.test(filePath)
    && /\.[cm]?[jt]sx?$/.test(filePath)
    && !isTestOrFixture(filePath)
    && !filePath.includes("/generated/");
}

function lineNumberAt(content: string, index: number) {
  return content.slice(0, index).split(/\r?\n/).length;
}

function addPatternViolations(input: {
  filePath: string;
  content: string;
  pattern: RegExp;
  message: string;
  failures: string[];
}) {
  const flags = input.pattern.flags.includes("g") ? input.pattern.flags : `${input.pattern.flags}g`;
  const pattern = new RegExp(input.pattern.source, flags);
  for (const match of input.content.matchAll(pattern)) {
    input.failures.push(`${input.message}: ${input.filePath}:${lineNumberAt(input.content, match.index ?? 0)}`);
  }
}

/**
 * Protege a arquitetura temporal contra fontes paralelas de timezone.
 *
 * A verificação é deliberadamente limitada ao código executável. Testes,
 * fixtures e documentação podem citar timezones para cobrir cenários; código de
 * produção deve importar o contrato central ou receber um timezone já resolvido.
 */
export function findTimeZoneArchitectureViolations(files: TimeZoneArchitectureFile[]) {
  const failures: string[] = [];

  for (const file of files) {
    const filePath = normalizedPath(file.path);
    if (!isProductionTimeZoneFile(filePath)) continue;

    if (filePath !== CENTRAL_TIME_ZONE_MODULE) {
      addPatternViolations({
        filePath,
        content: file.content,
        pattern: /["']America\/Sao_Paulo["']/g,
        message: "Fallback funcional de America/Sao_Paulo fora do módulo central",
        failures,
      });
      addPatternViolations({
        filePath,
        content: file.content,
        pattern: /\bconst\s+(?:DEFAULT_TIME_ZONE|SAO_PAULO_TIME_ZONE|BRAZIL_TIME_ZONE)\b/g,
        message: "Constante local de timezone não autorizada",
        failures,
      });
    }

    addPatternViolations({
      filePath,
      content: file.content,
      pattern: /Intl\.DateTimeFormat\(\s*\)\.resolvedOptions\(\)\.timeZone/g,
      message: "Timezone do navegador usado como autoridade de negócio",
      failures,
    });

    addPatternViolations({
      filePath,
      content: file.content,
      pattern: /(?:\$\{[^}]+\}|\+\s*)T00:00:00(?:\.000)?Z|T00:00:00(?:\.000)?Z\s*["']\s*\+/g,
      message: "Limite de calendário local construído por concatenação UTC fixa",
      failures,
    });

    if (filePath !== CENTRAL_TIME_ZONE_MODULE && !AUTHORIZED_COMPATIBILITY_ADAPTERS.has(filePath)) {
      addPatternViolations({
        filePath,
        content: file.content,
        pattern: /\bfunction\s+(?:getZonedParts|makeDateInTimeZone|getTimeZoneOffsetMs|isValidIanaTimeZone)\s*\(/g,
        message: "Resolver ou conversor paralelo de timezone",
        failures,
      });
      addPatternViolations({
        filePath,
        content: file.content,
        pattern: /\bnew\s+Date\(\s*[A-Za-z_$][\w$]*dateTimeLocal\b/gi,
        message: "datetime-local convertido diretamente sem helper central",
        failures,
      });
      if (/\boffsetMinutes\b/.test(file.content) && /\bDate\.UTC\(/.test(file.content)) {
        failures.push(`Cálculo manual de offset de timezone fora do módulo central: ${filePath}`);
      }
    }

    // Leitura do perfil dentro de iteração é um forte indício de N+1 temporal.
    addPatternViolations({
      filePath,
      content: file.content,
      pattern: /(?:for\s*\([^)]*\)|\.forEach\s*\([^)]*=>|\.map\s*\([^)]*=>)[\s\S]{0,500}?resolveEffectiveUserTimeZone\s*\(/g,
      message: "Resolução de timezone dentro de loop potencialmente N+1",
      failures,
    });
  }

  return failures;
}
