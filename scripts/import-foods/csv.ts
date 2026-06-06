import { readFile } from "node:fs/promises";

export type CsvRow = Record<string, string>;

function parseLine(line: string) {
  const values: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      quoted = !quoted;
      continue;
    }

    if (char === "," && !quoted) {
      values.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current.trim());
  return values;
}

export async function readCsv(filePath: string) {
  const content = await readFile(filePath, "utf8");
  const lines = content.split(/\r?\n/).filter(line => line.trim());
  const headers = parseLine(lines[0] ?? "").map(header => header.trim());

  return lines.slice(1).map(line => {
    const values = parseLine(line);
    return headers.reduce<CsvRow>((row, header, index) => {
      row[header] = values[index] ?? "";
      return row;
    }, {});
  });
}

export function pick(row: CsvRow, candidates: string[]) {
  const keys = Object.keys(row);
  const normalized = new Map(keys.map(key => [key.toLowerCase().replace(/[^a-z0-9]+/g, ""), key]));

  for (const candidate of candidates) {
    const key = normalized.get(candidate.toLowerCase().replace(/[^a-z0-9]+/g, ""));
    if (key) return row[key];
  }

  return "";
}

export function parseNumber(value: string) {
  const normalized = value.replace(/\./g, "").replace(",", ".").replace(/[^0-9.-]/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}
