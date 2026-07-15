/**
 * Resolução central de callbacks de botão/lista do WhatsApp (issue #782, epic #779).
 *
 * Único ponto que valida e consome um clique de botão/lista contra
 * `whatsappPendingOperations`: não existe store paralelo para interações.
 *
 * O ID exposto ao usuário é opaco e autenticado com AES-256-GCM. O cliente não
 * consegue recuperar o ID interno da pendência nem a ação escolhida, e qualquer
 * adulteração invalida o callback. A pendência em si continua sendo a fonte de
 * verdade validada aqui (dono da conversa, estado e expiração); o recurso de
 * domínio referenciado por ela é revalidado pelo resolvedor específico do fluxo.
 */
import crypto from "node:crypto";
import { requireCookieSecret } from "../../_core/env";
import { getDb, getUserWhatsappConnection, logPersistenceWarning, normalizeWhatsAppPhoneNumber } from "../../db";
import {
  createDrizzleWhatsAppPendingOperationRepository,
  type WhatsAppPendingOperationRecord,
} from "../../repositories/whatsappPendingOperationRepository";

const pendingOperationRepository = createDrizzleWhatsAppPendingOperationRepository({
  getDb,
  onWarning: logPersistenceWarning,
});

const CALLBACK_VERSION = "v1";
const CALLBACK_IV_BYTES = 12;
const CALLBACK_TAG_BYTES = 16;

function getCallbackSecret() {
  try {
    return requireCookieSecret("whatsapp interactive callbacks");
  } catch {
    // Ambiente local/teste sem JWT_SECRET configurado: o guard de start-up de produção
    // (REQUIRED_PRODUCTION_ENV) já exige JWT_SECRET fora de dev/test, então este
    // segredo fixo nunca é usado em produção real.
    return "whatsapp-interactive-callback-dev-secret";
  }
}

function getCallbackEncryptionKey() {
  return crypto.createHash("sha256").update(getCallbackSecret()).digest();
}

export type WhatsAppParsedCallbackId = { pendingOperationId: number; action: string };

/**
 * Constrói um ID opaco vinculado a uma pendência e a uma ação
 * (ex.: "confirm", "cancel", "select:2").
 *
 * O payload é cifrado com nonce aleatório e autenticado; duas chamadas com os
 * mesmos dados produzem tokens diferentes e nenhum identificador interno fica
 * disponível por simples decodificação do valor enviado à Meta.
 */
export function buildWhatsAppCallbackId(pendingOperationId: number, action: string) {
  const payload = JSON.stringify({ pendingOperationId, action });
  const iv = crypto.randomBytes(CALLBACK_IV_BYTES);
  const cipher = crypto.createCipheriv("aes-256-gcm", getCallbackEncryptionKey(), iv, {
    authTagLength: CALLBACK_TAG_BYTES,
  });
  const encrypted = Buffer.concat([cipher.update(payload, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [CALLBACK_VERSION, iv.toString("base64url"), encrypted.toString("base64url"), tag.toString("base64url")].join(".");
}

export function parseWhatsAppCallbackId(raw: string): WhatsAppParsedCallbackId | null {
  const [version, ivEncoded, encryptedEncoded, tagEncoded, extra] = raw.split(".");
  if (version !== CALLBACK_VERSION || !ivEncoded || !encryptedEncoded || !tagEncoded || extra !== undefined) {
    return null;
  }

  try {
    const iv = Buffer.from(ivEncoded, "base64url");
    const encrypted = Buffer.from(encryptedEncoded, "base64url");
    const tag = Buffer.from(tagEncoded, "base64url");
    if (iv.length !== CALLBACK_IV_BYTES || tag.length !== CALLBACK_TAG_BYTES || encrypted.length === 0) {
      return null;
    }

    const decipher = crypto.createDecipheriv("aes-256-gcm", getCallbackEncryptionKey(), iv, {
      authTagLength: CALLBACK_TAG_BYTES,
    });
    decipher.setAuthTag(tag);
    const payload = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
    const parsed = JSON.parse(payload) as Partial<WhatsAppParsedCallbackId>;
    if (!Number.isSafeInteger(parsed.pendingOperationId) || Number(parsed.pendingOperationId) <= 0) return null;
    if (typeof parsed.action !== "string" || !parsed.action.trim()) return null;
    return { pendingOperationId: Number(parsed.pendingOperationId), action: parsed.action };
  } catch {
    return null;
  }
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
  context?: {
    sourcePhone?: string | null;
    expectedTypes?: readonly string[];
    isExpectedAction?: (type: string, action: string) => boolean;
  },
): Promise<WhatsAppInteractiveCallbackClaim> {
  const parsed = parseWhatsAppCallbackId(rawCallbackId);
  if (!parsed) return { status: "invalid" };

  const pendingOperation = await pendingOperationRepository.getPendingOperationById(parsed.pendingOperationId);
  if (!pendingOperation || pendingOperation.userId !== userId || pendingOperation.state !== "active") {
    return { status: "unavailable" };
  }
  if (context?.expectedTypes && !context.expectedTypes.includes(pendingOperation.type)) {
    return { status: "unavailable" };
  }
  if (context?.isExpectedAction && !context.isExpectedAction(pendingOperation.type, parsed.action)) {
    return { status: "invalid" };
  }
  if (context?.sourcePhone) {
    const connection = await getUserWhatsappConnection(userId);
    const expectedPhone = connection?.phoneNumber ? normalizeWhatsAppPhoneNumber(connection.phoneNumber) : null;
    const sourcePhone = normalizeWhatsAppPhoneNumber(context.sourcePhone);
    if (!expectedPhone || connection?.status !== "active" || expectedPhone !== sourcePhone) {
      return { status: "unavailable" };
    }
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

/**
 * Fallback textual das interações: usa exatamente a mesma pendência persistida,
 * validação de dono/estado/expiração e compare-and-set dos callbacks visuais.
 */
export async function claimWhatsAppTextPendingOperation(
  userId: number,
  expectedType: string,
  action: string,
  now = new Date(),
): Promise<WhatsAppInteractiveCallbackClaim> {
  const pendingOperation = await pendingOperationRepository.getActivePendingOperation(userId, now);
  if (!pendingOperation || pendingOperation.userId !== userId || pendingOperation.type !== expectedType) {
    return { status: "unavailable" };
  }
  if (pendingOperation.state !== "active" || new Date(pendingOperation.expiresAt).getTime() < now.getTime()) {
    return { status: "unavailable" };
  }

  const claim = await pendingOperationRepository.claimPendingOperation({
    id: pendingOperation.id,
    expectedVersion: pendingOperation.version,
  });
  if (!claim.claimed) return { status: "unavailable" };
  return { status: "claimed", pendingOperation, action };
}
