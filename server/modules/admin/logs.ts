import crypto from "node:crypto";
import type { LogsRepository } from "../../repositories/logsRepository";
import { safeLogDetail } from "../../privacy";

export type AdminLogEntry = {
  id: string;
  userId?: number | null;
  origin: "web" | "whatsapp" | "admin";
  status: "success" | "warning" | "error";
  eventType: string;
  detail: string;
  createdAt: number;
};

export type AdminLogInput = Omit<AdminLogEntry, "id" | "createdAt">;

export function createAdminLogsService(deps: { logsRepository: LogsRepository }) {
  const memoryLogs: AdminLogEntry[] = [];

  function listMemoryRecent(limit = 20) {
    return memoryLogs.slice().sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
  }

  async function listPersistedRecent(limit = 20) {
    const rows = await deps.logsRepository.findRecent(limit);
    if (!rows) return null;

    return rows.map(row => ({
      id: String(row.id),
      userId: row.userId ?? undefined,
      origin: row.origin as AdminLogEntry["origin"],
      status: row.status as AdminLogEntry["status"],
      eventType: row.eventType,
      detail: row.detail,
      createdAt: new Date(row.createdAt).getTime(),
    } satisfies AdminLogEntry));
  }

  function log(entry: AdminLogInput) {
    const created: AdminLogEntry = {
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      ...entry,
      detail: safeLogDetail(entry.detail),
    };
    memoryLogs.unshift(created);
    void deps.logsRepository.insert({
      userId: created.userId,
      origin: created.origin,
      status: created.status,
      eventType: created.eventType,
      detail: created.detail,
    });
    return created;
  }

  return {
    log,
    listMemoryRecent,
    listPersistedRecent,
    get memoryCount() {
      return memoryLogs.length;
    },
  };
}
