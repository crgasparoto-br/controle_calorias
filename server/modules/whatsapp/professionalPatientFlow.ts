import type { WhatsappIntentName } from "./intentSchema";

export const WHATSAPP_PROFESSIONAL_PATIENT_FLOW_VERSION = "whatsapp-professional-patient-flow/v1";

export type WhatsappProfessionalPatientActor = "patient" | "professional" | "system";
export type WhatsappProfessionalPatientPendingKind =
  | "information_request"
  | "goal_suggestion"
  | "meal_plan_suggestion"
  | "meal_suggestion"
  | "adjustment_suggestion"
  | "message";
export type WhatsappProfessionalPatientPendingStatus =
  | "pending"
  | "accepted"
  | "rejected"
  | "adjustment_requested"
  | "expired"
  | "cancelled"
  | "applied"
  | "apply_failed";
export type WhatsappProfessionalPatientResolutionAction =
  | "professional_patient_missing_context"
  | "professional_patient_pending_created"
  | "professional_patient_suggestion_accepted"
  | "professional_patient_suggestion_rejected"
  | "professional_patient_adjustment_requested"
  | "professional_patient_pending_cancelled"
  | "professional_patient_pending_expired"
  | "professional_patient_clarification_needed"
  | "professional_patient_change_applied"
  | "professional_patient_change_failed";

export type WhatsappProfessionalPatientPendingInteraction = {
  id: number;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  patientId: number;
  professionalId: number | null;
  sourceActor: WhatsappProfessionalPatientActor;
  targetActor: WhatsappProfessionalPatientActor;
  kind: WhatsappProfessionalPatientPendingKind;
  sourceIntent: WhatsappIntentName;
  status: WhatsappProfessionalPatientPendingStatus;
  title: string;
  content: string;
  options: Array<{ id: "accept" | "reject" | "adjust" | "review"; label: string }>;
  target: {
    entity: "goal" | "meal_plan" | "meal" | "adjustment" | "information" | "message";
    payload: Record<string, unknown>;
    requiresPatientAcceptance: boolean;
    requiresProfessionalReview: boolean;
    sensitive: boolean;
  };
  decision: {
    decidedAt: string | null;
    actor: WhatsappProfessionalPatientActor | null;
    result: Exclude<WhatsappProfessionalPatientPendingStatus, "pending" | "applied" | "apply_failed"> | null;
    message: string | null;
  };
  application: {
    appliedAt: string | null;
    appliedBy: string | null;
    appliedVersion: string | null;
    success: boolean | null;
    failureReason: string | null;
  };
  audit: Array<{ at: string; action: WhatsappProfessionalPatientResolutionAction; actor: WhatsappProfessionalPatientActor | "system"; detail: string }>;
  flowVersion: typeof WHATSAPP_PROFESSIONAL_PATIENT_FLOW_VERSION;
};

export type WhatsappProfessionalPatientFlowResult = {
  handled: true;
  action: WhatsappProfessionalPatientResolutionAction;
  reply: string;
  pending: WhatsappProfessionalPatientPendingInteraction | null;
  contextUsed: boolean;
  pendingConsumed: boolean;
  nutritionParserAllowed: false;
  dataChanged: boolean;
  audit: {
    flowVersion: typeof WHATSAPP_PROFESSIONAL_PATIENT_FLOW_VERSION;
    pendingId: number | null;
    patientId: number | null;
    professionalId: number | null;
    status: WhatsappProfessionalPatientPendingStatus | "missing_context";
  };
};

type CreatePendingInput = {
  patientId: number;
  professionalId?: number | null;
  sourceActor: WhatsappProfessionalPatientActor;
  targetActor?: WhatsappProfessionalPatientActor;
  kind: WhatsappProfessionalPatientPendingKind;
  sourceIntent: WhatsappIntentName;
  title: string;
  content: string;
  target: WhatsappProfessionalPatientPendingInteraction["target"];
  createdAt?: Date;
  ttlMs?: number;
};

type ResolvePendingInput = {
  patientId: number;
  text?: string | null;
  actor?: WhatsappProfessionalPatientActor;
  receivedAt?: Date;
  pendingId?: number;
};

type ApplyPendingInput = {
  pendingId: number;
  appliedBy: string;
  appliedVersion: string;
  success: boolean;
  failureReason?: string | null;
  appliedAt?: Date;
};

const PROFESSIONAL_PATIENT_RUNTIME_INTENTS = new Set<WhatsappIntentName>([
  "profissional_solicita_informacao",
  "profissional_sugere_meta",
  "profissional_sugere_plano_alimentar",
  "profissional_sugere_refeicao",
  "profissional_sugere_ajuste",
  "paciente_aceita_sugestao",
  "paciente_recusa_sugestao",
  "paciente_pede_ajuste_sugestao",
  "paciente_envia_mensagem_profissional",
  "profissional_envia_mensagem_paciente",
  "confirmar_alteracao_meta",
  "confirmar_alteracao_plano",
  "confirmacao_sim_nao",
]);

const DEFAULT_PENDING_TTL_MS = 48 * 60 * 60 * 1000;
const pendingInteractions: WhatsappProfessionalPatientPendingInteraction[] = [];
let nextPendingId = 1;

function toIso(value?: Date) {
  return (value ?? new Date()).toISOString();
}

function addMs(value: Date, ttlMs: number) {
  return new Date(value.getTime() + ttlMs).toISOString();
}

function normalizeText(value?: string | null) {
  return value
    ?.normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim() ?? "";
}

function isAccept(text: string) {
  return /^(?:s|sim|aceito|aceita|pode|pode sim|ok|confirmo|concordo|vamos|aplicar)$/.test(text);
}

function isReject(text: string) {
  return /^(?:n|nao|negativo|recuso|recusar|nao aceito|nao quero|deixa como esta)$/.test(text);
}

function isAdjust(text: string) {
  return /^(?:ajustar|ajuste|quero ajustar|mudar|alterar|pede ajuste|pedir ajuste|revisar|quero mudar)$/.test(text);
}

function isCancel(text: string) {
  return /^(?:cancelar|cancela|cancela isso|cancelar isso|ignora|deixa pra la)$/.test(text);
}

function isShortProfessionalReply(text: string) {
  return isAccept(text) || isReject(text) || isAdjust(text) || isCancel(text) || /^(?:ok|ta|ta bom|beleza)$/.test(text);
}

function getActivePending(patientId: number, pendingId?: number, receivedAt?: Date) {
  const now = receivedAt?.getTime() ?? Date.now();
  const pending = pendingInteractions.find(item => (
    item.patientId === patientId
    && item.status === "pending"
    && (pendingId === undefined || item.id === pendingId)
  ));
  if (!pending) return null;
  if (new Date(pending.expiresAt).getTime() <= now) {
    updatePending(pending, "expired", "system", "Pendencia expirou antes da resposta do paciente.", receivedAt, "professional_patient_pending_expired");
    return "expired" as const;
  }
  return pending;
}

function audit(
  pending: WhatsappProfessionalPatientPendingInteraction,
  action: WhatsappProfessionalPatientResolutionAction,
  actor: WhatsappProfessionalPatientActor | "system",
  detail: string,
  at: string,
) {
  pending.audit.push({ at, action, actor, detail });
}

function updatePending(
  pending: WhatsappProfessionalPatientPendingInteraction,
  status: WhatsappProfessionalPatientPendingStatus,
  actor: WhatsappProfessionalPatientActor | "system",
  detail: string,
  at?: Date,
  action: WhatsappProfessionalPatientResolutionAction = "professional_patient_clarification_needed",
  message?: string | null,
) {
  const decidedAt = toIso(at);
  pending.status = status;
  pending.updatedAt = decidedAt;
  if (!["applied", "apply_failed"].includes(status)) {
    pending.decision = {
      decidedAt,
      actor: actor === "system" ? "system" : actor,
      result: status as WhatsappProfessionalPatientPendingInteraction["decision"]["result"],
      message: message ?? detail,
    };
  }
  audit(pending, action, actor, detail, decidedAt);
  return pending;
}

function result(input: {
  action: WhatsappProfessionalPatientResolutionAction;
  reply: string;
  pending: WhatsappProfessionalPatientPendingInteraction | null;
  contextUsed: boolean;
  pendingConsumed: boolean;
  dataChanged?: boolean;
  patientId?: number | null;
  professionalId?: number | null;
  status?: WhatsappProfessionalPatientFlowResult["audit"]["status"];
}): WhatsappProfessionalPatientFlowResult {
  return {
    handled: true,
    action: input.action,
    reply: input.reply,
    pending: input.pending,
    contextUsed: input.contextUsed,
    pendingConsumed: input.pendingConsumed,
    nutritionParserAllowed: false,
    dataChanged: input.dataChanged ?? false,
    audit: {
      flowVersion: WHATSAPP_PROFESSIONAL_PATIENT_FLOW_VERSION,
      pendingId: input.pending?.id ?? null,
      patientId: input.patientId ?? input.pending?.patientId ?? null,
      professionalId: input.professionalId ?? input.pending?.professionalId ?? null,
      status: input.status ?? input.pending?.status ?? "missing_context",
    },
  };
}

function defaultOptions(kind: WhatsappProfessionalPatientPendingKind): WhatsappProfessionalPatientPendingInteraction["options"] {
  if (kind === "information_request" || kind === "message") {
    return [
      { id: "review", label: "Responder" },
      { id: "reject", label: "Agora nao" },
    ];
  }
  return [
    { id: "accept", label: "Aceitar" },
    { id: "reject", label: "Recusar" },
    { id: "adjust", label: "Pedir ajuste" },
  ];
}

export function isWhatsappProfessionalPatientIntent(intent: WhatsappIntentName) {
  return PROFESSIONAL_PATIENT_RUNTIME_INTENTS.has(intent);
}

export function shouldBypassWhatsappNutritionParserForProfessionalFlow(intent: WhatsappIntentName) {
  return isWhatsappProfessionalPatientIntent(intent);
}

export function createWhatsappProfessionalPendingInteraction(input: CreatePendingInput): WhatsappProfessionalPatientPendingInteraction {
  const createdAt = input.createdAt ?? new Date();
  const createdAtIso = toIso(createdAt);
  const pending: WhatsappProfessionalPatientPendingInteraction = {
    id: nextPendingId,
    createdAt: createdAtIso,
    updatedAt: createdAtIso,
    expiresAt: addMs(createdAt, input.ttlMs ?? DEFAULT_PENDING_TTL_MS),
    patientId: input.patientId,
    professionalId: input.professionalId ?? null,
    sourceActor: input.sourceActor,
    targetActor: input.targetActor ?? "patient",
    kind: input.kind,
    sourceIntent: input.sourceIntent,
    status: "pending",
    title: input.title,
    content: input.content,
    options: defaultOptions(input.kind),
    target: input.target,
    decision: { decidedAt: null, actor: null, result: null, message: null },
    application: { appliedAt: null, appliedBy: null, appliedVersion: null, success: null, failureReason: null },
    audit: [],
    flowVersion: WHATSAPP_PROFESSIONAL_PATIENT_FLOW_VERSION,
  };
  nextPendingId += 1;
  audit(pending, "professional_patient_pending_created", input.sourceActor, "Pendencia profissional-paciente criada para resposta contextual.", createdAtIso);
  pendingInteractions.push(pending);
  return pending;
}

export function resolveWhatsappProfessionalPendingInteraction(input: ResolvePendingInput): WhatsappProfessionalPatientFlowResult | null {
  const text = normalizeText(input.text);
  if (!text) return null;
  const actor = input.actor ?? "patient";
  const pending = getActivePending(input.patientId, input.pendingId, input.receivedAt);

  if (pending === "expired") {
    return result({
      action: "professional_patient_pending_expired",
      reply: "A sugestao pendente expirou. Peca para o profissional reenviar a orientacao antes de confirmar qualquer mudanca.",
      pending: null,
      contextUsed: false,
      pendingConsumed: false,
      patientId: input.patientId,
      status: "expired",
    });
  }

  if (!pending) {
    if (!isShortProfessionalReply(text)) return null;
    return result({
      action: "professional_patient_missing_context",
      reply: "Nao encontrei uma sugestao profissional pendente para essa resposta. Nenhum alimento, meta ou plano foi alterado.",
      pending: null,
      contextUsed: false,
      pendingConsumed: false,
      patientId: input.patientId,
      status: "missing_context",
    });
  }

  if (actor !== "patient") {
    return result({
      action: "professional_patient_clarification_needed",
      reply: "Essa pendencia precisa de resposta do paciente antes de qualquer alteracao.",
      pending,
      contextUsed: true,
      pendingConsumed: false,
    });
  }

  if (isCancel(text)) {
    updatePending(pending, "cancelled", actor, "Paciente cancelou a pendencia profissional.", input.receivedAt, "professional_patient_pending_cancelled", input.text ?? null);
    return result({
      action: "professional_patient_pending_cancelled",
      reply: "Pendencia cancelada. Nao alterei meta, plano, refeicao ou registros.",
      pending,
      contextUsed: true,
      pendingConsumed: true,
    });
  }

  if (isReject(text)) {
    updatePending(pending, "rejected", actor, "Paciente recusou a sugestao profissional.", input.receivedAt, "professional_patient_suggestion_rejected", input.text ?? null);
    return result({
      action: "professional_patient_suggestion_rejected",
      reply: "Recusa registrada. Nao alterei nenhum dado.",
      pending,
      contextUsed: true,
      pendingConsumed: true,
    });
  }

  if (isAdjust(text)) {
    updatePending(pending, "adjustment_requested", actor, "Paciente pediu ajuste da sugestao profissional.", input.receivedAt, "professional_patient_adjustment_requested", input.text ?? null);
    return result({
      action: "professional_patient_adjustment_requested",
      reply: "Pedido de ajuste registrado para a sugestao profissional. Nao apliquei a mudanca ainda.",
      pending,
      contextUsed: true,
      pendingConsumed: true,
    });
  }

  if (isAccept(text)) {
    updatePending(pending, "accepted", actor, "Paciente aceitou a sugestao profissional pendente.", input.receivedAt, "professional_patient_suggestion_accepted", input.text ?? null);
    return result({
      action: "professional_patient_suggestion_accepted",
      reply: "Aceite registrado. A mudanca ficou pronta para validacao/aplicacao do fluxo autorizado.",
      pending,
      contextUsed: true,
      pendingConsumed: true,
    });
  }

  return result({
    action: "professional_patient_clarification_needed",
    reply: "Tenho uma sugestao profissional pendente. Responda com aceitar, recusar, pedir ajuste ou cancelar.",
    pending,
    contextUsed: true,
    pendingConsumed: false,
  });
}

export function applyWhatsappProfessionalAcceptedInteraction(input: ApplyPendingInput): WhatsappProfessionalPatientFlowResult | null {
  const pending = pendingInteractions.find(item => item.id === input.pendingId) ?? null;
  if (!pending || pending.status !== "accepted") return null;
  const appliedAt = toIso(input.appliedAt);
  pending.status = input.success ? "applied" : "apply_failed";
  pending.updatedAt = appliedAt;
  pending.application = {
    appliedAt,
    appliedBy: input.appliedBy,
    appliedVersion: input.appliedVersion,
    success: input.success,
    failureReason: input.failureReason ?? null,
  };
  audit(
    pending,
    input.success ? "professional_patient_change_applied" : "professional_patient_change_failed",
    "system",
    input.success ? "Mudanca aceita foi aplicada pelo fluxo autorizado." : input.failureReason ?? "Falha ao aplicar mudanca aceita.",
    appliedAt,
  );

  return result({
    action: input.success ? "professional_patient_change_applied" : "professional_patient_change_failed",
    reply: input.success
      ? "Mudanca aplicada com rastreabilidade."
      : "Nao consegui aplicar a mudanca agora; a falha ficou registrada.",
    pending,
    contextUsed: true,
    pendingConsumed: true,
    dataChanged: input.success,
  });
}

export function getWhatsappProfessionalPendingInteraction(id: number) {
  return pendingInteractions.find(item => item.id === id) ?? null;
}

export function listWhatsappProfessionalPendingInteractions(
  filter: Partial<Pick<WhatsappProfessionalPatientPendingInteraction, "patientId" | "professionalId" | "status" | "kind">> = {},
) {
  return pendingInteractions.filter(item => {
    if (filter.patientId !== undefined && item.patientId !== filter.patientId) return false;
    if (filter.professionalId !== undefined && item.professionalId !== filter.professionalId) return false;
    if (filter.status && item.status !== filter.status) return false;
    if (filter.kind && item.kind !== filter.kind) return false;
    return true;
  });
}

export function __resetWhatsappProfessionalPatientFlowForTests() {
  pendingInteractions.length = 0;
  nextPendingId = 1;
}
