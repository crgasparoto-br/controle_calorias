/**
 * Histórico conversacional efêmero por usuário.
 *
 * Armazena em memória as últimas N trocas (mensagem do usuário + resposta do bot)
 * para enriquecer o contexto enviado ao LLM classificador de intenção.
 *
 * Não há persistência em banco: o histórico existe apenas enquanto o processo
 * estiver em execução e expira automaticamente após o TTL configurado.
 */

export type ConversationTurn = {
  /** Texto enviado pelo usuário */
  userMessage: string;
  /** Texto da resposta enviada pelo bot (pode ser null se não houve resposta textual) */
  botReply: string | null;
  /** Timestamp da troca em milissegundos */
  occurredAtMs: number;
};

type UserHistory = {
  turns: ConversationTurn[];
  lastActivityMs: number;
};

const MAX_TURNS = 3;
const HISTORY_TTL_MS = 30 * 60 * 1000; // 30 minutos de inatividade limpa o histórico

const historyByUser = new Map<number, UserHistory>();

function pruneExpiredHistories(now = Date.now()) {
  for (const [userId, history] of historyByUser) {
    if (now - history.lastActivityMs > HISTORY_TTL_MS) {
      historyByUser.delete(userId);
    }
  }
}

/**
 * Registra uma nova troca no histórico do usuário.
 * Mantém apenas os últimos MAX_TURNS turnos.
 */
export function recordConversationTurn(
  userId: number,
  userMessage: string,
  botReply: string | null,
  occurredAtMs = Date.now(),
): void {
  pruneExpiredHistories(occurredAtMs);

  const existing = historyByUser.get(userId) ?? { turns: [], lastActivityMs: occurredAtMs };
  const turn: ConversationTurn = { userMessage, botReply, occurredAtMs };

  existing.turns = [...existing.turns, turn].slice(-MAX_TURNS);
  existing.lastActivityMs = occurredAtMs;
  historyByUser.set(userId, existing);
}

/**
 * Retorna os turnos recentes do usuário, do mais antigo para o mais recente.
 * Exclui turnos mais antigos que o TTL.
 */
export function getRecentConversationTurns(userId: number, now = Date.now()): ConversationTurn[] {
  pruneExpiredHistories(now);
  const history = historyByUser.get(userId);
  if (!history) return [];
  return history.turns.filter(turn => now - turn.occurredAtMs <= HISTORY_TTL_MS);
}

/** Limpa o histórico de um usuário (útil em testes). */
export function clearConversationHistory(userId: number): void {
  historyByUser.delete(userId);
}

/** Limpa todo o histórico (útil em testes). */
export function __resetConversationHistoryForTests(): void {
  historyByUser.clear();
}
