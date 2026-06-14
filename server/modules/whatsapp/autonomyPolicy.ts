import { WHATSAPP_INTENT_CONFIDENCE, type WhatsappIntentName, whatsappIntentNames } from "./intentSchema";
import { type WhatsappCanonicalIntentName, whatsappCanonicalIntentNames } from "./canonicalIntentSchema";

export const whatsappAutonomyLevels = ["automatico", "requer_confirmacao", "requer_revisao", "bloqueado"] as const;
export type WhatsappAutonomyLevel = typeof whatsappAutonomyLevels[number];

export const whatsappAutonomyOutcomes = ["execute", "clarify", "review", "block", "fallback"] as const;
export type WhatsappAutonomyOutcome = typeof whatsappAutonomyOutcomes[number];

export type WhatsappAutonomyPolicyIntentName = WhatsappIntentName | WhatsappCanonicalIntentName;
export type WhatsappAutonomySafetyLevel = "normal" | "sensivel" | "risco_saude" | "bloqueado";
export type WhatsappAutonomyValidationStatus = "pendente" | "valida" | "invalida" | "bloqueada" | "valid" | "invalid_json" | "invalid_payload" | "skipped";

type WhatsappAutonomyPolicyRule = {
  level: WhatsappAutonomyLevel;
  minimumConfidence: number;
  reason: string;
  sensitive?: boolean;
};

export type WhatsappAutonomyDecision = {
  intentName: WhatsappAutonomyPolicyIntentName;
  level: WhatsappAutonomyLevel;
  outcome: WhatsappAutonomyOutcome;
  canExecute: boolean;
  needsConfirmation: boolean;
  minimumConfidence: number;
  reason: string;
};

type EvaluateWhatsappAutonomyPolicyInput = {
  intentName: WhatsappAutonomyPolicyIntentName;
  confidence: number;
  requiresConfirmation?: boolean;
  safetyLevel?: WhatsappAutonomySafetyLevel;
  validationStatus?: WhatsappAutonomyValidationStatus;
};

const DEFAULT_RULE: WhatsappAutonomyPolicyRule = {
  level: "requer_confirmacao",
  minimumConfidence: WHATSAPP_INTENT_CONFIDENCE.execute,
  reason: "Intencao sem regra especifica exige confirmacao antes de qualquer acao.",
};

const autonomyPolicyRules: Record<WhatsappAutonomyPolicyIntentName, WhatsappAutonomyPolicyRule> = {
  add_foods_to_meal: {
    level: "automatico",
    minimumConfidence: WHATSAPP_INTENT_CONFIDENCE.execute,
    reason: "Registro alimentar simples pode executar automaticamente quando confianca e validacao forem suficientes.",
  },
  replace_food_in_meal: {
    level: "requer_confirmacao",
    minimumConfidence: 0.86,
    reason: "Troca de alimento altera registro existente e exige confirmacao explicita.",
  },
  edit_food_quantity: {
    level: "requer_confirmacao",
    minimumConfidence: 0.86,
    reason: "Correcao de quantidade altera registro existente e exige confirmacao explicita.",
  },
  list_meal_records: {
    level: "automatico",
    minimumConfidence: WHATSAPP_INTENT_CONFIDENCE.clarify,
    reason: "Consulta de historico e somente leitura e pode responder diretamente.",
  },
  daily_summary: {
    level: "automatico",
    minimumConfidence: WHATSAPP_INTENT_CONFIDENCE.clarify,
    reason: "Resumo diario e somente leitura e pode responder diretamente.",
  },
  add_water: {
    level: "automatico",
    minimumConfidence: WHATSAPP_INTENT_CONFIDENCE.execute,
    reason: "Registro simples de agua pode executar automaticamente com confianca suficiente.",
  },
  add_exercise: {
    level: "requer_confirmacao",
    minimumConfidence: 0.8,
    reason: "Exercicio impacta totais diarios e exige confirmacao ate existir validacao dedicada.",
  },
  open_records_link: {
    level: "automatico",
    minimumConfidence: WHATSAPP_INTENT_CONFIDENCE.clarify,
    reason: "Abrir ou orientar acesso a registros nao altera dados.",
  },
  help: {
    level: "automatico",
    minimumConfidence: 0.3,
    reason: "Ajuda nao altera dados e pode ser enviada diretamente.",
  },
  ambiguous: {
    level: "requer_confirmacao",
    minimumConfidence: 1,
    reason: "Mensagem ambigua sempre precisa de esclarecimento.",
  },
  unknown: {
    level: "requer_confirmacao",
    minimumConfidence: 1,
    reason: "Mensagem desconhecida sempre precisa de esclarecimento ou fallback seguro.",
  },
  registrar_alimento: {
    level: "automatico",
    minimumConfidence: WHATSAPP_INTENT_CONFIDENCE.execute,
    reason: "Registro alimentar simples pode executar automaticamente quando confianca e validacao forem suficientes.",
  },
  adicionar_alimento: {
    level: "automatico",
    minimumConfidence: WHATSAPP_INTENT_CONFIDENCE.execute,
    reason: "Adicionar alimento pode executar automaticamente quando confianca e validacao forem suficientes.",
  },
  corrigir_alimento: {
    level: "requer_confirmacao",
    minimumConfidence: 0.86,
    reason: "Correcao altera um registro existente e exige confirmacao explicita.",
  },
  trocar_alimento: {
    level: "requer_confirmacao",
    minimumConfidence: 0.86,
    reason: "Troca altera um registro existente e exige confirmacao explicita.",
  },
  excluir_alimento: {
    level: "requer_confirmacao",
    minimumConfidence: 0.9,
    reason: "Exclusao remove dado do usuario e exige confirmacao explicita.",
  },
  excluir_refeicao: {
    level: "requer_confirmacao",
    minimumConfidence: 0.92,
    reason: "Exclusao de refeicao remove varios dados e exige confirmacao explicita.",
  },
  somar_quantidade: {
    level: "requer_confirmacao",
    minimumConfidence: 0.86,
    reason: "Soma de quantidade altera registro existente e exige confirmacao explicita.",
  },
  calcular_quantidade: {
    level: "requer_confirmacao",
    minimumConfidence: 0.8,
    reason: "Calculo pode apoiar a resposta, mas precisa de aceite antes de alterar dados.",
  },
  acao_composta: {
    level: "requer_confirmacao",
    minimumConfidence: 0.9,
    reason: "Acoes compostas podem ter efeitos multiplos e exigem confirmacao.",
  },
  resumo_dia: {
    level: "automatico",
    minimumConfidence: WHATSAPP_INTENT_CONFIDENCE.clarify,
    reason: "Resumo diario e somente leitura e pode responder diretamente.",
  },
  resumo_periodo: {
    level: "automatico",
    minimumConfidence: 0.65,
    reason: "Resumo por periodo e leitura e pode responder quando o periodo estiver claro.",
  },
  gerar_grafico: {
    level: "automatico",
    minimumConfidence: 0.7,
    reason: "Grafico e saida derivada de leitura e pode ser gerado com periodo claro.",
  },
  gerar_relatorio: {
    level: "automatico",
    minimumConfidence: 0.7,
    reason: "Relatorio e saida derivada de leitura e pode ser gerado com periodo claro.",
  },
  sugestao_refeicao: {
    level: "requer_confirmacao",
    minimumConfidence: 0.82,
    reason: "Sugestao alimentar deve ser apresentada para aceite, nao aplicada automaticamente.",
  },
  sugestao_alimento: {
    level: "requer_confirmacao",
    minimumConfidence: 0.82,
    reason: "Sugestao de alimento deve ser apresentada para aceite, nao aplicada automaticamente.",
  },
  consulta_historico: {
    level: "automatico",
    minimumConfidence: WHATSAPP_INTENT_CONFIDENCE.clarify,
    reason: "Consulta de historico e somente leitura e pode responder diretamente.",
  },
  pergunta_sobre_meta: {
    level: "automatico",
    minimumConfidence: 0.65,
    reason: "Pergunta sobre meta e leitura; alteracao de meta usa regra propria de confirmacao.",
  },
  pergunta_sobre_evolucao: {
    level: "automatico",
    minimumConfidence: 0.65,
    reason: "Pergunta sobre evolucao e leitura e pode responder diretamente.",
  },
  pergunta_sobre_qualidade_alimentar: {
    level: "automatico",
    minimumConfidence: 0.65,
    reason: "Analise alimentar informativa pode responder sem alterar dados.",
  },
  pergunta_sobre_alimento: {
    level: "automatico",
    minimumConfidence: 0.65,
    reason: "Pergunta sobre alimento e informativa e pode responder sem alterar dados.",
  },
  pergunta_saude_dieta: {
    level: "requer_revisao",
    minimumConfidence: 0.8,
    reason: "Pergunta de saude ou dieta pode exigir cuidado e nao deve virar acao automatica.",
    sensitive: true,
  },
  pergunta_medica_sensivel: {
    level: "requer_revisao",
    minimumConfidence: 0.8,
    reason: "Pergunta medica sensivel exige revisao ou orientacao segura sem conduta automatica.",
    sensitive: true,
  },
  possivel_urgencia_saude: {
    level: "bloqueado",
    minimumConfidence: 0,
    reason: "Possivel urgencia de saude deve ser bloqueada para automacao e receber orientacao segura.",
    sensitive: true,
  },
  analisar_imagem_alimento: {
    level: "requer_confirmacao",
    minimumConfidence: 0.82,
    reason: "Imagem de alimento pode ser imprecisa e exige confirmacao antes de registrar.",
  },
  extrair_rotulo_nutricional: {
    level: "requer_revisao",
    minimumConfidence: 0.82,
    reason: "Rotulo nutricional extraido de midia precisa de revisao antes de virar fonte persistente.",
  },
  midia_ambigua: {
    level: "requer_confirmacao",
    minimumConfidence: 1,
    reason: "Midia ambigua sempre precisa de esclarecimento.",
  },
  profissional_solicita_informacao: {
    level: "automatico",
    minimumConfidence: 0.7,
    reason: "Solicitacao profissional de informacao e leitura controlada por permissao.",
  },
  profissional_sugere_meta: {
    level: "requer_revisao",
    minimumConfidence: 0.9,
    reason: "Sugestao profissional de meta exige aceite explicito do paciente antes de aplicar.",
    sensitive: true,
  },
  profissional_sugere_plano_alimentar: {
    level: "requer_revisao",
    minimumConfidence: 0.9,
    reason: "Sugestao profissional de plano exige aceite explicito do paciente antes de aplicar.",
    sensitive: true,
  },
  profissional_sugere_refeicao: {
    level: "requer_revisao",
    minimumConfidence: 0.88,
    reason: "Sugestao profissional de refeicao exige aceite explicito do paciente antes de aplicar.",
    sensitive: true,
  },
  profissional_sugere_ajuste: {
    level: "requer_revisao",
    minimumConfidence: 0.88,
    reason: "Sugestao profissional de ajuste exige aceite explicito do paciente antes de aplicar.",
    sensitive: true,
  },
  paciente_aceita_sugestao: {
    level: "requer_confirmacao",
    minimumConfidence: 0.86,
    reason: "Aceite do paciente precisa estar vinculado a proposta pendente antes de aplicar.",
  },
  paciente_recusa_sugestao: {
    level: "automatico",
    minimumConfidence: 0.74,
    reason: "Recusa de sugestao nao aplica mudanca sensivel e pode encerrar a pendencia.",
  },
  paciente_pede_ajuste_sugestao: {
    level: "requer_confirmacao",
    minimumConfidence: 0.8,
    reason: "Pedido de ajuste deve voltar para fluxo de proposta antes de aplicar mudancas.",
  },
  paciente_envia_mensagem_profissional: {
    level: "automatico",
    minimumConfidence: 0.7,
    reason: "Mensagem ao profissional pode ser encaminhada sem alterar dados clinicos.",
  },
  profissional_envia_mensagem_paciente: {
    level: "automatico",
    minimumConfidence: 0.7,
    reason: "Mensagem do profissional pode ser encaminhada sem alterar dados clinicos.",
  },
  confirmar_alteracao_meta: {
    level: "requer_confirmacao",
    minimumConfidence: 0.95,
    reason: "Alteracao de meta exige confirmacao explicita e proposta pendente valida.",
    sensitive: true,
  },
  confirmar_alteracao_plano: {
    level: "requer_confirmacao",
    minimumConfidence: 0.95,
    reason: "Alteracao de plano exige confirmacao explicita e proposta pendente valida.",
    sensitive: true,
  },
  confirmacao_sim_nao: {
    level: "requer_confirmacao",
    minimumConfidence: 0.8,
    reason: "Confirmacao generica precisa estar vinculada a pendencia antes de executar.",
  },
  selecionar_opcao: {
    level: "requer_confirmacao",
    minimumConfidence: 0.8,
    reason: "Selecao de opcao precisa estar vinculada a contexto pendente antes de executar.",
  },
  pedir_esclarecimento: {
    level: "requer_confirmacao",
    minimumConfidence: 1,
    reason: "Pedido de esclarecimento sempre solicita mais contexto ao usuario.",
  },
  cancelar_pendencia: {
    level: "automatico",
    minimumConfidence: 0.74,
    reason: "Cancelamento de pendencia interrompe fluxo aberto sem criar nova acao sensivel.",
  },
  mensagem_ambigua: {
    level: "requer_confirmacao",
    minimumConfidence: 1,
    reason: "Mensagem ambigua sempre precisa de esclarecimento.",
  },
  mensagem_nao_relacionada: {
    level: "bloqueado",
    minimumConfidence: 0,
    reason: "Mensagem fora do dominio nao deve acionar automacao nutricional.",
  },
};

function isKnownPolicyIntentName(value: string): value is WhatsappAutonomyPolicyIntentName {
  return (whatsappIntentNames as readonly string[]).includes(value)
    || (whatsappCanonicalIntentNames as readonly string[]).includes(value);
}

function isInvalidValidationStatus(status?: WhatsappAutonomyValidationStatus) {
  return status === "invalida" || status === "bloqueada" || status === "invalid_json" || status === "invalid_payload";
}

function buildDecision(input: EvaluateWhatsappAutonomyPolicyInput, rule: WhatsappAutonomyPolicyRule, overrides: Partial<WhatsappAutonomyDecision>): WhatsappAutonomyDecision {
  const outcome = overrides.outcome ?? (rule.level === "automatico" ? "execute" : rule.level === "requer_confirmacao" ? "clarify" : rule.level === "requer_revisao" ? "review" : "block");
  return {
    intentName: input.intentName,
    level: overrides.level ?? rule.level,
    outcome,
    canExecute: overrides.canExecute ?? outcome === "execute",
    needsConfirmation: overrides.needsConfirmation ?? outcome !== "execute",
    minimumConfidence: rule.minimumConfidence,
    reason: overrides.reason ?? rule.reason,
  };
}

export function getWhatsappAutonomyPolicyRule(intentName: WhatsappAutonomyPolicyIntentName) {
  return autonomyPolicyRules[intentName] ?? DEFAULT_RULE;
}

export function evaluateWhatsappAutonomyPolicy(input: EvaluateWhatsappAutonomyPolicyInput): WhatsappAutonomyDecision {
  const rule = getWhatsappAutonomyPolicyRule(input.intentName);

  if (!isKnownPolicyIntentName(input.intentName)) {
    return buildDecision(input, DEFAULT_RULE, {
      level: "requer_confirmacao",
      outcome: "clarify",
      canExecute: false,
      needsConfirmation: true,
      reason: DEFAULT_RULE.reason,
    });
  }

  if (input.safetyLevel === "bloqueado" || rule.level === "bloqueado") {
    return buildDecision(input, rule, {
      level: "bloqueado",
      outcome: "block",
      canExecute: false,
      needsConfirmation: true,
      reason: input.safetyLevel === "bloqueado" ? "Nivel de seguranca bloqueado impede automacao." : rule.reason,
    });
  }

  if (input.safetyLevel === "risco_saude" || (rule.sensitive && input.safetyLevel === "sensivel")) {
    return buildDecision(input, rule, {
      level: "requer_revisao",
      outcome: "review",
      canExecute: false,
      needsConfirmation: true,
      reason: "Conteudo sensivel exige revisao antes de qualquer acao automatica.",
    });
  }

  if (isInvalidValidationStatus(input.validationStatus)) {
    return buildDecision(input, rule, {
      level: "bloqueado",
      outcome: "block",
      canExecute: false,
      needsConfirmation: true,
      reason: "Validacao invalida ou bloqueada impede execucao automatica.",
    });
  }

  if (input.requiresConfirmation) {
    return buildDecision(input, rule, {
      level: rule.level === "automatico" ? "requer_confirmacao" : rule.level,
      outcome: rule.level === "requer_revisao" ? "review" : "clarify",
      canExecute: false,
      needsConfirmation: true,
      reason: "A interpretacao solicitou confirmacao antes da execucao.",
    });
  }

  if (input.confidence < rule.minimumConfidence) {
    return buildDecision(input, rule, {
      level: rule.level === "automatico" ? "requer_confirmacao" : rule.level,
      outcome: rule.level === "requer_revisao" ? "review" : "clarify",
      canExecute: false,
      needsConfirmation: true,
      reason: `Confianca ${input.confidence.toFixed(2)} abaixo do minimo ${rule.minimumConfidence.toFixed(2)} para esta acao.`,
    });
  }

  return buildDecision(input, rule, {});
}
