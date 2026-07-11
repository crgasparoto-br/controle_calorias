import { AsyncLocalStorage } from "node:async_hooks";

type StoredMediaType = "image" | "audio";

type StoredMediaCorrelation = {
  mediaType: StoredMediaType;
  externalMessageId: string;
  consumed?: boolean;
  onStored: (input: { externalMessageId: string; storageKey: string; mimeType: string }) => Promise<void>;
};

const correlationStorage = new AsyncLocalStorage<StoredMediaCorrelation[]>();

export async function withStoragePersistenceCorrelations<T>(
  correlations: StoredMediaCorrelation[],
  operation: () => Promise<T>,
): Promise<T> {
  if (!correlations.length) return operation();
  return correlationStorage.run(correlations, operation);
}

function resolveIncomingMediaType(sourceKey: string): StoredMediaType | null {
  const normalized = sourceKey.toLowerCase();
  if (normalized.startsWith("whatsapp/image/")) return "image";
  if (normalized.startsWith("whatsapp/audio/")) return "audio";
  return null;
}

export async function notifyStorageObjectPersisted(
  sourceKey: string,
  storedKey: string,
  mimeType: string,
): Promise<void> {
  const correlations = correlationStorage.getStore();
  const mediaType = resolveIncomingMediaType(sourceKey);
  if (!mediaType || !correlations?.length) return;

  const match = correlations.find(candidate => candidate.mediaType === mediaType && !candidate.consumed);
  if (!match) return;
  match.consumed = true;

  await match.onStored({
    externalMessageId: match.externalMessageId,
    storageKey: storedKey,
    mimeType,
  });
}
