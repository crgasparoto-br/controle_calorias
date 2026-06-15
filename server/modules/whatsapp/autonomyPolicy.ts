import type {
  CanonicalWhatsappIntentName,
  WhatsappIntentAutonomyLevel,
  WhatsappIntentSafetyLevel,
} from "./canonicalIntentSchema";

export const WHATSAPP_AUTONOMY_POLICY_VERSION = "whatsapp-autonomy-policy/v1" as const;

export type WhatsappAutonomyDefaultOutcome = "no_action" | "execute" | "confirm" | "review" | "block";

export type WhatsappAutonomyPolicyRule = {
  intent: CanonicalWhatsappIntentName;
  defaultLevel: WhatsappIntentAutonomyLevel;
  defaultOutcome: WhatsappAutonomyDefaultOutcome;
  minimumConfidence: number;
  requiresBackendValidation: boolean;
  requiresExplicitAcceptance: boolean;
  requiresReview: boolean;
  sensitive: boolean;
  reason: string;
};

export type WhatsappAutonomyPolicyInput = {
  intent: CanonicalWhatsappIntentName;
  confidence: number;
  safetyLevel: WhatsappIntentSafetyLevel;
  backendValidated?: boolean;
  contextResolved?: boolean;
  hasAmbiguity?: boolean;
  hasSensitiveTarget?: boolean;
  explicitAcceptance?: boolean;
};

export type WhatsappAutonomyDecision = {
  policyVersion: typeof WHATSAPP_AUTONOMY_POLICY_VERSION;
  intent: CanonicalWhatsappIntentName;
  confidence: number;
  autonomyLevel: WhatsappIntentAutonomyLevel;
  outcome: WhatsappAutonomyDefaultOutcome;
  minimumConfidence: number;
  requiresBackendValidation: boolean;
  requiresExplicitAcceptance: boolean;
  requiresReview: boolean;
  reason: string;
};

function rule(
  intent: CanonicalWhatsappIntentName,
  input: Omit<WhatsappAutonomyPolicyRule, "intent">,
): WhatsappAutonomyPolicyRule {
  return { intent, ...input };
}

const automaticFoodWrite = (intent: CanonicalWhatsappIntentName, reason: string) => rule(intent, {
  defaultLevel: "automatico",
  defaultOutcome: "execute",
  minimumConfidence: 0.86,
  requiresBackendValidation: true,
  requiresExplicitAcceptance: false,
  requiresReview: false,
  sensitive: false,
  reason,
});

const confirmationFoodWrite = (intent: CanonicalWhatsappIntentName, reason: string) => rule(intent, {
  defaultLevel: "requer_confirmacao",
  defaultOutcome: "confirm",
  minimumConfidence: 0.8,
  requiresBackendValidation: true,
  requiresExplicitAcceptance: true,
  requiresReview: false,
  sensitive: false,
  reason,
});

const reviewAction = (intent: CanonicalWhatsappIntentName, reason: string) => rule(intent, {
  defaultLevel: "requer_revisao",
  defaultOutcome: "review",
  minimumConfidence: 0.82,
  requiresBackendValidation: true,
  requiresExplicitAcceptance: true,
  requiresReview: true,
  sensitive: true,
  reason,
});

const safeReadAction = (intent: CanonicalWhatsappIntentName, reason: string) => rule(intent, {
  defaultLevel: "automatico",
  defaultOutcome: "execute",
  minimumConfidence: 0.74,
  requiresBackendValidation: false,
  requiresExplicitAcceptance: false,
  requiresReview: false,
  sensitive: false,
  reason,
});

const clarificationAction = (intent: CanonicalWhatsappIntentName, reason: string) => rule(intent, {
  defaultLevel: "requer_confirmacao",
  defaultOutcome: "confirm",
  minimumConfidence: 0.5,
  requiresBackendValidation: false,
  requiresExplicitAcceptance: true,
  requiresReview: false,
  sensitive: false,
  reason,
});

const noAction = (intent: CanonicalWhatsappIntentName, reason: string) => rule(intent, {
  defaultLevel: "automatico",
  defaultOutcome: "no_action",
  minimumConfidence: 0,
  requiresBackendValidation: false,
  requiresExplicitAcceptance: false,
  requiresReview: false,
  sensitive: false,
  reason,
});

const blockedAction = (intent: CanonicalWhatsappIntentName, reason: string) => rule(intent, {
  defaultLevel: "bloqueado",
  defaultOutcome: "block",
  minimumConfidence: 0,
  requiresBackendValidation: false,
  requiresExplicitAcceptance: false,
  requiresReview: true,
  sensitive: true,
  reason,
});

export const whatsappAutonomyPolicyByIntent = {
  registrar_alimento: automaticFoodWrite("registrar_alimento", "Registro alimentar simples pode ser automatico quando validado e confiante."),
  adicionar_alimento: automaticFoodWrite("adicionar_alimento", "Adicao alimentar simples pode ser automatica quando validada e confiante."),
  corrigir_alimento: confirmationFoodWrite("corrigir_alimento", "Correcao altera registro existente e exige confirmacao quando houver impacto no dado persistido."),
  trocar_alimento: confirmationFoodWrite("trocar_alimento", "Troca de alimento altera registro existente e exige confirmacao explicita."),
  excluir_alimento: confirmationFoodWrite("excluir_alimento", "Exclusao remove dado persistente e exige confirmacao explicita."),
  excluir_refeicao: confirmationFoodWrite("excluir_refeicao", "Exclusao de refeicao remove conjunto de dados e exige confirmacao explicita."),
  somar_quantidade: automaticFoodWrite("somar_quantidade", "Soma de quantidade pode ser automatica quando o alvo e a unidade forem validados."),
  calcular_quantidade: safeReadAction("calcular_quantidade", "Calculo isolado nao altera estado e pode responder sem persistencia."),
  acao_composta: confirmationFoodWrite("acao_composta", "Mensagem com multiplas acoes exige confirmacao e validacao individual."),
  resumo_dia: safeReadAction("resumo_dia", "Resumo do proprio usuario e leitura segura quando o alvo esta no escopo."),
  resumo_periodo: safeReadAction("resumo_periodo", "Resumo de periodo e leitura segura quando o alvo esta no escopo."),
  gerar_grafico: safeReadAction("gerar_grafico", "Grafico e leitura/visualizacao segura quando o alvo esta no escopo."),
  gerar_relatorio: safeReadAction("gerar_relatorio", "Relatorio e leitura segura quando o alvo esta no escopo autorizado."),
  sugestao_refeicao: clarificationAction("sugestao_refeicao", "Sugestao nao deve alterar estado sem aceite do usuario."),
  sugestao_alimento: clarificationAction("sugestao_alimento", "Sugestao alimentar nao deve alterar estado sem aceite do usuario."),
  consulta_historico: safeReadAction("consulta_historico", "Consulta historica e leitura segura quando o alvo esta no escopo."),
  pergunta_sobre_meta: safeReadAction("pergunta_sobre_meta", "Pergunta sobre meta e leitura segura do proprio contexto."),
  pergunta_sobre_evolucao: safeReadAction("pergunta_sobre_evolucao", "Pergunta sobre evolucao e leitura segura do proprio contexto."),
  pergunta_sobre_qualidade_alimentar: safeReadAction("pergunta_sobre_qualidade_alimentar", "Analise alimentar pode responder sem alterar estado."),
  pergunta_sobre_alimento: safeReadAction("pergunta_sobre_alimento", "Pergunta alimentar simples pode responder sem alterar estado."),
  pergunta_saude_dieta: clarificationAction("pergunta_saude_dieta", "Saude e dieta exigem cautela e limites de resposta segura."),
  pergunta_medica_sensivel: reviewAction("pergunta_medica_sensivel", "Pergunta medica sensivel exige revisao ou resposta limitada."),
  possivel_urgencia_saude: blockedAction("possivel_urgencia_saude", "Possivel urgencia de saude deve bloquear acao e orientar atendimento adequado."),
  analisar_imagem_alimento: clarificationAction("analisar_imagem_alimento", "Imagem de alimento exige confirmacao quando a confianca ou porcao nao forem suficientes."),
  extrair_rotulo_nutricional: reviewAction("extrair_rotulo_nutricional", "Rotulo extraido de midia exige revisao antes de persistencia."),
  midia_ambigua: clarificationAction("midia_ambigua", "Midia ambigua exige esclarecimento antes de qualquer acao."),
  profissional_solicita_informacao: reviewAction("profissional_solicita_informacao", "Solicitacao profissional depende de escopo autorizado e revisao quando houver dados de paciente."),
  profissional_sugere_meta: reviewAction("profissional_sugere_meta", "Sugestao profissional de meta exige aceite explicito do paciente ou revisao."),
  profissional_sugere_plano_alimentar: reviewAction("profissional_sugere_plano_alimentar", "Sugestao de plano alimentar exige aceite explicito e revisao."),
  profissional_sugere_refeicao: reviewAction("profissional_sugere_refeicao", "Sugestao profissional de refeicao exige aceite explicito antes de alterar registros."),
  profissional_sugere_ajuste: reviewAction("profissional_sugere_ajuste", "Ajuste profissional exige aceite explicito ou revisao conforme escopo."),
  paciente_aceita_sugestao: confirmationFoodWrite("paciente_aceita_sugestao", "Aceite do paciente confirma proposta pendente, mas ainda exige validacao de backend."),
  paciente_recusa_sugestao: safeReadAction("paciente_recusa_sugestao", "Recusa encerra pendencia sem alterar dados sensiveis."),
  paciente_pede_ajuste_sugestao: clarificationAction("paciente_pede_ajuste_sugestao", "Pedido de ajuste cria nova pendencia contextual."),
  paciente_envia_mensagem_profissional: safeReadAction("paciente_envia_mensagem_profissional", "Mensagem encaminhada nao altera plano ou meta automaticamente."),
  profissional_envia_mensagem_paciente: reviewAction("profissional_envia_mensagem_paciente", "Mensagem profissional exige escopo autorizado e rastreabilidade."),
  confirmar_alteracao_meta: reviewAction("confirmar_alteracao_meta", "Alteracao de meta e sensivel e exige aceite/revisao."),
  confirmar_alteracao_plano: reviewAction("confirmar_alteracao_plano", "Alteracao de plano alimentar e sensivel e exige aceite/revisao."),
  confirmacao_sim_nao: clarificationAction("confirmacao_sim_nao", "Confirmacao curta precisa de contexto pendente resolvido."),
  selecionar_opcao: clarificationAction("selecionar_opcao", "Selecao de opcao precisa de contexto pendente resolvido."),
  pedir_esclarecimento: noAction("pedir_esclarecimento", "Pergunta de esclarecimento nao executa acao de dominio."),
  cancelar_pendencia: safeReadAction("cancelar_pendencia", "Cancelamento de pendencia encerra estado sem criar dado novo."),
  mensagem_ambigua: clarificationAction("mensagem_ambigua", "Mensagem ambigua exige esclarecimento e nao deve cair em fallback alimentar automatico."),
  mensagem_nao_relacionada: noAction("mensagem_nao_relacionada", "Mensagem fora do escopo nao deve executar acao no sistema."),
} satisfies Record<CanonicalWhatsappIntentName, WhatsappAutonomyPolicyRule>;

function decisionFromRule(
  ruleConfig: WhatsappAutonomyPolicyRule,
  input: WhatsappAutonomyPolicyInput,
  override: Partial<WhatsappAutonomyDecision> = {},
): WhatsappAutonomyDecision {
  return {
    policyVersion: WHATSAPP_AUTONOMY_POLICY_VERSION,
    intent: input.intent,
    confidence: input.confidence,
    autonomyLevel: ruleConfig.defaultLevel,
    outcome: ruleConfig.defaultOutcome,
    minimumConfidence: ruleConfig.minimumConfidence,
    requiresBackendValidation: ruleConfig.requiresBackendValidation,
    requiresExplicitAcceptance: ruleConfig.requiresExplicitAcceptance,
    requiresReview: ruleConfig.requiresReview,
    reason: ruleConfig.reason,
    ...override,
  };
}

export function evaluateWhatsappAutonomyPolicy(input: WhatsappAutonomyPolicyInput): WhatsappAutonomyDecision {
  const ruleConfig = whatsappAutonomyPolicyByIntent[input.intent];

  if (input.safetyLevel === "bloqueado") {
    return decisionFromRule(ruleConfig, input, {
      autonomyLevel: "bloqueado",
      outcome: "block",
      requiresReview: true,
      reason: "Conteudo classificado como bloqueado pela camada de seguranca.",
    });
  }

  if (input.hasSensitiveTarget || ruleConfig.sensitive) {
    return decisionFromRule(ruleConfig, input, {
      autonomyLevel: ruleConfig.defaultLevel === "bloqueado" ? "bloqueado" : "requer_revisao",
      outcome: ruleConfig.defaultOutcome === "block" ? "block" : "review",
      requiresReview: true,
      reason: ruleConfig.reason,
    });
  }

  if (input.hasAmbiguity || input.confidence < ruleConfig.minimumConfidence) {
    return decisionFromRule(ruleConfig, input, {
      autonomyLevel: "requer_confirmacao",
      outcome: "confirm",
      reason: input.hasAmbiguity
        ? "Ambiguidade detectada exige confirmacao antes de executar."
        : "Confianca abaixo do minimo da politica exige confirmacao.",
    });
  }

  if (ruleConfig.requiresBackendValidation && !input.backendValidated) {
    return decisionFromRule(ruleConfig, input, {
      autonomyLevel: "requer_revisao",
      outcome: "review",
      requiresReview: true,
      reason: "Acao exige validacao de backend antes de execucao automatica.",
    });
  }

  if (ruleConfig.requiresExplicitAcceptance && !input.explicitAcceptance) {
    return decisionFromRule(ruleConfig, input, {
      autonomyLevel: "requer_confirmacao",
      outcome: "confirm",
      reason: "Acao exige aceite ou confirmacao explicita.",
    });
  }

  if (input.contextResolved === false) {
    return decisionFromRule(ruleConfig, input, {
      autonomyLevel: "requer_confirmacao",
      outcome: "confirm",
      reason: "Contexto pendente ou alvo nao resolvido exige confirmacao.",
    });
  }

  return decisionFromRule(ruleConfig, input);
}
