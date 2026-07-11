import { AsyncLocalStorage } from "node:async_hooks";

type StoredMediaCorrelation = {
  mediaId: string;
  externalMessageId: string;
  onStored: (input: { externalMessageId: string; storageKey: string; mimeType: string }) => Promise<void>;
};

const correlationStorage = new AsyncLocalStorage<StoredMediaCorrelation[]>();

export async function withWhatsAppMediaPersistenceCorrelations<T>(
  correlations: StoredMediaCorrelation[],
  operation: () => Promise<T>,
): Promise<T> {
  if (!correlations.length) return operation();
  return correlationStorage.run(correlations, operation);
}

export async function notifyWhatsAppMediaPersisted(
  sourceKey: string,
  storedKey: string,
  mimeType: string,
): Promise<void> {
  const correlations = correlationStorage.getStore();
  if (!correlations?.length) return;

  const normalizedSourceKey = sourceKey.toLowerCase();
  const match = correlations.find(candidate => normalizedSourceKey.includes(candidate.mediaId.toLowerCase()));
  if (!match) return;

  await match.onStored({
    externalMessageId: match.externalMessageId,
    storageKey: storedKey,
    mimeType,
  });
}
