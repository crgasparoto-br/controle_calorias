import sharp from "sharp";

const MAX_INPUT_PIXELS = 40_000_000;
const NORMALIZABLE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

type NormalizedImageForAnalysis = {
  buffer: Buffer;
  mimeType: string;
  normalized: boolean;
};

function normalizeMimeType(mimeType: string) {
  return (
    mimeType.split(";", 1)[0]?.trim().toLowerCase() ||
    "application/octet-stream"
  );
}

/**
 * Re-encodes only the analysis copy so EXIF orientation is applied before the
 * vision provider receives the image. The original bytes remain untouched for
 * auditability and media persistence.
 */
export async function normalizeImageForAnalysis(
  buffer: Buffer,
  mimeType: string
): Promise<NormalizedImageForAnalysis> {
  const normalizedMimeType = normalizeMimeType(mimeType);
  if (!NORMALIZABLE_MIME_TYPES.has(normalizedMimeType)) {
    return { buffer, mimeType, normalized: false };
  }

  try {
    const result = await sharp(buffer, {
      failOn: "error",
      limitInputPixels: MAX_INPUT_PIXELS,
    })
      .rotate()
      .toFormat(
        normalizedMimeType === "image/png"
          ? "png"
          : normalizedMimeType === "image/webp"
            ? "webp"
            : "jpeg"
      )
      .toBuffer({ resolveWithObject: true });

    return {
      buffer: result.data,
      mimeType: normalizedMimeType,
      normalized: true,
    };
  } catch {
    // Keep the existing inline path available when a provider returns an
    // unusual but still downloadable image payload. The vision layer remains
    // responsible for rejecting content it cannot parse safely.
    return { buffer, mimeType, normalized: false };
  }
}

export type { NormalizedImageForAnalysis };
