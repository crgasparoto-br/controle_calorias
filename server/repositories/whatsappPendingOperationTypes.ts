import { whatsappPendingOperations } from "../../drizzle/schema";

export type DbProvider = () => Promise<any | null>;
export type PersistenceWarningHandler = (scope: string, error: unknown) => void;

export type RepositoryDependencies = {
  getDb: DbProvider;
  onWarning: PersistenceWarningHandler;
};

export type PersistenceMode =
  | { kind: "database"; db: any }
  | { kind: "memory" }
  | { kind: "unavailable" };

export type WhatsAppPendingOperationRecord =
  typeof whatsappPendingOperations.$inferSelect;

export type WhatsAppPendingOperationState =
  | "active"
  | "processing"
  | "consumed"
  | "cancelled"
  | "expired"
  | "superseded"
  | "review_required";

export type PendingOperationDispatchStatus =
  | "ready"
  | "processing"
  | "review_required"
  | "terminal";

export function getPendingOperationDispatchStatus(
  state: WhatsAppPendingOperationState | string
): PendingOperationDispatchStatus {
  if (state === "active") return "ready";
  if (state === "processing") return "processing";
  if (state === "review_required") return "review_required";
  return "terminal";
}

export const PENDING_OPERATION_PROCESSING_LEASE_MS = 5 * 60 * 1000;

export type CreatePendingOperationInput = {
  userId: number;
  type: string;
  target: unknown;
  dedupeKey?: string | null;
  origin: string;
  ttlMs: number;
  now?: Date;
};

export type ClaimPendingOperationInput = {
  id: number;
  expectedVersion: number;
  now?: Date;
};

export type ProcessPendingOperationInput = ClaimPendingOperationInput & {
  now?: Date;
  leaseMs?: number;
};

export type WhatsAppPendingOperationRepository = {
  createPendingOperation(
    input: CreatePendingOperationInput
  ): Promise<WhatsAppPendingOperationRecord | null>;
  getActivePendingOperation(
    userId: number,
    now?: Date
  ): Promise<WhatsAppPendingOperationRecord | null>;
  getActivePendingOperationByType?(
    userId: number,
    type: string,
    now?: Date
  ): Promise<WhatsAppPendingOperationRecord | null>;
  listActivePendingOperationsByType?(
    userId: number,
    type: string,
    now?: Date
  ): Promise<WhatsAppPendingOperationRecord[]>;
  getLatestPendingOperation(
    userId: number,
    now?: Date
  ): Promise<WhatsAppPendingOperationRecord | null>;
  /** Busca pelo ID exato (issue #782): valida que um callback de botão/lista aponta para a pendência específica mostrada ao usuário, não apenas "a mais recente ativa". */
  getPendingOperationById(
    id: number,
    now?: Date
  ): Promise<WhatsAppPendingOperationRecord | null>;
  claimPendingOperation(
    input: ClaimPendingOperationInput
  ): Promise<{ claimed: boolean }>;
  beginPendingOperationProcessing(
    input: ProcessPendingOperationInput
  ): Promise<{ claimed: boolean; version?: number }>;
  completePendingOperationProcessing(
    input: ClaimPendingOperationInput & { now?: Date }
  ): Promise<{ completed: boolean }>;
  releasePendingOperationProcessing(
    input: ClaimPendingOperationInput & { now?: Date }
  ): Promise<{ released: boolean }>;
  requirePendingOperationVerification(
    input: ClaimPendingOperationInput & { now?: Date }
  ): Promise<{ required: boolean }>;
  cancelPendingOperation(
    id: number,
    now?: Date
  ): Promise<{ cancelled: boolean }>;
  supersedePendingOperation(
    id: number,
    now?: Date
  ): Promise<{ superseded: boolean }>;
  /** Retenção (issue #767): apaga pendências não ativas (consumidas/canceladas/expiradas/substituídas) além de `operationalDays`. */
  purgeInactiveOperations(operationalDays: number, now?: Date): Promise<number>;
};
