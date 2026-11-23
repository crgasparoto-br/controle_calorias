/** Stable for a single user submission; not a credential or an authorization token. */
export function newFoodOperationSubmissionId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  // Older browser/test environments still need a unique opaque retry key.
  return ["submission", Date.now().toString(36), Math.random().toString(36).slice(2, 14)].join("-");
}
