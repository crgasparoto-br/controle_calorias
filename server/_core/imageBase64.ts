export type StrictBase64ErrorCode = "empty" | "malformed" | "too_large";

export class StrictBase64Error extends Error {
  constructor(public readonly code: StrictBase64ErrorCode) {
    super(`strict_base64_${code}`);
    this.name = "StrictBase64Error";
  }
}

function decodedByteLength(dataLength: number): number {
  return Math.floor((dataLength * 6) / 8);
}

export function decodeStrictBase64(
  value: string,
  maxBytes: number,
): { compact: string; buffer: Buffer } {
  const compact = value.replace(/\s+/gu, "");
  if (!compact) throw new StrictBase64Error("empty");
  if (!/^[A-Za-z0-9+/]*={0,2}$/u.test(compact)) {
    throw new StrictBase64Error("malformed");
  }

  const paddingLength = compact.endsWith("==") ? 2 : compact.endsWith("=") ? 1 : 0;
  const dataLength = compact.length - paddingLength;
  const remainder = dataLength % 4;
  const expectedPadding = remainder === 0 ? 0 : 4 - remainder;
  if (
    remainder === 1
    || (paddingLength > 0
      && (compact.length % 4 !== 0 || paddingLength !== expectedPadding))
  ) {
    throw new StrictBase64Error("malformed");
  }

  if (decodedByteLength(dataLength) > maxBytes) {
    throw new StrictBase64Error("too_large");
  }

  const padded = compact.padEnd(Math.ceil(compact.length / 4) * 4, "=");
  const buffer = Buffer.from(padded, "base64");
  const canonical = buffer.toString("base64").replace(/=+$/u, "");
  if (!buffer.length || canonical !== compact.replace(/=+$/u, "")) {
    throw new StrictBase64Error("malformed");
  }
  if (buffer.length > maxBytes) {
    throw new StrictBase64Error("too_large");
  }

  return { compact, buffer };
}
