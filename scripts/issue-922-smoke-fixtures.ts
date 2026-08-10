import { deflateSync } from "node:zlib";

export const SYNTHETIC_BANANA_IMAGE_WIDTH = 320;
export const SYNTHETIC_BANANA_IMAGE_HEIGHT = 180;

export const VISION_SMOKE_PROMPT =
  "Identifique e extraia somente os alimentos visíveis na imagem sintética. Não use suposições fora da imagem.";
export const VISION_EXPECTED_FOOD = "banana";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([length, typeBytes, data, checksum]);
}

function quadraticPoint(t: number) {
  const inverse = 1 - t;
  return {
    x: inverse * inverse * 52 + 2 * inverse * t * 160 + t * t * 278,
    y: inverse * inverse * 118 + 2 * inverse * t * 30 + t * t * 110,
  };
}

function nearestCenterlinePoint(x: number, y: number) {
  let nearest = { distance: Number.POSITIVE_INFINITY, t: 0, x: 0, y: 0 };
  for (let step = 0; step <= 96; step += 1) {
    const t = step / 96;
    const point = quadraticPoint(t);
    const distance = Math.hypot(x - point.x, y - point.y);
    if (distance < nearest.distance) nearest = { distance, t, ...point };
  }
  return nearest;
}

function paintPixel(raw: Buffer, rowOffset: number, x: number, red: number, green: number, blue: number) {
  const offset = rowOffset + 1 + x * 3;
  raw[offset] = red;
  raw[offset + 1] = green;
  raw[offset + 2] = blue;
}

function isInsideCircle(x: number, y: number, centerX: number, centerY: number, radius: number) {
  return Math.hypot(x - centerX, y - centerY) <= radius;
}

export function buildSyntheticBananaPng(): Buffer {
  const width = SYNTHETIC_BANANA_IMAGE_WIDTH;
  const height = SYNTHETIC_BANANA_IMAGE_HEIGHT;
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  const freckles = [
    { x: 108, y: 87, radius: 1.5 },
    { x: 138, y: 74, radius: 1.4 },
    { x: 171, y: 70, radius: 1.6 },
    { x: 204, y: 75, radius: 1.3 },
    { x: 234, y: 87, radius: 1.5 },
  ];

  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * stride;
    raw[rowOffset] = 0;
    for (let x = 0; x < width; x += 1) {
      let color: [number, number, number] = [246, 248, 251];
      const nearest = nearestCenterlinePoint(x, y);
      const taper = 0.58 + 0.42 * Math.sin(Math.PI * nearest.t);
      const bodyRadius = 19 * taper;

      if (nearest.distance <= bodyRadius) {
        const edgeRatio = nearest.distance / bodyRadius;
        if (edgeRatio > 0.88) color = [192, 132, 7];
        else if (y < nearest.y - 4) color = [255, 226, 78];
        else if (y > nearest.y + 7) color = [217, 153, 10];
        else color = [247, 199, 29];
      }

      if (
        isInsideCircle(x, y, 50, 119, 7) ||
        isInsideCircle(x, y, 286, 109, 7) ||
        (x >= 279 && x <= 294 && y >= 103 && y <= 114)
      ) {
        color = [105, 66, 24];
      }

      if (freckles.some((freckle) => isInsideCircle(x, y, freckle.x, freckle.y, freckle.radius))) {
        color = [145, 94, 13];
      }

      paintPixel(raw, rowOffset, x, ...color);
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

export const SYNTHETIC_BANANA_IMAGE =
  `data:image/png;base64,${buildSyntheticBananaPng().toString("base64")}`;
