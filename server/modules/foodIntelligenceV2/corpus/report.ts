/**
 * Renderização reproduzível do relatório do harness (§16.2, §19.0.4).
 *
 * O relatório é segmentado por modalidade, classe de decisão, partição e
 * classe de não-recorrência (§9.3). Agregar não pode esconder regressão do
 * corpus obrigatório, por isso a média global vem acompanhada de cada segmento.
 */
import type { CorpusReport, CorpusSegmentMetrics } from "./harness";

function percent(value: number | null): string {
  if (value === null) return "amostra ausente";
  return `${(value * 100).toFixed(2)}%`;
}

function segmentRow(metrics: CorpusSegmentMetrics): string {
  return [
    metrics.segment,
    String(metrics.cases),
    String(metrics.resolvableLabeled),
    String(metrics.matchedCases),
    String(metrics.failedCases),
    String(metrics.abstentions),
    percent(metrics.matchRate),
    percent(metrics.decisionMatchRate),
  ].join(" | ");
}

function segmentTable(
  title: string,
  metrics: readonly CorpusSegmentMetrics[]
): string {
  const header = [
    "Segmento",
    "Casos",
    "Resolvíveis",
    "Verificados",
    "Falhas",
    "Abstenções",
    "Meta §1.1",
    "Decisão",
  ].join(" | ");
  const separator = "| --- | --- | --- | --- | --- | --- | --- | --- |";
  const rows = metrics.map(row => `| ${segmentRow(row)} |`).join("\n");
  return `### ${title}\n\n| ${header} |\n${separator}\n${rows}\n`;
}

/** Renderiza o relatório do harness em Markdown reproduzível. */
export function renderCorpusReportMarkdown(report: CorpusReport): string {
  const lines: string[] = [];
  lines.push("# Relatório do Golden Food Corpus");
  lines.push("");
  lines.push(
    `- Corpus: \`${report.corpusVersion}\` (schema ${report.corpusSchemaVersion})`
  );
  lines.push(
    `- Resolvedor avaliado: \`${report.resolver.id}\` @ \`${report.resolver.revision}\``
  );
  lines.push(`- Casos: ${report.caseCount}`);
  lines.push(`- Chamadas ao resolvedor: ${report.resolveCalls}`);
  lines.push(
    `- Revisões: código \`${report.revisions.code}\`, conhecimento \`${report.revisions.knowledge}\`, léxico \`${report.revisions.lexicon}\`, modelo \`${report.revisions.model}\`, política \`${report.revisions.policy}\``
  );
  lines.push("");

  lines.push("## Veredito");
  lines.push("");
  lines.push(`- Gate: **${report.gate.status}**`);
  lines.push(`- Meta mínima (§1.1): ${percent(report.gate.minMatchRate)}`);
  lines.push(`- Pareamento global: ${percent(report.gate.matchRate)}`);
  lines.push(`- Falhas classificadas: ${report.gate.failureCount}`);
  if (report.gate.blockReasons.length > 0) {
    lines.push(`- Motivos de bloqueio: ${report.gate.blockReasons.join(", ")}`);
  }
  if (report.integrity.status === "invalid") {
    lines.push("");
    lines.push("### Integridade do corpus");
    lines.push("");
    if (report.integrity.duplicateCaseIds.length > 0) {
      lines.push(
        `- IDs duplicados: ${report.integrity.duplicateCaseIds.join(", ")}`
      );
    }
    if (report.integrity.duplicateSurfaces.length > 0) {
      lines.push(
        `- Superfícies duplicadas na mesma partição: ${report.integrity.duplicateSurfaces
          .map(item => item.caseIds.join("/"))
          .join("; ")}`
      );
    }
    if (report.integrity.splitLeakage.length > 0) {
      lines.push(
        `- Vazamento entre partições: ${report.integrity.splitLeakage
          .map(item => item.caseIds.join("/"))
          .join("; ")}`
      );
    }
    if (report.integrity.undeclaredEquivalence.length > 0) {
      lines.push(
        `- Equivalência sem referência declarada: ${report.integrity.undeclaredEquivalence.join(", ")}`
      );
    }
    if (report.integrity.invalidGroups.length > 0) {
      lines.push(
        `- Grupos inválidos: ${report.integrity.invalidGroups
          .map(item => `${item.groupId} (${item.reason})`)
          .join("; ")}`
      );
    }
    if (report.integrity.negativeControlConflicts.length > 0) {
      lines.push(
        `- Conflitos de controle negativo: ${report.integrity.negativeControlConflicts.join("; ")}`
      );
    }
    if (report.integrity.invalidCases.length > 0) {
      lines.push(
        `- Casos inválidos: ${report.integrity.invalidCases
          .map(item => `${item.caseId} (${item.message})`)
          .join("; ")}`
      );
    }
    if (report.integrity.holdoutKnowledgeWrites.length > 0) {
      lines.push(
        `- Escritas durante medição em holdout: ${report.integrity.holdoutKnowledgeWrites
          .map(item => `${item.caseId} -> ${item.writes.join(",")}`)
          .join("; ")}`
      );
    }
  }
  lines.push("");

  lines.push(segmentTable("Global", [report.overall]));
  lines.push(segmentTable("Por modalidade", report.byModality));
  lines.push(segmentTable("Por classe de decisão", report.byDecisionClass));
  lines.push(segmentTable("Por partição", report.bySplit));
  lines.push(
    segmentTable(
      "Por classe de não-recorrência (§9.3)",
      report.byNonRecurrenceClass
    )
  );

  lines.push("### Equivalência de superfície (§17)");
  lines.push("");
  if (report.metamorphic.length === 0) {
    lines.push("- Nenhum grupo declarado.");
  } else {
    lines.push(
      "| Grupo | Membros | Partições | Contra referência | Convergente | Convergência errada |"
    );
    lines.push("| --- | --- | --- | --- | --- | --- |");
    for (const group of report.metamorphic) {
      lines.push(
        `| ${group.groupId} | ${group.memberCaseIds.length} | ${group.splits.join(", ")} | ${
          group.allMatchReference ? "sim" : "não"
        } | ${group.converged ? "sim" : "não"} | ${
          group.wrongConvergence ? "SIM" : "não"
        } |`
      );
    }
  }
  lines.push("");

  lines.push("### Controles negativos");
  lines.push("");
  if (report.negativeControls.length === 0) {
    lines.push("- Nenhum controle declarado.");
  } else {
    for (const control of report.negativeControls) {
      lines.push(
        `- \`${control.caseId}\` vs \`${control.targetCaseId}\`: ${
          control.convergedWithTarget ? "CONVERGIU (reprova)" : "discriminante"
        }`
      );
    }
  }
  lines.push("");

  lines.push("### Consistência de macros entre entradas equivalentes (§1.1)");
  lines.push("");
  if (report.macroConsistency.length === 0) {
    lines.push("- Nenhum grupo declarado.");
  } else {
    for (const item of report.macroConsistency) {
      lines.push(
        `- \`${item.groupId}\`: ${item.consistent ? "consistente" : `divergente (${item.divergences.join("; ")})`}`
      );
    }
  }
  lines.push("");

  if (report.failures.length > 0) {
    lines.push("### Falhas");
    lines.push("");
    lines.push("| Caso | Decisão esperada | Códigos | Detalhe |");
    lines.push("| --- | --- | --- | --- |");
    for (const failure of report.failures) {
      lines.push(
        `| ${failure.caseId} | ${failure.label ?? "-"} | ${failure.codes.join(", ")} | ${failure.detail} |`
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}
