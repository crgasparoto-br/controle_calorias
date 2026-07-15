/**
 * Guard arquitetural do contrato de respostas do WhatsApp (issue #788, epic #779).
 *
 * Bloqueia, em código executável de produção do servidor, novos caminhos
 * paralelos de resposta: chamadas funcionais diretas à Cloud API, montagem
 * de payload bruto, imports de envio fora do transporte autorizado, rótulos
 * legados de meta em outbound e schemas de IA que aceitem texto final.
 *
 * Testes, fixtures e documentação não são varridos. A allowlist é mínima e
 * cada entrada carrega o motivo; o teste em
 * `server/modules/whatsapp/whatsappResponseArchitecture.test.ts` falha se uma
 * entrada deixar de ser necessária ou perder a justificativa.
 */

export type WhatsAppArchitectureFile = { path: string; content: string };

export type WhatsAppArchitectureRule =
  | "graph-api-call"
  | "cloud-api-payload"
  | "send-import-outside-transport"
  | "legacy-goal-label"
  | "ai-final-text-schema";

export type WhatsAppArchitectureAllowlistEntry = {
  path: string;
  rule: WhatsAppArchitectureRule;
  reason: string;
};

/**
 * Funções de `webhookUtils.ts` que produzem mensagens funcionais outbound.
 * Upload/download de mídia e read receipt ficam de fora: são operações de
 * transporte permitidas pelo contrato da #788.
 */
const FUNCTIONAL_SEND_FUNCTIONS = [
  "sendWhatsAppTextMessage",
  "sendWhatsAppInteractiveUrlButtonMessage",
  "sendWhatsAppInteractiveButtonsMessage",
  "sendWhatsAppInteractiveListMessage",
  "sendWhatsAppImageMessage",
  "sendWhatsAppImageBufferMessage",
] as const;

export const WHATSAPP_RESPONSE_ARCHITECTURE_ALLOWLIST: WhatsAppArchitectureAllowlistEntry[] = [
  {
    path: "server/modules/whatsapp/webhookUtils.ts",
    rule: "graph-api-call",
    reason:
      "Módulo físico de transporte: concentra todas as chamadas HTTP à Cloud API (mensagens, mídia e read receipt).",
  },
  {
    path: "server/modules/whatsapp/webhookUtils.ts",
    rule: "cloud-api-payload",
    reason:
      "Único ponto autorizado a montar payloads `messaging_product` da Cloud API; o restante do servidor usa o contrato lógico.",
  },
  {
    path: "server/modules/whatsapp/replyTransport.ts",
    rule: "send-import-outside-transport",
    reason:
      "Serializador/transporte central da resposta lógica (#781): converte o contrato nas funções físicas de envio.",
  },
  {
    path: "server/modules/whatsapp/processingAcknowledgementDelivery.ts",
    rule: "send-import-outside-transport",
    reason:
      "Adapter único de acknowledgement (#785): mensagem operacional que não é resposta funcional e não grava lifecycle.",
  },
];

function isProductionSource(path: string) {
  if (!path.endsWith(".ts") || path.endsWith(".d.ts")) return false;
  if (/\.(test|spec)\.ts$/.test(path)) return false;
  if (path.includes("__fixtures__")) return false;
  return true;
}

function isAllowed(
  allowlist: WhatsAppArchitectureAllowlistEntry[],
  path: string,
  rule: WhatsAppArchitectureRule,
) {
  return allowlist.some(entry => entry.path === path && entry.rule === rule && entry.reason.trim().length > 0);
}

function findSendImportViolation(content: string): string | null {
  const importPattern = /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*["'][^"']*whatsapp\/webhookUtils["']|import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*["']\.{1,2}\/webhookUtils["']/g;
  for (const match of content.matchAll(importPattern)) {
    const imported = (match[1] ?? match[2] ?? "");
    const names = imported
      .split(",")
      .map(name => name.trim().split(/\s+as\s+/)[0]?.trim())
      .filter(Boolean);
    const offending = names.filter(name =>
      (FUNCTIONAL_SEND_FUNCTIONS as readonly string[]).includes(name as string),
    );
    if (offending.length) return offending.join(", ");
  }
  return null;
}

export function findWhatsAppResponseArchitectureViolationsWithAllowlist(
  files: WhatsAppArchitectureFile[],
  allowlist: WhatsAppArchitectureAllowlistEntry[],
): string[] {
  const violations: string[] = [];

  for (const file of files) {
    if (!isProductionSource(file.path)) continue;
    const { path, content } = file;

    if (content.includes("graph.facebook.com") && !isAllowed(allowlist, path, "graph-api-call")) {
      violations.push(
        `whatsapp response: chamada direta à Cloud API (graph.facebook.com) fora do transporte autorizado: ${path}`,
      );
    }

    if (content.includes("messaging_product") && !isAllowed(allowlist, path, "cloud-api-payload")) {
      violations.push(
        `whatsapp response: montagem de payload bruto da Cloud API (messaging_product) fora do transporte autorizado: ${path}`,
      );
    }

    const offendingImports = findSendImportViolation(content);
    if (offendingImports && !isAllowed(allowlist, path, "send-import-outside-transport")) {
      violations.push(
        `whatsapp response: import de função de envio (${offendingImports}) fora do transporte/adapter autorizado: ${path}`,
      );
    }

    if (/Meta (estimada|ajustada)/.test(content) && !isAllowed(allowlist, path, "legacy-goal-label")) {
      violations.push(
        `whatsapp response: rótulo legado de meta ("Meta estimada"/"Meta ajustada") em código de produção: ${path}`,
      );
    }

    if (
      path.includes("modules/whatsapp") &&
      /\b(finalText|successText|successMessage|finalMessage)\s*:\s*z\./.test(content) &&
      !isAllowed(allowlist, path, "ai-final-text-schema")
    ) {
      violations.push(
        `whatsapp response: schema de ação estruturada aceita texto final produzido pela IA: ${path}`,
      );
    }
  }

  return violations;
}

export function findWhatsAppResponseArchitectureViolations(files: WhatsAppArchitectureFile[]): string[] {
  return findWhatsAppResponseArchitectureViolationsWithAllowlist(
    files,
    WHATSAPP_RESPONSE_ARCHITECTURE_ALLOWLIST,
  );
}
