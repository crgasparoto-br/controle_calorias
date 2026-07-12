/**
 * Resolução central de callbacks de botão/lista do WhatsApp (issue #782, epic #779).
 *
 * Único ponto que valida e consome um clique de botão/lista contra
 * `whatsappPendingOperations`: não existe store paralelo para interações.
 *
 * O ID exposto ao usuário é opaco (assinado por HMAC) e nunca reversível para
 * IDs internos de domínio (userId/mealId/itemId): carrega apenas o ID da
 * pendência e a ação escolhida, e a assinatura impede que um cliente adultere
 * qualquer um dos dois. A pendência em si é a fonte de verdade validada aqui
 * (dono da conversa, estado, expiração); o recurso de domínio referenciado por
 * ela é responsabilidade do resolvedor específico do fluxo (exclusão,
 * confirmação genérica, autorização profissional), que deve revalidá-lo no
 * banco antes de mutar.
 */
import crypto from "node:crypto";
import { requireCookieSecret } from "../../_core/env";
import { getDb, logPersistenceWarning } from "../../db";
import {
  createDrizzleWhatsAppPendingOperationRepository,
  type WhatsAppPendingOperationRecord,
} from "../../repositories/whatsappPendingOperationRepository";

const pendingOperationRepository = createDrizzleWhatsAppPendingOperationRepository({
  getDb,
  onWarning: logPersistenceWarning,
});

function getCallbackSigningSecret() {
  try {
    return requireCookieSecret("whatsapp interactive callbacks");
  } catch {
    // Ambiente local/teste sem JWT_SECRET configurado: o guard de start-up de produção
    // (REQUIRED_PRODUCTION_ENV) já exige JWT_SECRET fora de dev/test, então este
    // segredo fixo nunca é usado em produção real.
    return "whatsapp-interactive-callback-dev-secret";
  }
}

function sign(payload: string) {
  return crypto.createHmac("sha256", getCallbackSigningSecret()).update(payload).digest("base64url").slice(0, 16);
}

/** Constrói um ID de callback opaco vinculado a uma pendência e a uma ação (ex.: "confirm", "cancel", "select:2"). */
export function buildWhatsAppCallbackId(pendingOperationId: number, action: string) {
  const payload = `${pendingOperationId}.${action}`;
  const encoded = Buffer.from(payload, "utf8").toString("base64url");
  return `${encoded}.${sign(payload)}`;
}

export type WhatsAppParsedCallbackId = { pendingOperationId: number; action: string };

export function parseWhatsAppCallbackId(raw: string): WhatsAppParsedCallbackId | null {
  const separatorIndex = raw.lastIndexOf(".");
  if (separatorIndex <= 0) return null;

  const encoded = raw.slice(0, separatorIndex);
  const signature = raw.slice(separatorIndex + 1);
  if (!encoded || !signature) return null;

  let payload: string;
  try {
    payload = Buffer.from(encoded, "base64url").toString("utf8");
  } catch {
    return null;
  }
  if (sign(payload) !== signature) return null;

  const dotIndex = payload.indexOf(".");
  if (dotIndex <= 0) return null;
  const pendingOperationId = Number(payload.slice(0, dotIndex));
  const action = payload.slice(dotIndex + 1);
  if (!Number.isFinite(pendingOperationId) || !action) return null;

  return { pendingOperationId, action };
}

export type WhatsAppInteractiveCallbackClaim =
  | { status: "invalid" }
  | { status: "unavailable" }
  | { status: "claimed"; pendingOperation: WhatsAppPendingOperationRecord; action: string };

/**
 * Valida (dono da conversa, estado ativo, expiração) e consome por
 * compare-and-set a pendência referenciada por um callback de botão/lista.
 * Callback repetido, clique duplo ou reentrega do mesmo inbound resultam em
 * `"unavailable"` na segunda tentativa, pois a primeira já consumiu a versão.
 */
export async function claimWhatsAppInteractiveCallback(
  userId: number,
  rawCallbackId: string,
  now = new Date(),
): Promise<WhatsAppInteractiveCallbackClaim> {
  const parsed = parseWhatsAppCallbackId(rawCallbackId);
  if (!parsed) return { status: "invalid" };

  const pendingOperation = await pendingOperationRepository.getPendingOperationById(parsed.pendingOperationId);
  if (!pendingOperation || pendingOperation.userId !== userId || pendingOperation.state !== "active") {
    return { status: "unavailable" };
  }
  if (new Date(pendingOperation.expiresAt).getTime() < now.getTime()) {
    return { status: "unavailable" };
  }

  const claim = await pendingOperationRepository.claimPendingOperation({
    id: pendingOperation.id,
    expectedVersion: pendingOperation.version,
  });
  if (!claim.claimed) {
    // Corrida de consumo: outro clique/reentrega já consumiu esta versão primeiro.
    return { status: "unavailable" };
  }

  return { status: "claimed", pendingOperation, action: parsed.action };
}
