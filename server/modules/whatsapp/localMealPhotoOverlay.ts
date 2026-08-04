import { createHash } from "node:crypto";
import { storagePut } from "../../storage";
import type { MealProcessingResult } from "../../nutritionEngine";

export type LocalMealPhotoOverlayInput = {
  image: {
    b64Json: string;
    mimeType?: string;
  };
  processed: MealProcessingResult;
};

export type LocalMealPhotoOverlayResult = {
  url?: string;
  storageKey?: string;
  mimeType: "image/png";
  buffer: Buffer;
  detail: string;
  artifactKind: "photo_annotation";
  mode: "local";
  degradation: "none" | "external_to_local";
};

export type LocalMealPhotoOverlayDependencies = {
  storagePutFn?: typeof storagePut;
};

type SharpInfo = { width: number; height: number };
type SharpBufferResult = { data: Buffer; info: SharpInfo };

type SharpPipeline = {
  rotate: () => SharpPipeline;
  composite: (input: Array<{ input: Buffer; top: number; left: number }>) => SharpPipeline;
  png: (options?: Record<string, unknown>) => SharpPipeline;
  toBuffer: {
    (): Promise<Buffer>;
    (options: { resolveWithObject: true }): Promise<SharpBufferResult>;
  };
};

type SharpFactory = (input: Buffer, options?: Record<string, unknown>) => SharpPipeline;

type OverlayCard = {
  title: string;
  line: string;
};

type OverlayLayout = {
  compact: boolean;
  margin: number;
  panelX: number;
  panelWidth: number;
  headerY: number;
  headerHeight: number;
  cardHeight: number;
  cardGap: number;
  cards: OverlayCard[];
  titleSize: number;
  bodySize: number;
};

const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const MAX_INPUT_PIXELS = 40_000_000;
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function formatMacro(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function truncateText(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}

function decodeSourceImage(image: LocalMealPhotoOverlayInput["image"]): Buffer {
  const mimeType = (image.mimeType || "image/png").trim().toLowerCase();
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new Error("unsupported_image_mime_type");
  }

  const compact = image.b64Json.replace(/\s+/gu, "");
  if (!compact || !/^[A-Za-z0-9+/]*={0,2}$/u.test(compact)) {
    throw new Error("invalid_image_base64");
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
    throw new Error("invalid_image_base64");
  }

  const padded = compact.padEnd(Math.ceil(compact.length / 4) * 4, "=");
  const decoded = Buffer.from(padded, "base64");
  const canonical = decoded.toString("base64").replace(/=+$/u, "");
  if (!decoded.length || canonical !== compact.replace(/=+$/u, "")) {
    throw new Error("invalid_image_base64");
  }
  if (decoded.length > MAX_SOURCE_BYTES) throw new Error("image_too_large");
  return decoded;
}

function buildCards(
  processed: MealProcessingResult,
  maxCards: number,
  maxTitleChars: number,
): OverlayCard[] {
  return processed.items.slice(0, maxCards).map((item) => ({
    title: truncateText(item.foodName || "Alimento identificado", maxTitleChars),
    line: truncateText(
      `${formatMacro(item.calories)} kcal | P ${formatMacro(item.protein)}g | C ${formatMacro(item.carbs)}g | G ${formatMacro(item.fat)}g`,
      maxTitleChars + 18,
    ),
  }));
}

export function buildLocalOverlayLayout(
  processed: MealProcessingResult,
  width: number,
  height: number,
): OverlayLayout {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("invalid_image_dimensions");
  }

  const shortestSide = Math.min(width, height);
  const compact = width < 420 || height < 420;
  const verySmall = width < 240 || height < 180;
  const margin = clamp(Math.round(shortestSide * 0.025), 6, 28);
  const panelWidth = Math.max(1, width - margin * 2);
  const headerHeight = verySmall
    ? clamp(Math.round(height * 0.34), 36, 58)
    : compact
      ? clamp(Math.round(height * 0.22), 50, 76)
      : clamp(Math.round(height * 0.13), 72, 104);
  const cardHeight = compact ? clamp(Math.round(height * 0.15), 44, 72) : 94;
  const cardGap = compact ? 7 : 12;
  const availableForCards = Math.max(
    0,
    Math.floor(height * 0.46) - margin - (verySmall ? headerHeight : 0),
  );
  const maxCardsByHeight = verySmall
    ? 0
    : Math.max(0, Math.floor((availableForCards + cardGap) / (cardHeight + cardGap)));
  const maxCards = Math.min(4, maxCardsByHeight);
  const maxTitleChars = clamp(Math.floor(panelWidth / (compact ? 9 : 12)), 12, 38);

  return {
    compact,
    margin,
    panelX: margin,
    panelWidth,
    headerY: margin,
    headerHeight,
    cardHeight,
    cardGap,
    cards: buildCards(processed, maxCards, maxTitleChars),
    titleSize: verySmall
      ? clamp(Math.round(width * 0.065), 12, 18)
      : clamp(Math.round(width * 0.035), 18, 34),
    bodySize: verySmall
      ? clamp(Math.round(width * 0.047), 10, 14)
      : clamp(Math.round(width * 0.025), 14, 24),
  };
}

function renderCard(
  card: OverlayCard,
  index: number,
  layout: OverlayLayout,
  height: number,
) {
  const { panelX, panelWidth, margin, cardHeight, cardGap, titleSize, bodySize } = layout;
  const y = height - margin - (cardHeight + cardGap) * (index + 1) + cardGap;
  const inset = clamp(Math.round(panelWidth * 0.025), 8, 20);
  const titleY = y + clamp(Math.round(cardHeight * 0.39), 20, 38);
  const bodyY = y + clamp(Math.round(cardHeight * 0.75), 34, 70);

  return `
    <g>
      <rect x="${panelX}" y="${y}" width="${panelWidth}" height="${cardHeight}" rx="${layout.compact ? 10 : 16}" fill="rgba(6,78,59,0.84)" />
      <rect x="${panelX + 1}" y="${y + 1}" width="${Math.max(0, panelWidth - 2)}" height="${Math.max(0, cardHeight - 2)}" rx="${layout.compact ? 9 : 15}" fill="none" stroke="rgba(209,250,229,0.78)" stroke-width="2" />
      <text x="${panelX + inset}" y="${titleY}" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="${titleSize}" font-weight="700">${escapeXml(card.title)}</text>
      <text x="${panelX + inset}" y="${bodyY}" fill="#d1fae5" font-family="Arial, Helvetica, sans-serif" font-size="${bodySize}">${escapeXml(card.line)}</text>
    </g>`;
}

export function buildLocalOverlaySvg(
  processed: MealProcessingResult,
  width: number,
  height: number,
) {
  const layout = buildLocalOverlayLayout(processed, width, height);
  const title = truncateText(processed.detectedMealLabel || "Refeição", 36);
  const total = truncateText(
    `Total ${formatMacro(processed.totals.calories)} kcal | P ${formatMacro(processed.totals.protein)}g | C ${formatMacro(processed.totals.carbs)}g | G ${formatMacro(processed.totals.fat)}g`,
    layout.compact ? 54 : 78,
  );
  const inset = clamp(Math.round(layout.panelWidth * 0.025), 8, 20);
  const titleY = layout.headerY + clamp(Math.round(layout.headerHeight * 0.42), 18, 42);
  const bodyY = layout.headerY + clamp(Math.round(layout.headerHeight * 0.78), 31, 76);
  const itemFallback = processed.items.length
    ? ""
    : `<text x="${layout.panelX + inset}" y="${Math.min(height - layout.margin, bodyY + layout.bodySize + 5)}" fill="#bbf7d0" font-family="Arial, Helvetica, sans-serif" font-size="${Math.max(9, layout.bodySize - 2)}">Sem itens detalhados para exibir</text>`;

  return Buffer.from(`
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="${width}" height="${height}" fill="rgba(0,0,0,0)" />
      <rect x="${layout.panelX}" y="${layout.headerY}" width="${layout.panelWidth}" height="${layout.headerHeight}" rx="${layout.compact ? 10 : 16}" fill="rgba(15,23,42,0.72)" />
      <rect x="${layout.panelX + 1}" y="${layout.headerY + 1}" width="${Math.max(0, layout.panelWidth - 2)}" height="${Math.max(0, layout.headerHeight - 2)}" rx="${layout.compact ? 9 : 15}" fill="none" stroke="rgba(226,232,240,0.62)" stroke-width="2" />
      <text x="${layout.panelX + inset}" y="${titleY}" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="${layout.titleSize}" font-weight="700">${escapeXml(title)}</text>
      <text x="${layout.panelX + inset}" y="${bodyY}" fill="#d1fae5" font-family="Arial, Helvetica, sans-serif" font-size="${layout.bodySize}">${escapeXml(total)}</text>
      ${itemFallback}
      ${layout.cards.map((card, index) => renderCard(card, index, layout, height)).join("\n")}
    </svg>`, "utf8");
}

async function loadSharp(): Promise<SharpFactory> {
  const mod = (await import("sharp")) as unknown as { default?: SharpFactory };
  if (!mod.default) throw new Error("sharp_unavailable");
  return mod.default;
}

export async function createLocalMealPhotoOverlay(
  input: LocalMealPhotoOverlayInput,
  dependencies: LocalMealPhotoOverlayDependencies = {},
): Promise<LocalMealPhotoOverlayResult> {
  const sourceBuffer = decodeSourceImage(input.image);
  const originalSnapshot = Buffer.from(sourceBuffer);
  const sharp = await loadSharp();

  const oriented = await sharp(sourceBuffer, {
    failOn: "error",
    limitInputPixels: MAX_INPUT_PIXELS,
  })
    .rotate()
    .png({ compressionLevel: 9 })
    .toBuffer({ resolveWithObject: true });

  const width = oriented.info.width;
  const height = oriented.info.height;
  if (!width || !height || width * height > MAX_INPUT_PIXELS) {
    throw new Error("invalid_image_dimensions");
  }

  const overlaySvg = buildLocalOverlaySvg(input.processed, width, height);
  const imageBuffer = await sharp(oriented.data, {
    failOn: "error",
    limitInputPixels: MAX_INPUT_PIXELS,
  })
    .composite([{ input: overlaySvg, top: 0, left: 0 }])
    .png({ compressionLevel: 9 })
    .toBuffer();

  if (!sourceBuffer.equals(originalSnapshot)) {
    throw new Error("source_image_was_mutated");
  }
  if (!imageBuffer.length || imageBuffer.equals(sourceBuffer)) {
    throw new Error("derived_image_was_not_created");
  }

  const digest = createHash("sha256")
    .update(sourceBuffer)
    .update(overlaySvg)
    .digest("hex")
    .slice(0, 24);
  const storageKey = `generated/meal-annotations/local-${digest}.png`;
  const storagePutFn = dependencies.storagePutFn ?? storagePut;

  try {
    const upload = await storagePutFn(
      storageKey,
      imageBuffer,
      "image/png",
      { publicRead: true },
    );
    return {
      url: upload.url,
      storageKey: upload.key || storageKey,
      mimeType: "image/png",
      buffer: imageBuffer,
      detail: "Overlay local determinístico aplicado sobre uma cópia da foto original.",
      artifactKind: "photo_annotation",
      mode: "local",
      degradation: "none",
    };
  } catch {
    console.warn(
      "[WhatsAppAnnotatedImage] Local annotation was created but storage upload failed.",
      { code: "storage_upload_failed" },
    );
    return {
      mimeType: "image/png",
      buffer: imageBuffer,
      detail: "O overlay local foi criado, mas o upload do arquivo derivado falhou.",
      artifactKind: "photo_annotation",
      mode: "local",
      degradation: "none",
    };
  }
}
