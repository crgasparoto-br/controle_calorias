import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  buildSyntheticBananaPng,
  SYNTHETIC_BANANA_IMAGE,
  SYNTHETIC_BANANA_IMAGE_HEIGHT,
  SYNTHETIC_BANANA_IMAGE_WIDTH,
  VISION_EXPECTED_FOOD,
  VISION_SMOKE_PROMPT,
} from "../scripts/issue-922-smoke-fixtures";

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

function parsePng(buffer: Buffer) {
  expect(buffer.subarray(0, PNG_SIGNATURE.length)).toEqual(PNG_SIGNATURE);

  let offset = PNG_SIGNATURE.length;
  let width = 0;
  let height = 0;
  let colorType = -1;
  let bitDepth = -1;
  const idatParts: Buffer[] = [];
  const chunkTypes: string[] = [];
  let sawIend = false;

  while (offset < buffer.length) {
    expect(offset + 12).toBeLessThanOrEqual(buffer.length);
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const crcOffset = dataEnd;
    expect(crcOffset + 4).toBeLessThanOrEqual(buffer.length);

    const data = buffer.subarray(dataStart, dataEnd);
    expect(crc32(Buffer.concat([type, data]))).toBe(buffer.readUInt32BE(crcOffset));

    const typeName = type.toString("ascii");
    chunkTypes.push(typeName);
    if (typeName === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (typeName === "IDAT") {
      idatParts.push(data);
    } else if (typeName === "IEND") {
      sawIend = true;
      expect(data.length).toBe(0);
      expect(crcOffset + 4).toBe(buffer.length);
    }

    offset = crcOffset + 4;
  }

  return { width, height, bitDepth, colorType, idat: Buffer.concat(idatParts), sawIend, chunkTypes };
}

describe("issue 922 live-provider smoke fixtures", () => {
  it("keeps the vision prompt independent from the expected answer", () => {
    expect(VISION_SMOKE_PROMPT.toLocaleLowerCase("pt-BR")).not.toContain(VISION_EXPECTED_FOOD);
  });

  it("generates a complete, decodable and non-empty banana PNG", () => {
    const prefix = "data:image/png;base64,";
    expect(SYNTHETIC_BANANA_IMAGE.startsWith(prefix)).toBe(true);
    const fromDataUrl = Buffer.from(SYNTHETIC_BANANA_IMAGE.slice(prefix.length), "base64");
    const generated = buildSyntheticBananaPng();
    expect(fromDataUrl).toEqual(generated);

    const parsed = parsePng(generated);
    expect(parsed.width).toBe(SYNTHETIC_BANANA_IMAGE_WIDTH);
    expect(parsed.height).toBe(SYNTHETIC_BANANA_IMAGE_HEIGHT);
    expect(parsed.bitDepth).toBe(8);
    expect(parsed.colorType).toBe(2);
    expect(parsed.sawIend).toBe(true);
    expect(parsed.idat.length).toBeGreaterThan(0);
    expect(parsed.chunkTypes).not.toEqual(expect.arrayContaining(["tEXt", "zTXt", "iTXt"]));

    const inflated = inflateSync(parsed.idat);
    const stride = SYNTHETIC_BANANA_IMAGE_WIDTH * 3 + 1;
    expect(inflated.length).toBe(stride * SYNTHETIC_BANANA_IMAGE_HEIGHT);

    let yellowPixels = 0;
    let brownPixels = 0;
    let backgroundPixels = 0;
    for (let y = 0; y < SYNTHETIC_BANANA_IMAGE_HEIGHT; y += 1) {
      const rowOffset = y * stride;
      expect(inflated[rowOffset]).toBe(0);
      for (let x = 0; x < SYNTHETIC_BANANA_IMAGE_WIDTH; x += 1) {
        const offset = rowOffset + 1 + x * 3;
        const red = inflated[offset];
        const green = inflated[offset + 1];
        const blue = inflated[offset + 2];
        if (red > 185 && green > 120 && blue < 110) yellowPixels += 1;
        if (red >= 70 && red <= 160 && green < 120 && blue < 80) brownPixels += 1;
        if (red > 235 && green > 235 && blue > 235) backgroundPixels += 1;
      }
    }

    expect(yellowPixels).toBeGreaterThan(4_000);
    expect(brownPixels).toBeGreaterThan(40);
    expect(backgroundPixels).toBeGreaterThan(40_000);
  });
});
