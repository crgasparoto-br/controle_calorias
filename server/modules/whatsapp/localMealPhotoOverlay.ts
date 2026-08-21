import { createHash } from "node:crypto";
import { decodeStrictBase64, StrictBase64Error } from "../../_core/imageBase64";
import { storagePut } from "../../storage";
import type { MealProcessingResult } from "../../nutritionEngine";
import { getCurrentAiUsageScope } from "../../_core/ai/usageContext";

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
  contentInset: number;
  contentWidth: number;
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

function normalizeText(value: string) {
  return value.replace(/\s+/gu, " ").trim();
}

function glyphWidthFactor(character: string) {
  if (/\s/u.test(character)) return 0.34;
  if (/[ilI1.,:;|'`]/u.test(character)) return 0.32;
  if (/[MW@#%&]/u.test(character)) return 0.9;
  if (/[^\u0000-\u00ff]/u.test(character)) return 0.78;
  return 0.58;
}

function estimateTextWidth(value: string, fontSize: number, fontWeight = 400) {
  const weightFactor = fontWeight >= 700 ? 1.06 : 1;
  return Array.from(value).reduce(
    (total, character) => total + glyphWidthFactor(character) * fontSize * weightFactor,
    0,
  );
}

export function fitTextToWidth(
  value: string,
  maxWidth: number,
  fontSize: number,
  fontWeight = 400,
) {
  const normalized = normalizeText(value);
  if (!normalized || maxWidth <= 0) return "";
  if (estimateTextWidth(normalized, fontSize, fontWeight) <= maxWidth) {
    return normalized;
  }

  const characters = Array.from(normalized);
  const ellipsis = "…";
  if (estimateTextWidth(ellipsis, fontSize, fontWeight) > maxWidth) return "";

  let low = 0;
  let high = characters.length;
  let best = ellipsis;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const prefix = characters.slice(0, middle).join("").trimEnd();
    const candidate = `${prefix}${ellipsis}`;
    if (estimateTextWidth(candidate, fontSize, fontWeight) <= maxWidth) {
      best = candidate;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return best;
}

function decodeSourceImage(image: LocalMealPhotoOverlayInput["image"]): Buffer {
  const mimeType = (image.mimeType || "image/png").trim().toLowerCase();
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new Error("unsupported_image_mime_type");
  }

  try {
    return decodeStrictBase64(image.b64Json, MAX_SOURCE_BYTES).buffer;
  } catch (error) {
    if (error instanceof StrictBase64Error) {
      throw new Error(
        error.code === "too_large" ? "image_too_large" : "invalid_image_base64",
      );
    }
    throw error;
  }
}

function buildCards(
  processed: MealProcessingResult,
  maxCards: number,
  contentWidth: number,
  titleSize: number,
  bodySize: number,
): OverlayCard[] {
  return processed.items.slice(0, maxCards).map((item) => ({
    title: fitTextToWidth(
      item.foodName || "Alimento identificado",
      contentWidth,
      titleSize,
      700,
    ),
    line: fitTextToWidth(
      `${formatMacro(item.calories)} kcal | P ${formatMacro(item.protein)}g | C ${formatMacro(item.carbs)}g | G ${formatMacro(item.fat)}g`,
      contentWidth,
      bodySize,
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
  const titleSize = verySmall
    ? clamp(Math.round(width * 0.065), 10, 16)
    : clamp(Math.round(width * 0.035), 18, 34);
  const bodySize = verySmall
    ? clamp(Math.round(width * 0.047), 8, 12)
    : clamp(Math.round(width * 0.025), 14, 24);
  const contentInset = clamp(Math.round(panelWidth * 0.025), 6, 20);
  const contentWidth = Math.max(1, panelWidth - contentInset * 2);

  return {
    compact,
    margin,
    panelX: margin,
    panelWidth,
    headerY: margin,
    headerHeight,
    cardHeight,
    cardGap,
    cards: buildCards(processed, maxCards, contentWidth, titleSize, bodySize),
    titleSize,
    bodySize,
    contentInset,
    contentWidth,
  };
}

function renderCard(
  card: OverlayCard,
  index: number,
  layout: OverlayLayout,
  height: number,
) {
  const {
    panelX,
    panelWidth,
    margin,
    cardHeight,
    cardGap,
    titleSize,
    bodySize,
    contentInset,
    contentWidth,
  } = layout;
  const y = height - margin - (cardHeight + cardGap) * (index + 1) + cardGap;
  const titleY = y + clamp(Math.round(cardHeight * 0.39), 20, 38);
  const bodyY = y + clamp(Math.round(cardHeight * 0.75), 34, 70);
  const clipId = `card-content-${index}`;

  return `
    <g>
      <clipPath id="${clipId}">
        <rect x="${panelX + contentInset}" y="${y}" width="${contentWidth}" height="${cardHeight}" />
      </clipPath>
      <rect x="${panelX}" y="${y}" width="${panelWidth}" height="${cardHeight}" rx="${layout.compact ? 10 : 16}" fill="rgba(6,78,59,0.84)" />
      <rect x="${panelX + 1}" y="${y + 1}" width="${Math.max(0, panelWidth - 2)}" height="${Math.max(0, cardHeight - 2)}" rx="${layout.compact ? 9 : 15}" fill="none" stroke="rgba(209,250,229,0.78)" stroke-width="2" />
      <g clip-path="url(#${clipId})">
        <text x="${panelX + contentInset}" y="${titleY}" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="${titleSize}" font-weight="700">${escapeXml(card.title)}</text>
        <text x="${panelX + contentInset}" y="${bodyY}" fill="#d1fae5" font-family="Arial, Helvetica, sans-serif" font-size="${bodySize}">${escapeXml(card.line)}</text>
      </g>
    </g>`;
}

export function buildLocalOverlaySvg(
  processed: MealProcessingResult,
  width: number,
  height: number,
) {
  const layout = buildLocalOverlayLayout(processed, width, height);
  const title = fitTextToWidth(
    processed.detectedMealLabel || "Refeição",
    layout.contentWidth,
    layout.titleSize,
    700,
  );
  const total = fitTextToWidth(
    `Total ${formatMacro(processed.totals.calories)} kcal | P ${formatMacro(processed.totals.protein)}g | C ${formatMacro(processed.totals.carbs)}g | G ${formatMacro(processed.totals.fat)}g`,
    layout.contentWidth,
    layout.bodySize,
  );
  const titleY = layout.headerY + clamp(Math.round(layout.headerHeight * 0.42), 18, 42);
  const bodyY = layout.headerY + clamp(Math.round(layout.headerHeight * 0.78), 31, 76);
  const secondaryText = processed.items.length
    ? total
    : fitTextToWidth(
      "Sem itens detalhados para exibir",
      layout.contentWidth,
      layout.bodySize,
    );

  return Buffer.from(`
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <clipPath id="header-content-clip">
        <rect x="${layout.panelX + layout.contentInset}" y="${layout.headerY}" width="${layout.contentWidth}" height="${layout.headerHeight}" />
      </clipPath>
      <rect x="0" y="0" width="${width}" height="${height}" fill="rgba(0,0,0,0)" />
      <rect x="${layout.panelX}" y="${layout.headerY}" width="${layout.panelWidth}" height="${layout.headerHeight}" rx="${layout.compact ? 10 : 16}" fill="rgba(15,23,42,0.72)" />
      <rect x="${layout.panelX + 1}" y="${layout.headerY + 1}" width="${Math.max(0, layout.panelWidth - 2)}" height="${Math.max(0, layout.headerHeight - 2)}" rx="${layout.compact ? 9 : 15}" fill="none" stroke="rgba(226,232,240,0.62)" stroke-width="2" />
      <g clip-path="url(#header-content-clip)">
        <text x="${layout.panelX + layout.contentInset}" y="${titleY}" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="${layout.titleSize}" font-weight="700">${escapeXml(title)}</text>
        <text x="${layout.panelX + layout.contentInset}" y="${bodyY}" fill="#d1fae5" font-family="Arial, Helvetica, sans-serif" font-size="${layout.bodySize}">${escapeXml(secondaryText)}</text>
      </g>
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
  const usage = getCurrentAiUsageScope();
  if (usage?.userId) {
    const { recordDirectProcessingUsage } = await import("../usageGovernance/service");
    await recordDirectProcessingUsage({
      userId: usage.userId,
      idempotencyKey: `local-image:${digest}`,
      operation: "image_processing",
      channel: "local",
      unitType: "pixels",
      unitCount: width * height,
      correlationId: `local-image:${digest}`,
      metadata: { implementation: "sharp_overlay", outputMimeType: "image/png" },
    });
  }
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
