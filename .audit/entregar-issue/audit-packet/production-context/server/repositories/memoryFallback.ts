export function canUseMemoryPersistenceFallback() {
  return process.env.NODE_ENV === "test" || (
    process.env.NODE_ENV !== "production" && process.env.ALLOW_MEMORY_PERSISTENCE === "true"
  );
}
