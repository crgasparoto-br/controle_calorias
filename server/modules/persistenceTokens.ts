const SHA256_MUTATION_TOKEN = /^[a-f0-9]{64}$/i;

/** Validate the opaque hexadecimal token shared by persistence CAS operations. */
export function isSha256MutationToken(value: unknown): value is string {
  return typeof value === "string" && SHA256_MUTATION_TOKEN.test(value);
}
