/**
 * Contrato central de resposta do WhatsApp (issue #781, epic #779).
 *
 * Separa dados de domínio de payload da Cloud API em dois níveis:
 *
 * - `WhatsAppOutboundMessage`: uma unidade física a ser enviada (texto, CTA,
 *   botões, lista ou imagem).
 * - `WhatsAppLogicalReply`: a sequência ordenada de mensagens físicas que
 *   pertence à mesma ação funcional (ex.: texto final + imagem anotada, ou
 *   onboarding em duas mensagens).
 *
 * Handlers e builders de domínio produzem `WhatsAppLogicalReply` e nunca
 * conhecem o payload bruto da Meta; a serialização/envio vive em
 * `replyTransport.ts`.
 */

export type WhatsAppOutboundMessageRole = "auxiliary";

type WhatsAppOutboundMessageMetadata = {
  /** Mensagens sem papel explícito são primárias pela posição 0; auxiliares são marcadas. */
  role?: WhatsAppOutboundMessageRole;
};

export type WhatsAppOutboundMessage = WhatsAppOutboundMessageMetadata & (
  | { type: "text"; body: string }
  | { type: "cta_url"; bodyText: string; buttonText: string; url: string }
  | { type: "buttons"; bodyText: string; buttons: WhatsAppReplyButtonSpec[] }
  | { type: "list"; bodyText: string; buttonText: string; sections: WhatsAppReplyListSectionSpec[] }
  | { type: "image_url"; url: string; caption: string }
  | { type: "image_id"; mediaId: string; caption: string }
  | { type: "image_buffer"; buffer: Buffer; mimeType?: string; fileName?: string; caption: string }
);

export type WhatsAppReplyButtonSpec = { id: string; title: string };
export type WhatsAppReplyListRowSpec = { id: string; title: string; description?: string };
export type WhatsAppReplyListSectionSpec = { title?: string; rows: WhatsAppReplyListRowSpec[] };

/**
 * Classificação funcional da resposta lógica (issue #780):
 * - `functional`: resolve a mensagem do usuário; gravada uma única vez no lifecycle.
 * - `acknowledgement`: "estou processando"; nunca gravada como resposta funcional.
 */
export type WhatsAppLogicalReplyKind = "functional" | "acknowledgement";

export type WhatsAppLogicalReply = {
  kind: WhatsAppLogicalReplyKind;
  /** Mensagens físicas na ordem de envio. A primeira é a mensagem primária da resposta lógica. */
  messages: WhatsAppOutboundMessage[];
  /** Texto gravado no lifecycle quando a resposta é funcional; por padrão, o texto/corpo da mensagem primária. */
  recordText?: string;
};

const MAX_INTERACTIVE_BUTTONS = 3;
const MAX_BUTTON_TITLE_LENGTH = 20;

export type WhatsAppReplyValidationError = { field: string; detail: string };

/** Valida restrições do provedor antes do envio, num único lugar (issue #781). */
export function validateWhatsAppOutboundMessage(message: WhatsAppOutboundMessage): WhatsAppReplyValidationError[] {
  const errors: WhatsAppReplyValidationError[] = [];

  if (message.type === "buttons") {
    if (message.buttons.length === 0) {
      errors.push({ field: "buttons", detail: "Mensagem de botões sem nenhum botão." });
    }
    if (message.buttons.length > MAX_INTERACTIVE_BUTTONS) {
      errors.push({ field: "buttons", detail: `Mensagem de botões excede o máximo de ${MAX_INTERACTIVE_BUTTONS} botões suportado pelo provedor.` });
    }
    for (const button of message.buttons) {
      if (button.title.length > MAX_BUTTON_TITLE_LENGTH) {
        errors.push({ field: "buttons", detail: `Título de botão "${button.title}" excede ${MAX_BUTTON_TITLE_LENGTH} caracteres.` });
      }
    }
  }

  if (message.type === "list") {
    const rowCount = message.sections.reduce((total, section) => total + section.rows.length, 0);
    if (rowCount === 0) {
      errors.push({ field: "sections", detail: "Mensagem de lista sem nenhuma opção." });
    }
  }

  if (message.type === "image_id" && !message.mediaId.trim()) {
    errors.push({ field: "mediaId", detail: "Mensagem de imagem sem media ID." });
  }

  return errors;
}

function extractPrimaryRecordText(message: WhatsAppOutboundMessage | undefined): string | undefined {
  if (!message) return undefined;
  if (message.type === "text") return message.body;
  if (message.type === "cta_url") return message.bodyText;
  if (message.type === "buttons") return message.bodyText;
  if (message.type === "list") return message.bodyText;
  return undefined;
}

/** Texto a gravar no lifecycle para uma resposta funcional: explícito ou derivado da mensagem primária. */
export function resolveWhatsAppLogicalReplyRecordText(reply: WhatsAppLogicalReply): string | undefined {
  return reply.recordText ?? extractPrimaryRecordText(reply.messages[0]);
}

export function textReply(body: string): WhatsAppLogicalReply {
  return { kind: "functional", messages: [{ type: "text", body }] };
}

export function acknowledgementReply(body: string): WhatsAppLogicalReply {
  return { kind: "acknowledgement", messages: [{ type: "text", body }] };
}

/** Adapta um builder legado (`string`) para a mensagem de texto do contrato central, sem remover o export original. */
export function logicalReplyFromLegacyText(body: string, kind: WhatsAppLogicalReplyKind = "functional"): WhatsAppLogicalReply {
  return { kind, messages: [{ type: "text", body }] };
}

/** Substitui a mensagem primária de texto por um CTA URL (edição rápida, onboarding), preservando a sequência restante. */
export function withCtaUrl(reply: WhatsAppLogicalReply, cta: { buttonText: string; url: string }): WhatsAppLogicalReply {
  const [primary, ...rest] = reply.messages;
  const bodyText = extractPrimaryRecordText(primary) ?? "";
  return {
    ...reply,
    messages: [{ type: "cta_url", bodyText, buttonText: cta.buttonText, url: cta.url }, ...rest],
    recordText: reply.recordText ?? bodyText,
  };
}

export type WhatsAppAuxiliaryImageInput =
  | { url: string; caption: string }
  | { mediaId: string; caption: string }
  | { buffer: Buffer; mimeType?: string; fileName?: string; caption: string };

/** Anexa mídia auxiliar à mesma resposta lógica, sem criar uma segunda execução. */
export function withAuxiliaryImage(reply: WhatsAppLogicalReply, image: WhatsAppAuxiliaryImageInput): WhatsAppLogicalReply {
  const message: WhatsAppOutboundMessage = "url" in image
    ? { type: "image_url", url: image.url, caption: image.caption, role: "auxiliary" }
    : "mediaId" in image
      ? { type: "image_id", mediaId: image.mediaId, caption: image.caption, role: "auxiliary" }
      : { type: "image_buffer", buffer: image.buffer, mimeType: image.mimeType, fileName: image.fileName, caption: image.caption, role: "auxiliary" };
  return { ...reply, messages: [...reply.messages, message] };
}

/** Sequência ordenada de mensagens de texto pertencentes à mesma resposta lógica (ex.: onboarding em duas mensagens). */
export function sequencedTextReply(bodies: string[], kind: WhatsAppLogicalReplyKind = "functional"): WhatsAppLogicalReply {
  return {
    kind,
    messages: bodies.map((body, index) => ({ type: "text", body, ...(index > 0 ? { role: "auxiliary" as const } : {}) })),
  };
}

export function buttonsReply(bodyText: string, buttons: WhatsAppReplyButtonSpec[]): WhatsAppLogicalReply {
  return { kind: "functional", messages: [{ type: "buttons", bodyText, buttons }] };
}

export function listReply(bodyText: string, buttonText: string, sections: WhatsAppReplyListSectionSpec[]): WhatsAppLogicalReply {
  return { kind: "functional", messages: [{ type: "list", bodyText, buttonText, sections }] };
}
