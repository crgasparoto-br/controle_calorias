/**
 * Renderização reproduzível do relatório do harness (§16.2, §19.0.4).
 *
 * O relatório é segmentado por modalidade, classe de decisão, partição, classe
 * de não-recorrência (§9.3), marca, atributo material, medida, continuidade,
 * operação e procedência nutricional (§16.2), com as famílias de falha
 * (identidade/variante, quantidade/unidade, fonte, operação, clarificação) e
 * latência/custo. Agregar não pode esconder regressão do corpus obrigatório,
 * por isso a média global vem acompanhada de cada segmento. O relatório também
 * registra as revisões fixadas (§16.1), a evidência adversarial dos controles
 * negativos e o resultado das fases de §16.1.
 */
import { CORPUS_REVISION_KEYS, isUnpinnedRevision } from "./contracts";
import type { CorpusReport, CorpusSegmentMetrics } from "./harness";

const GATE_LABEL: Record<CorpusReport["gate"]["status"], string> = {
  passed: "APROVADO",
  failed: "REPROVADO",
  blocked: "BLOQUEADO",
  sample_missing: "AMOSTRA AUSENTE",
};

function percent(value: number | null): string {
  if (value === null) return "amostra ausente";
  return `${(value * 100).toFixed(2)}%`;
}

function numberOrDash(value: number | null): string {
  return value === null ? "n/d" : String(value);
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
    String(metrics.families.identityFailures),
    String(metrics.families.variantAttributeFailures),
    String(metrics.families.quantityFailures),
    String(metrics.families.unitFailures),
    String(metrics.families.nutritionFailures),
    String(metrics.families.operationFailures),
    String(metrics.families.clarificationFailures),
    String(metrics.families.classificationFailures),
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
    "Ident.",
    "Variante",
    "Quant.",
    "Unid.",
    "Nutr.",
    "Oper.",
    "Clarif.",
    "Classif.",
  ].join(" | ");
  const separator =
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |";
  if (metrics.length === 0) {
    return `### ${title}\n\n_Sem casos._\n`;
  }
  const rows = metrics.map(row => `| ${segmentRow(row)} |`).join("\n");
  return `### ${title}\n\n| ${header} |\n${separator}\n${rows}\n`;
}

/** Renderiza o relatório do harness em Markdown reproduzível. */
export function renderCorpusReportMarkdown(report: CorpusReport): string {
  const lines: string[] = [];
  const unpinned = CORPUS_REVISION_KEYS.filter(key =>
    isUnpinnedRevision(report.revisions[key])
  );

  lines.push("# Relatório do Golden Food Corpus");
  lines.push("");
  lines.push(
    `- Corpus: \`${report.corpusVersion}\` (schema ${report.corpusSchemaVersion})`
  );
  lines.push(
    `- Resolvedor avaliado: \`${report.resolver.id}\` @ \`${report.resolver.revision}\``
  );
  lines.push(`- Casos: ${report.caseCount}`);
  lines.push(
    `- Chamadas ao resolvedor sob teste: ${report.resolveCalls} (invariante de §18: todo caso passa pelo resolvedor)`
  );
  lines.push("");

  lines.push("## Revisões fixadas (§16.1)");
  lines.push("");
  lines.push("| Revisão | Valor |");
  lines.push("| --- | --- |");
  for (const key of CORPUS_REVISION_KEYS) {
    lines.push(`| ${key} | \`${report.revisions[key]}\` |`);
  }
  lines.push("");
  if (unpinned.length > 0) {
    lines.push(
      `- Revisões não fixadas: ${unpinned.join(", ")}. O gate bloqueia com \`revisions_not_pinned\`: medir sem revisão amarrada não produz evidência reproduzível.`
    );
    lines.push("");
  }

  lines.push("## Veredito");
  lines.push("");
  lines.push(`- Gate: **${GATE_LABEL[report.gate.status]}**`);
  lines.push(`- Meta mínima (§1.1): ${percent(report.gate.minMatchRate)}`);
  lines.push(`- Pareamento global: ${percent(report.gate.matchRate)}`);
  lines.push(`- Falhas classificadas: ${report.gate.failureCount}`);
  lines.push(
    `- Falhas fora dos casos resolvíveis (não cobertas pela meta): ${report.gate.nonResolvableFailureCount}`
  );
  if (report.gate.blockReasons.length > 0) {
    lines.push(`- Motivos de bloqueio: ${report.gate.blockReasons.join(", ")}`);
  }
  lines.push("");
  lines.push(
    "- A meta de §1.1 é medida sobre **todos** os casos rotulados como resolvíveis, incluindo abstenções e falhas. Clarificação, rejeição e diferidos são verificados integralmente em segmento próprio e não inflam o numerador; denominador zero é reportado como `amostra ausente`, nunca como 0."
  );
  lines.push(
    "- O gate é fail-closed e não se dilui na taxa: `holdout_knowledge_write` (escrita em partição reservada), `knowledge_write_outside_acquisition` (escrita fora da aquisição em qualquer partição, inclusive tentada depois do fim do passo), `metrics_invalid` (amostra de latência/custo inválida) e `reference_not_verified` (fonte canônica divergente ou seção inexistente) bloqueiam por si."
  );
  lines.push(
    "- A janela de observação não tem brecha: a recusa é gravada pela própria fachada **no instante da tentativa**, num registro autoritativo compartilhado por medição, cenários e ablação, sem depender de colheita posterior. Efeito que se materializa depois do relatório ainda bloqueia, e a evidência exposta é visão derivada somente leitura: apagá-la não reverte o veredito."
  );
  lines.push(
    "- A isenção de quantidade (`input.nonQuantityTokens`) apenas corrobora um contexto de não-quantidade já visível na superfície, vale para **uma** ocorrência e não atravessa superfícies: sem marcador explícito de identificação na janela — ou na segunda ocorrência do mesmo token — a quantidade continua material."
  );
  lines.push(
    "- A ablação aplica a mesma política de efeitos da medição e exige o contra-factual declarado por inteiro: decisões **e** operação (`MealOperation`) precisam conferir."
  );
  lines.push(
    "- O aprendizado é provado por ablação contra o **contra-factual declarado** pelo corpus: com a aquisição ablacionada, cada passo posterior precisa produzir o resultado correto do mundo sem conhecimento. Diferença fabricada não passa. Limite declarado: o corpus não define mapeamento valor→resultado, portanto o harness prova dependência de presença do conhecimento, não a interpretação semântica do valor armazenado."
  );
  lines.push("");

  lines.push("## Integridade do corpus");
  lines.push("");
  lines.push(`- Status: **${report.integrity.status}**`);
  lines.push(
    `- IDs duplicados: ${numberOrDash(report.integrity.duplicateCaseIds.length)}`
  );
  lines.push(
    `- Superfícies duplicadas: ${report.integrity.duplicateSurfaces.length}`
  );
  lines.push(
    `- Vazamento entre partições: ${report.integrity.splitLeakage.length}`
  );
  lines.push(
    `- Grupos com expectativa divergente: ${report.integrity.divergentGroupExpectations.length}`
  );
  lines.push(
    `- Grupos metamórficos inválidos: ${report.integrity.invalidGroups.length}`
  );
  lines.push(
    `- Cenários de §16.1 inválidos: ${report.integrity.invalidScenarios.length}`
  );
  lines.push(`- Casos inválidos: ${report.integrity.invalidCases.length}`);
  lines.push(
    `- Conflitos de controle negativo: ${report.integrity.negativeControlConflicts.length}`
  );
  lines.push(
    `- Escritas de conhecimento em holdout: ${report.integrity.holdoutKnowledgeWrites.length}`
  );
  for (const item of report.integrity.invalidCases) {
    lines.push(`- \`${item.caseId}\`: ${item.message}`);
  }
  for (const item of report.integrity.invalidScenarios) {
    lines.push(`- \`${item.scenarioId}\`: ${item.message}`);
  }
  for (const item of report.integrity.divergentGroupExpectations) {
    lines.push(
      `- Grupo \`${item.groupId}\` com expectativa divergente: ${item.caseIds.join(", ")}`
    );
  }
  for (const item of report.integrity.invalidGroups) {
    lines.push(`- Grupo \`${item.groupId}\`: ${item.reason}`);
  }
  for (const item of report.integrity.holdoutKnowledgeWrites) {
    lines.push(
      `- \`${item.caseId}\` escreveu conhecimento reservado: ${item.writes.join(", ")}`
    );
  }
  lines.push(
    `- Escritas fora da fase de aquisição: ${report.integrity.knowledgeWritesOutside.length}`
  );
  lines.push(
    `- Escritas tentadas depois do fim do passo: ${report.integrity.knowledgeWritesAfterStep.length}`
  );
  for (const item of report.integrity.knowledgeWritesOutside) {
    lines.push(
      `- \`${item.caseId}\` tentou escrever conhecimento fora da aquisição: ${item.writes.join(", ")}`
    );
  }
  for (const item of report.integrity.knowledgeWritesAfterStep) {
    lines.push(
      `- \`${item.caseId}\` tentou escrever \`${item.key}\` depois de o passo terminar`
    );
  }
  lines.push("");

  lines.push("## Resultado global");
  lines.push("");
  lines.push(`- Resolvíveis rotulados: ${report.overall.resolvableLabeled}`);
  lines.push(`- Clarificação: ${report.overall.clarificationLabeled}`);
  lines.push(`- Rejeição: ${report.overall.rejectionLabeled}`);
  lines.push(`- Diferidos: ${report.overall.deferredLabeled}`);
  lines.push(
    `- Casos verificados integralmente: ${report.overall.matchedCases}/${report.overall.cases}`
  );
  lines.push(`- Abstenções: ${report.overall.abstentions}`);
  lines.push(
    `- Latência total: ${numberOrDash(report.overall.totalLatencyMs)} ms em ${report.overall.latencySamples} amostras`
  );
  lines.push(
    `- Custo total: ${numberOrDash(report.overall.totalCostUsd)} USD em ${report.overall.costSamples} amostras`
  );
  lines.push(
    "- Amostra de latência/custo não finita ou negativa é falha declarada (`metrics_invalid`) e não entra na agregação."
  );
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
  lines.push(segmentTable("Por marca", report.byBrand));
  lines.push(segmentTable("Por atributo material", report.byMaterialAttribute));
  lines.push(segmentTable("Por medida", report.byMeasure));
  lines.push(segmentTable("Por continuidade", report.byContinuity));
  lines.push(segmentTable("Por operação", report.byOperation));
  lines.push(
    segmentTable("Por procedência nutricional", report.byNutritionSource)
  );

  lines.push("### Equivalência de superfície (§4.1.8)");
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
        `| ${group.groupId} | ${group.memberCaseIds.join(", ")} | ${group.splits.join(", ")} | ${
          group.allMatchReference ? "sim" : "não"
        } | ${group.converged ? "sim" : "não"} | ${
          group.wrongConvergence ? "SIM (reprova)" : "não"
        } |`
      );
    }
    lines.push("");
    lines.push(
      "- Convergir entre si não basta: duas entradas que chegam ao **mesmo resultado errado** reprovam, porque a igualdade é medida contra a referência independente."
    );
  }
  lines.push("");

  lines.push("### Controles negativos (evidência adversarial)");
  lines.push("");
  if (report.negativeControls.length === 0) {
    lines.push("- Nenhum controle declarado.");
  } else {
    lines.push(
      "| Controle | Alvo | Executado | Dimensão discriminante | Discriminante | Hipótese de implementação errada |"
    );
    lines.push("| --- | --- | --- | --- | --- | --- |");
    for (const control of report.negativeControls) {
      lines.push(
        `| ${control.caseId} | ${control.targetCaseId} | ${
          control.executed ? "sim" : "não"
        } | ${control.discriminatingDimension} | ${
          control.discriminating ? "sim" : "NÃO (reprova)"
        } | ${control.hypothesis} |`
      );
    }
    lines.push("");
    lines.push(
      "- Controle que absteve dos dois lados não discrimina nada: sem saída não há evidência de distinção, e o controle conta como não discriminante."
    );
    lines.push("");
    for (const control of report.negativeControls) {
      lines.push(
        `- \`${control.caseId}\` — controle: \`${control.controlSignature}\``
      );
      lines.push(`  alvo: \`${control.targetSignature}\``);
    }
  }
  lines.push("");

  lines.push("### Consistência de macros entre entradas equivalentes (§1.1)");
  lines.push("");
  if (report.macroConsistency.length === 0) {
    lines.push("- Nenhum grupo declarado.");
  } else {
    lines.push("| Grupo | Consistente | Divergências |");
    lines.push("| --- | --- | --- |");
    for (const item of report.macroConsistency) {
      lines.push(
        `| ${item.groupId} | ${item.consistent ? "sim" : "NÃO"} | ${
          item.divergences.length === 0 ? "—" : item.divergences.join("; ")
        } |`
      );
    }
    lines.push("");
    lines.push(
      "- A tolerância de arredondamento de macros é `OPEN` (§25 item 30): ela não é parâmetro de execução e divergência de macros **bloqueia** sempre.",
      "- A meta de pareamento de §1.1 é fixa: não existe opção que a reduza.",
      "- Classificação (§8.7, §9.3 classe J) é medida: item proposto exige classificação presente e versionada, e os casos de classe J declaram o conteúdo."
    );
  }
  lines.push("");

  lines.push("### Cenários de aprendizado e generalização (§16.1)");
  lines.push("");
  for (const scenario of report.learningScenarios) {
    lines.push(`#### ${scenario.scenarioId}`);
    lines.push("");
    lines.push(`- Fases: ${scenario.phases.join(", ")}`);
    lines.push(`- Proprietários: ${scenario.ownerRefs.join(", ")}`);
    lines.push(`- Conversas: ${scenario.conversationRefs.join(", ")}`);
    lines.push(`- Resultado: ${scenario.passed ? "PASSOU" : "FALHOU"}`);
    lines.push("");
    lines.push(
      "| Passo | Fase | Caso | Aprendizado | Escritas | Reproduz | Difere de |"
    );
    lines.push("| --- | --- | --- | --- | --- | --- | --- |");
    for (const step of scenario.steps) {
      lines.push(
        `| ${step.stepId} | ${step.phase} | ${step.caseId} | ${
          step.allowLearning ? "sim" : "não"
        } | ${step.recordedWriteAttempts} | ${
          step.sameResultAsStepId === null
            ? "—"
            : `${step.sameResultAsStepId} (${step.sameResultSatisfied ? "ok" : "FALHOU"})`
        } | ${
          step.differentFromStepId === null
            ? "—"
            : `${step.differentFromStepId} (${step.differentFromSatisfied ? "ok" : "FALHOU"})`
        } |`
      );
    }
    lines.push("");
    for (const failure of scenario.failures) {
      lines.push(
        `- \`${failure.caseId}\` ${failure.codes.join(", ")}: ${failure.detail}`
      );
    }
    lines.push("");
  }

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

/** Alias estável do renderizador. */
export const renderCorpusReport = renderCorpusReportMarkdown;
