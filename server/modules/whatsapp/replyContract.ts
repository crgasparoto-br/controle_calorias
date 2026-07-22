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
 * `replyTransport.ts`. Isso permite migrar formatters e cadeias de intenção
 * (subissues #783-#787) sem acoplar cada uma ao transporte.
 */

export type WhatsAppOutboundMessage =
  | { type: "text"; body: string }
  | { type: "cta_url"; bodyText: string; buttonText: string; url: string }
  | { type: "buttons"; bodyText: string; buttons: WhatsAppReplyButtonSpec[] }
  | { type: "list"; bodyText: string; buttonText: string; sections: WhatsAppReplyListSectionSpec[] }
  | { type: "image_url"; url: string; caption: string }
  | { type: "image_buffer"; buffer: Buffer; mimeType?: string; fileName?: string; caption: string };

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
const MAX_INTERACTIVE_BODY_LENGTH = 1024;
const MAX_LIST_SECTIONS = 10;
const MAX_LIST_ROWS_TOTAL = 10;
const MAX_LIST_SECTION_TITLE_LENGTH = 24;
const MAX_LIST_ROW_TITLE_LENGTH = 24;
const MAX_LIST_ROW_DESCRIPTION_LENGTH = 72;
const MAX_LIST_BUTTON_TEXT_LENGTH = 20;
const MAX_CTA_BUTTON_TEXT_LENGTH = 20;
const MAX_CTA_BODY_LENGTH = 1024;
const MAX_CTA_URL_LENGTH = 2000;

export type WhatsAppReplyValidationError = { field: string; detail: string };

/** Valida restrições do provedor antes do envio, num único lugar (issue #781, ampliada na #859). */
export function validateWhatsAppOutboundMessage(message: WhatsAppOutboundMessage): WhatsAppReplyValidationError[] {
  const errors: WhatsAppReplyValidationError[] = [];

  if (message.type === "buttons") {
    if (!message.bodyText || !message.bodyText.trim()) {
      errors.push({ field: "bodyText", detail: "Mensagem de botões com corpo vazio ou inválido." });
    } else if (message.bodyText.length > MAX_INTERACTIVE_BODY_LENGTH) {
      errors.push({ field: "bodyText", detail: `Corpo da mensagem de botões excede ${MAX_INTERACTIVE_BODY_LENGTH} caracteres.` });
    }
    if (message.buttons.length === 0) {
      errors.push({ field: "buttons", detail: "Mensagem de botões sem nenhum botão." });
    }
    if (message.buttons.length > MAX_INTERACTIVE_BUTTONS) {
      errors.push({ field: "buttons", detail: `Mensagem de botões excede o máximo de ${MAX_INTERACTIVE_BUTTONS} botões suportado pelo provedor.` });
    }
    const seenIds = new Set<string>();
    for (const button of message.buttons) {
      if (!button.id || !button.id.trim()) {
        errors.push({ field: "buttons", detail: "Botão sem identificador de ação." });
      } else if (seenIds.has(button.id)) {
        errors.push({ field: "buttons", detail: `Identificador de botão duplicado: "${button.id}".` });
      } else {
        seenIds.add(button.id);
      }
      if (!button.title || !button.title.trim()) {
        errors.push({ field: "buttons", detail: "Botão com título vazio." });
      } else if (button.title.length > MAX_BUTTON_TITLE_LENGTH) {
        errors.push({ field: "buttons", detail: `Título de botão "${button.title}" excede ${MAX_BUTTON_TITLE_LENGTH} caracteres.` });
      }
    }
  }

  if (message.type === "list") {
    if (!message.bodyText || !message.bodyText.trim()) {
      errors.push({ field: "bodyText", detail: "Mensagem de lista com corpo vazio ou inválido." });
    } else if (message.bodyText.length > MAX_INTERACTIVE_BODY_LENGTH) {
      errors.push({ field: "bodyText", detail: `Corpo da lista excede ${MAX_INTERACTIVE_BODY_LENGTH} caracteres.` });
    }
    if (!message.buttonText || !message.buttonText.trim()) {
      errors.push({ field: "buttonText", detail: "Mensagem de lista sem texto do botão de abertura." });
    } else if (message.buttonText.length > MAX_LIST_BUTTON_TEXT_LENGTH) {
      errors.push({ field: "buttonText", detail: `Texto do botão da lista excede ${MAX_LIST_BUTTON_TEXT_LENGTH} caracteres.` });
    }
    if (message.sections.length === 0) {
      errors.push({ field: "sections", detail: "Mensagem de lista sem nenhuma seção." });
    }
    if (message.sections.length > MAX_LIST_SECTIONS) {
      errors.push({ field: "sections", detail: `Mensagem de lista excede o máximo de ${MAX_LIST_SECTIONS} seções suportado pelo provedor.` });
    }
    const rowCount = message.sections.reduce((total, section) => total + section.rows.length, 0);
    if (rowCount === 0) {
      errors.push({ field: "sections", detail: "Mensagem de lista sem nenhuma opção." });
    }
    if (rowCount > MAX_LIST_ROWS_TOTAL) {
      errors.push({ field: "sections", detail: `Mensagem de lista excede o máximo de ${MAX_LIST_ROWS_TOTAL} linhas suportado pelo provedor.` });
    }
    const seenIds = new Set<string>();
    for (const section of message.sections) {
      if (section.title && section.title.length > MAX_LIST_SECTION_TITLE_LENGTH) {
        errors.push({ field: "sections", detail: `Título de seção excede ${MAX_LIST_SECTION_TITLE_LENGTH} caracteres.` });
      }
      for (const row of section.rows) {
        if (!row.id || !row.id.trim()) {
          errors.push({ field: "sections", detail: "Linha de lista sem identificador de ação." });
        } else if (seenIds.has(row.id)) {
          errors.push({ field: "sections", detail: `Identificador de linha duplicado: "${row.id}".` });
        } else {
          seenIds.add(row.id);
        }
        if (!row.title || !row.title.trim()) {
          errors.push({ field: "sections", detail: "Linha de lista com título vazio." });
        } else if (row.title.length > MAX_LIST_ROW_TITLE_LENGTH) {
          errors.push({ field: "sections", detail: `Título de linha "${row.title}" excede ${MAX_LIST_ROW_TITLE_LENGTH} caracteres.` });
        }
        if (row.description && row.description.length > MAX_LIST_ROW_DESCRIPTION_LENGTH) {
          errors.push({ field: "sections", detail: `Descrição da linha "${row.title}" excede ${MAX_LIST_ROW_DESCRIPTION_LENGTH} caracteres.` });
        }
      }
    }
  }

  if (message.type === "cta_url") {
    if (!message.bodyText || !message.bodyText.trim()) {
      errors.push({ field: "bodyText", detail: "Mensagem de CTA com corpo vazio ou inválido." });
    } else if (message.bodyText.length > MAX_CTA_BODY_LENGTH) {
      errors.push({ field: "bodyText", detail: `Corpo do CTA excede ${MAX_CTA_BODY_LENGTH} caracteres.` });
    }
    if (!message.buttonText || !message.buttonText.trim()) {
      errors.push({ field: "buttonText", detail: "Mensagem de CTA sem texto do botão." });
    } else if (message.buttonText.length > MAX_CTA_BUTTON_TEXT_LENGTH) {
      errors.push({ field: "buttonText", detail: `Texto do botão do CTA excede ${MAX_CTA_BUTTON_TEXT_LENGTH} caracteres.` });
    }
    if (!message.url || !/^https?:\/\//i.test(message.url)) {
      errors.push({ field: "url", detail: "Mensagem de CTA com URL ausente ou inválida." });
    } else if (message.url.length > MAX_CTA_URL_LENGTH) {
      errors.push({ field: "url", detail: `URL do CTA excede ${MAX_CTA_URL_LENGTH} caracteres.` });
    }
  }

  return errors;
}

/**
 * Deriva o fallback textual determinístico da própria mensagem física, sem
 * criar versões paralelas em handlers (issue #859). Retorna `null` quando não
 * há conteúdo seguro suficiente para produzir um fallback confiável (ex.:
 * lista/botões sem nenhuma opção) — nesse caso a falha deve ser efetiva, sem
 * inventar opções.
 *
 * IDs de callback nunca aparecem no texto produzido.
 */
export function buildWhatsAppOutboundFallbackText(message: WhatsAppOutboundMessage): string | null {
  if (message.type === "cta_url") {
    if (
      !message.bodyText?.trim()
      || !message.buttonText?.trim()
      || !/^https?:\/\//i.test(message.url)
      || message.url.length > MAX_CTA_URL_LENGTH
    ) return null;
    return [message.bodyText, "", `${message.buttonText}: ${message.url}`].join("\n");
  }

  if (message.type === "buttons") {
    const usable = message.buttons.filter(button => button.title?.trim());
    if (!message.bodyText?.trim() || usable.length === 0) return null;
    const lines = usable.map((button, index) => `${index + 1}. ${button.title}`);
    return [
      message.bodyText,
      "",
      ...lines,
      "",
      "Responda com o número ou o texto da opção.",
    ].join("\n");
  }

  if (message.type === "list") {
    const rows = message.sections.flatMap(section => section.rows).filter(row => row.title?.trim());
    if (!message.bodyText?.trim() || rows.length === 0) return null;
    const lines = rows.map((row, index) => {
      const label = row.description?.trim() ? `${row.title} — ${row.description}` : row.title;
      return `${index + 1}. ${label}`;
    });
    return [
      message.bodyText,
      "",
      ...lines,
      "",
      "Responda com o número da opção.",
    ].join("\n");
  }

  return null;
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

/** Anexa mídia auxiliar (ex.: imagem anotada) à mesma resposta lógica, sem criar uma segunda execução. */
export function withAuxiliaryImage(
  reply: WhatsAppLogicalReply,
  image: { url: string; caption: string } | { buffer: Buffer; mimeType?: string; fileName?: string; caption: string },
): WhatsAppLogicalReply {
  const message: WhatsAppOutboundMessage = "url" in image
    ? { type: "image_url", url: image.url, caption: image.caption }
    : { type: "image_buffer", buffer: image.buffer, mimeType: image.mimeType, fileName: image.fileName, caption: image.caption };
  return { ...reply, messages: [...reply.messages, message] };
}

/** Sequência ordenada de mensagens de texto pertencentes à mesma resposta lógica (ex.: onboarding em duas mensagens). */
export function sequencedTextReply(bodies: string[], kind: WhatsAppLogicalReplyKind = "functional"): WhatsAppLogicalReply {
  return { kind, messages: bodies.map(body => ({ type: "text", body })) };
}

export function buttonsReply(bodyText: string, buttons: WhatsAppReplyButtonSpec[]): WhatsAppLogicalReply {
  return { kind: "functional", messages: [{ type: "buttons", bodyText, buttons }] };
}

export function listReply(bodyText: string, buttonText: string, sections: WhatsAppReplyListSectionSpec[]): WhatsAppLogicalReply {
  return { kind: "functional", messages: [{ type: "list", bodyText, buttonText, sections }] };
}
