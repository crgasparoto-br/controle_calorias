import { deflateSync } from "node:zlib";
import { storagePut } from "server/storage";
import { getAiProvider } from "./aiProvider";
import { ENV } from "./env";
import { isOpenAiConfigured } from "./openaiClient";

export type GenerateImageOptions = {
  prompt: string;
  originalImages?: Array<{
    url?: string;
    b64Json?: string;
    mimeType?: string;
  }>;
};

export type GenerateImageSkipReason =
  | "no_prompt"
  | "not_configured"
  | "provider_failed";

export type GenerateImageResponse = {
  url?: string;
  storageKey?: string;
  mimeType?: string;
  buffer?: Buffer;
  skippedReason?: GenerateImageSkipReason;
  detail?: string;
};

const PNG_WIDTH = 1024;
const PNG_HEIGHT = 1024;
const FONT_SCALE = 3;
const GLYPH_WIDTH = 5;
const GLYPH_HEIGHT = 7;
const CHAR_ADVANCE = GLYPH_WIDTH * FONT_SCALE + 3;
const LINE_HEIGHT = GLYPH_HEIGHT * FONT_SCALE + 12;

const GLYPHS: Record<string, string[]> = {
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "10000", "11110", "00001", "00001", "11110"],
  "6": ["01110", "10000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00001", "01110"],
  "A": ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  "B": ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  "C": ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  "D": ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  "E": ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  "F": ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  "G": ["01111", "10000", "10000", "10011", "10001", "10001", "01111"],
  "H": ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  "I": ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  "J": ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
  "K": ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  "L": ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  "M": ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  "N": ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  "O": ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  "P": ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  "Q": ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  "R": ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  "S": ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  "T": ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  "U": ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  "V": ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  "W": ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
  "X": ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  "Y": ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  "Z": ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  ".": ["00000", "00000", "00000", "00000", "00000", "01100", "01100"],
  ",": ["00000", "00000", "00000", "00000", "01100", "00100", "01000"],
  ":": ["00000", "01100", "01100", "00000", "01100", "01100", "00000"],
  "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
  "/": ["00001", "00010", "00010", "00100", "01000", "01000", "10000"],
  "|": ["00100", "00100", "00100", "00100", "00100", "00100", "00100"],
  "(": ["00010", "00100", "01000", "01000", "01000", "00100", "00010"],
  ")": ["01000", "00100", "00010", "00010", "00010", "00100", "01000"],
  "%": ["11001", "11010", "00010", "00100", "01000", "01011", "10011"],
  "+": ["00000", "00100", "00100", "11111", "00100", "00100", "00000"],
};

let crcTable: number[] | null = null;

function sanitizePrompt(prompt: string) {
  return prompt.trim().slice(0, 4000);
}

function buildPrompt(options: GenerateImageOptions) {
  const prompt = sanitizePrompt(options.prompt);
  if (!prompt) {
    return "";
  }

  if (!options.originalImages?.length) {
    return prompt;
  }

  return [
    prompt,
    "Use a imagem original como base visual principal.",
    "Preserve a foto da refeição sempre que possível e adicione apenas legendas/realces úteis.",
    "Se houver ambiguidades, priorize uma anotação genérica e segura da refeição.",
  ].join("\n\n");
}

function normalizeImageText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9.,:|/()+%\-\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function extractUsefulPromptLines(prompt: string) {
  const rawLines = prompt
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
  const itemIndex = rawLines.findIndex(line => /itens detectados|itens:/i.test(line));
  const totalLine = rawLines.find(line => /^total:/i.test(line));
  const itemLines = (itemIndex >= 0 ? rawLines.slice(itemIndex + 1) : rawLines)
    .filter(line => /^\d+\./.test(line) || line.includes(" kcal") || line.includes("PROT") || line.includes("CARB"))
    .slice(0, 10);

  const lines = [
    "CLASSIFICACAO DOS ALIMENTOS",
    ...(totalLine ? [totalLine] : []),
    ...itemLines,
  ];

  return lines.length > 1 ? lines : ["CLASSIFICACAO DOS ALIMENTOS", "Itens identificados na imagem."];
}

function wrapLine(text: string, maxChars: number) {
  const words = normalizeImageText(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }

  if (current) {
    lines.push(current);
  }

  return lines;
}

function setPixel(buffer: Buffer, width: number, x: number, y: number, color: [number, number, number, number]) {
  if (x < 0 || y < 0 || x >= width || y >= PNG_HEIGHT) return;
  const offset = (y * width + x) * 4;
  buffer[offset] = color[0];
  buffer[offset + 1] = color[1];
  buffer[offset + 2] = color[2];
  buffer[offset + 3] = color[3];
}

function fillRect(buffer: Buffer, width: number, x: number, y: number, w: number, h: number, color: [number, number, number, number]) {
  for (let row = y; row < y + h; row++) {
    for (let col = x; col < x + w; col++) {
      setPixel(buffer, width, col, row, color);
    }
  }
}

function strokeRect(buffer: Buffer, width: number, x: number, y: number, w: number, h: number, color: [number, number, number, number]) {
  fillRect(buffer, width, x, y, w, 2, color);
  fillRect(buffer, width, x, y + h - 2, w, 2, color);
  fillRect(buffer, width, x, y, 2, h, color);
  fillRect(buffer, width, x + w - 2, y, 2, h, color);
}

function drawText(buffer: Buffer, width: number, x: number, y: number, text: string, color: [number, number, number, number], scale = FONT_SCALE) {
  let cursorX = x;
  for (const char of normalizeImageText(text)) {
    const glyph = GLYPHS[char] || GLYPHS[" "];
    for (let row = 0; row < GLYPH_HEIGHT; row++) {
      for (let col = 0; col < GLYPH_WIDTH; col++) {
        if (glyph[row][col] !== "1") continue;
        fillRect(buffer, width, cursorX + col * scale, y + row * scale, scale, scale, color);
      }
    }
    cursorX += GLYPH_WIDTH * scale + Math.max(1, Math.floor(scale / 2));
  }
}

function makeCrcTable() {
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
}

function crc32(buffer: Buffer) {
  crcTable ??= makeCrcTable();
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = (crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function encodePng(width: number, height: number, rgba: Buffer) {
  const scanlineLength = width * 4 + 1;
  const raw = Buffer.alloc(scanlineLength * height);
  for (let y = 0; y < height; y++) {
    raw[y * scanlineLength] = 0;
    rgba.copy(raw, y * scanlineLength + 1, y * width * 4, (y + 1) * width * 4);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function buildFallbackMealSummaryPng(prompt: string) {
  const rgba = Buffer.alloc(PNG_WIDTH * PNG_HEIGHT * 4);
  fillRect(rgba, PNG_WIDTH, 0, 0, PNG_WIDTH, PNG_HEIGHT, [248, 250, 252, 255]);
  fillRect(rgba, PNG_WIDTH, 0, 0, PNG_WIDTH, 120, [6, 78, 59, 255]);
  drawText(rgba, PNG_WIDTH, 48, 44, "CONTROLE DE CALORIAS", [255, 255, 255, 255], 4);
  drawText(rgba, PNG_WIDTH, 48, 92, "ALIMENTOS IDENTIFICADOS", [209, 250, 229, 255], 2);

  const promptLines = extractUsefulPromptLines(prompt);
  const wrappedLines = promptLines.flatMap(line => wrapLine(line, 54)).slice(0, 24);
  let y = 160;
  for (const [index, line] of wrappedLines.entries()) {
    const isTitle = index === 0;
    if (isTitle) {
      drawText(rgba, PNG_WIDTH, 48, y, line, [6, 78, 59, 255], 3);
      y += 54;
      continue;
    }

    fillRect(rgba, PNG_WIDTH, 40, y - 14, 944, LINE_HEIGHT + 16, [236, 253, 245, 255]);
    strokeRect(rgba, PNG_WIDTH, 40, y - 14, 944, LINE_HEIGHT + 16, [187, 247, 208, 255]);
    drawText(rgba, PNG_WIDTH, 64, y, line, [15, 23, 42, 255], 3);
    y += LINE_HEIGHT + 22;
    if (y > PNG_HEIGHT - 80) break;
  }

  drawText(rgba, PNG_WIDTH, 48, PNG_HEIGHT - 54, "Imagem auxiliar gerada automaticamente", [71, 85, 105, 255], 2);
  return encodePng(PNG_WIDTH, PNG_HEIGHT, rgba);
}

async function generateFallbackImage(prompt: string, skippedReason: GenerateImageSkipReason, detail: string): Promise<GenerateImageResponse> {
  const imageBuffer = buildFallbackMealSummaryPng(prompt);
  try {
    const storageKey = `generated/meal-support/fallback-${Date.now()}.png`;
    const upload = await storagePut(storageKey, imageBuffer, "image/png");
    return {
      url: upload.url,
      storageKey: upload.key || storageKey,
      mimeType: "image/png",
      buffer: imageBuffer,
      detail,
    };
  } catch (error) {
    console.warn(
      "[ImageGeneration] Local fallback image was created but storage upload failed; sending buffer when possible.",
      error instanceof Error ? error.message : error,
    );
    return {
      mimeType: "image/png",
      buffer: imageBuffer,
      detail: error instanceof Error ? `${detail} Fallback local falhou: ${error.message}` : detail,
    };
  }
}

/**
 * Auxiliary image generation must never block meal registration or confirmation.
 * When OpenAI image generation is unavailable or fails, this helper returns a
 * local PNG fallback with the detected meal classification whenever storage is available.
 */
export async function generateImage(
  options: GenerateImageOptions,
): Promise<GenerateImageResponse> {
  const prompt = buildPrompt(options);
  if (!prompt) {
    return { skippedReason: "no_prompt" };
  }

  if (!isOpenAiConfigured()) {
    console.warn("[ImageGeneration] OpenAI image generation is not configured; using local fallback image.");
    return generateFallbackImage(prompt, "not_configured", "Provider de imagem não configurado; fallback local de classificação gerado.");
  }

  try {
    const generated = await getAiProvider().createImageGeneration({
      prompt,
      model: ENV.openaiImageModel,
      size: "1024x1024",
      quality: "low",
      outputFormat: "png",
      originalImages: options.originalImages?.filter(image => image.b64Json).map(image => ({
        b64Json: image.b64Json as string,
        mimeType: image.mimeType,
      })),
    });

    const imageBuffer = Buffer.from(generated.b64Json, "base64");
    const storageKey = `generated/meal-support/${Date.now()}.png`;
    const upload = await storagePut(storageKey, imageBuffer, generated.mimeType);

    return {
      url: upload.url,
      storageKey: upload.key || storageKey,
      mimeType: generated.mimeType,
      buffer: imageBuffer,
    };
  } catch (error) {
    console.warn(
      "[ImageGeneration] OpenAI image generation failed; using local fallback image.",
      error instanceof Error ? error.message : error,
    );
    return generateFallbackImage(
      prompt,
      "provider_failed",
      error instanceof Error ? `Provider de imagem falhou: ${error.message}` : "Falha desconhecida no provider de imagem.",
    );
  }
}
