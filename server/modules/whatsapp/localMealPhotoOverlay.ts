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
};

type SharpFactory = (input: Buffer, options?: Record<string, unknown>) => {
  rotate: () => SharpPipeline;
};

type SharpPipeline = {
  metadata: () => Promise<{ width?: number; height?: number }>;
  composite: (input: Array<{ input: Buffer; top: number; left: number }>) => SharpPipeline;
  png: (options?: Record<string, unknown>) => SharpPipeline;
  toBuffer: () => Promise<Buffer>;
};

type OverlayCard = {
  title: string;
  lines: string[];
};

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
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
}

function buildCards(processed: MealProcessingResult): OverlayCard[] {
  return processed.items.slice(0, 4).map((item) => ({
    title: truncateText(item.foodName, 28),
    lines: [
      `${formatMacro(item.calories)} kcal`,
      `P ${formatMacro(item.protein)}g | C ${formatMacro(item.carbs)}g | G ${formatMacro(item.fat)}g`,
      truncateText(item.portionText, 34),
    ],
  }));
}

function renderCard(card: OverlayCard, index: number, width: number, height: number) {
  const margin = Math.max(24, Math.round(width * 0.035));
  const cardWidth = Math.min(Math.round(width * 0.78), 560);
  const cardHeight = 118;
  const gap = 14;
  const x = margin;
  const y = height - margin - (cardHeight + gap) * (index + 1) + gap;
  const titleSize = Math.max(22, Math.min(34, Math.round(width * 0.035)));
  const bodySize = Math.max(17, Math.min(25, Math.round(width * 0.026)));

  return `
    <g>
      <rect x="${x}" y="${y}" width="${cardWidth}" height="${cardHeight}" rx="18" fill="rgba(6,78,59,0.82)" />
      <rect x="${x + 2}" y="${y + 2}" width="${cardWidth - 4}" height="${cardHeight - 4}" rx="16" fill="rgba(16,185,129,0.18)" stroke="rgba(209,250,229,0.72)" stroke-width="2" />
      <text x="${x + 22}" y="${y + 34}" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="${titleSize}" font-weight="700">${escapeXml(card.title)}</text>
      <text x="${x + 22}" y="${y + 66}" fill="#ecfdf5" font-family="Arial, Helvetica, sans-serif" font-size="${bodySize}" font-weight="700">${escapeXml(card.lines[0])}</text>
      <text x="${x + 22}" y="${y + 91}" fill="#d1fae5" font-family="Arial, Helvetica, sans-serif" font-size="${bodySize}">${escapeXml(card.lines[1])}</text>
      <text x="${x + 22}" y="${y + 112}" fill="#bbf7d0" font-family="Arial, Helvetica, sans-serif" font-size="${Math.max(15, bodySize - 2)}">${escapeXml(card.lines[2])}</text>
    </g>`;
}

function buildOverlaySvg(processed: MealProcessingResult, width: number, height: number) {
  const cards = buildCards(processed);
  const title = escapeXml(processed.detectedMealLabel || "Refeição");
  const total = `Total: ${formatMacro(processed.totals.calories)} kcal | P ${formatMacro(processed.totals.protein)}g | C ${formatMacro(processed.totals.carbs)}g | G ${formatMacro(processed.totals.fat)}g`;
  const titleSize = Math.max(22, Math.min(36, Math.round(width * 0.036)));
  const totalSize = Math.max(17, Math.min(25, Math.round(width * 0.026)));
  const margin = Math.max(24, Math.round(width * 0.035));

  return Buffer.from(`
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="${width}" height="${height}" fill="rgba(0,0,0,0)" />
      <rect x="${margin}" y="${margin}" width="${Math.min(Math.round(width * 0.82), 640)}" height="78" rx="18" fill="rgba(15,23,42,0.62)" />
      <text x="${margin + 22}" y="${margin + 32}" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="${titleSize}" font-weight="700">${title}</text>
      <text x="${margin + 22}" y="${margin + 60}" fill="#d1fae5" font-family="Arial, Helvetica, sans-serif" font-size="${totalSize}">${escapeXml(total)}</text>
      ${cards.map((card, index) => renderCard(card, index, width, height)).join("\n")}
    </svg>`, "utf8");
}

async function loadSharp(): Promise<SharpFactory> {
  const dynamicImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<{ default?: SharpFactory }>;
  const mod = await dynamicImport("sharp");
  if (!mod.default) {
    throw new Error("sharp module did not expose a default export");
  }
  return mod.default;
}

export async function createLocalMealPhotoOverlay(input: LocalMealPhotoOverlayInput): Promise<LocalMealPhotoOverlayResult> {
  const sharp = await loadSharp();
  const sourceBuffer = Buffer.from(input.image.b64Json, "base64");
  const base = sharp(sourceBuffer, { failOn: "none" }).rotate();
  const metadata = await base.metadata();
  const width = metadata.width ?? 1024;
  const height = metadata.height ?? 1024;
  const overlaySvg = buildOverlaySvg(input.processed, width, height);
  const imageBuffer = await base
    .composite([{ input: overlaySvg, top: 0, left: 0 }])
    .png({ compressionLevel: 9 })
    .toBuffer();

  try {
    const storageKey = `generated/meal-support/local-overlay-${Date.now()}.png`;
    const upload = await storagePut(storageKey, imageBuffer, "image/png");
    return {
      url: upload.url,
      storageKey: upload.key || storageKey,
      mimeType: "image/png",
      buffer: imageBuffer,
      detail: "Overlay local aplicado sobre a foto original da refeição.",
    };
  } catch (error) {
    console.warn(
      "[WhatsAppAnnotatedImage] Local overlay image was created but storage upload failed; sending buffer when possible.",
      error instanceof Error ? error.message : error,
    );
    return {
      mimeType: "image/png",
      buffer: imageBuffer,
      detail: error instanceof Error
        ? `Overlay local aplicado sobre a foto original; upload falhou: ${error.message}`
        : "Overlay local aplicado sobre a foto original; upload falhou.",
    };
  }
}
