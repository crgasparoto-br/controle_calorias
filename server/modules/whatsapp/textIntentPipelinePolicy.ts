export type WhatsAppTextIntentPipelineStep = {
  key: string;
  owner: "webhook" | "simulation" | "shared";
  description: string;
};

/**
 * Ordem canônica de decisão para mensagens textuais do WhatsApp.
 *
 * Este arquivo não executa handlers diretamente. Ele é a fonte versionada da
 * precedência esperada entre webhook real e simulação, evitando que novos casos
 * sejam adicionados em ordens divergentes nos dois fluxos.
 */
export const WHATSAPP_TEXT_INTENT_PIPELINE_POLICY: WhatsAppTextIntentPipelineStep[] = [
  {
    key: "idempotency",
    owner: "shared",
    description: "Descartar mensagens já processadas antes de qualquer efeito colateral.",
  },
  {
    key: "conversation_context",
    owner: "shared",
    description: "Resolver respostas curtas para contexto pendente antes de interpretar como novo consumo.",
  },
  {
    key: "temporal_context",
    owner: "shared",
    description: "Resolver datas relativas e pedir esclarecimento quando a referência temporal for ambígua.",
  },
  {
    key: "safety_guard",
    owner: "shared",
    description: "Bloquear instruções suspeitas antes de inferência nutricional ou ações de escrita.",
  },
  {
    key: "administrative_and_access_actions",
    owner: "shared",
    description: "Tratar respostas de vínculo profissional, exclusões e comandos administrativos antes do fallback nutricional.",
  },
  {
    key: "auxiliary_logs",
    owner: "shared",
    description: "Registrar água e peso quando a mensagem for inequivocamente operacional.",
  },
  {
    key: "meal_mutations",
    owner: "shared",
    description: "Executar adições, ajustes de gramas, incrementos, substituições e correções em refeições existentes.",
  },
  {
    key: "reports_and_suggestions",
    owner: "shared",
    description: "Responder relatórios, listagens e sugestões antes de criar novo rascunho de refeição.",
  },
  {
    key: "llm_router",
    owner: "shared",
    description: "Usar classificador LLM para mensagens ambíguas, preservando fallback nutricional quando indicado.",
  },
  {
    key: "nutrition_fallback",
    owner: "shared",
    description: "Só criar rascunho ou registro nutricional quando nenhum comando textual anterior assumir a mensagem.",
  },
];

export function getWhatsAppTextIntentPipelineStepKeys() {
  return WHATSAPP_TEXT_INTENT_PIPELINE_POLICY.map(step => step.key);
}
