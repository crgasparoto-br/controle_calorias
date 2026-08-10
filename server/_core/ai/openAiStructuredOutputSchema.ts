import { AiNonRetryableError } from "./policyExecutor";

type JsonSchemaRecord = Record<string, unknown>;

type SchemaStats = {
  propertyCount: number;
  enumValueCount: number;
  totalTrackedStringLength: number;
};

const SUPPORTED_TYPES = new Set([
  "string",
  "number",
  "boolean",
  "integer",
  "object",
  "array",
  "null",
]);

const SUPPORTED_FORMATS = new Set([
  "date-time",
  "time",
  "date",
  "duration",
  "email",
  "hostname",
  "ipv4",
  "ipv6",
  "uuid",
]);

const SUPPORTED_KEYWORDS = new Set([
  "$id",
  "$defs",
  "$ref",
  "$anchor",
  "type",
  "title",
  "description",
  "enum",
  "const",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "anyOf",
  "pattern",
  "format",
  "multipleOf",
  "maximum",
  "exclusiveMaximum",
  "minimum",
  "exclusiveMinimum",
  "minItems",
  "maxItems",
]);

const MAX_OBJECT_PROPERTIES = 5000;
const MAX_NESTING_DEPTH = 10;
const MAX_TRACKED_STRING_LENGTH = 120_000;
const MAX_ENUM_VALUES = 1000;
const LARGE_ENUM_THRESHOLD = 250;
const MAX_LARGE_ENUM_STRING_LENGTH = 15_000;

function incompatible(path: string, reason: string): never {
  throw new AiNonRetryableError(
    `OpenAiProvider: JSON Schema at ${path} ${reason}`,
    undefined,
    "incompatible_operation",
  );
}

function asSchemaRecord(value: unknown, path: string): JsonSchemaRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    incompatible(path, "must be an object.");
  }
  return value as JsonSchemaRecord;
}

function assertNonNegativeInteger(value: unknown, path: string, keyword: string): void {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    incompatible(path, `requires a non-negative integer for ${keyword}.`);
  }
}

function assertFiniteNumber(value: unknown, path: string, keyword: string): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    incompatible(path, `requires a finite number for ${keyword}.`);
  }
}

function assertSchemaType(value: unknown, path: string): void {
  const types = Array.isArray(value) ? value : [value];
  if (
    types.length === 0 ||
    types.some(type => typeof type !== "string" || !SUPPORTED_TYPES.has(type)) ||
    new Set(types).size !== types.length
  ) {
    incompatible(path, "declares an unsupported or duplicated type.");
  }
}

function decodePointerSegment(segment: string, path: string): string {
  try {
    return decodeURIComponent(segment).replace(/~1/g, "/").replace(/~0/g, "~");
  } catch {
    incompatible(path, "contains an invalid JSON Pointer segment.");
  }
}

function assertLocalReference(root: JsonSchemaRecord, ref: string, path: string): void {
  if (ref === "#") return;
  if (!ref.startsWith("#/")) {
    incompatible(path, `uses external or unsupported reference ${ref}.`);
  }

  let current: unknown = root;
  for (const rawSegment of ref.slice(2).split("/")) {
    const segment = decodePointerSegment(rawSegment, path);
    if (
      typeof current !== "object" ||
      current === null ||
      Array.isArray(current) ||
      !(segment in current)
    ) {
      incompatible(path, `references missing target ${ref}.`);
    }
    current = (current as JsonSchemaRecord)[segment];
  }
  asSchemaRecord(current, `${path} -> ${ref}`);
}

function addTrackedString(stats: SchemaStats, value: unknown): void {
  if (typeof value === "string") {
    stats.totalTrackedStringLength += value.length;
  }
}

function assertEnum(value: unknown, path: string, stats: SchemaStats): void {
  if (!Array.isArray(value) || value.length === 0) {
    incompatible(path, "requires a non-empty enum array.");
  }

  const invalidValue = value.some(item =>
    item !== null &&
    typeof item !== "string" &&
    typeof item !== "number" &&
    typeof item !== "boolean");
  if (invalidValue) {
    incompatible(path, "contains an enum value that Structured Outputs cannot represent.");
  }

  stats.enumValueCount += value.length;
  const stringLength = value.reduce(
    (total, item) => total + (typeof item === "string" ? item.length : 0),
    0,
  );
  stats.totalTrackedStringLength += stringLength;

  if (value.length > LARGE_ENUM_THRESHOLD && stringLength > MAX_LARGE_ENUM_STRING_LENGTH) {
    incompatible(path, `exceeds the ${MAX_LARGE_ENUM_STRING_LENGTH}-character limit for a large enum.`);
  }
}

function assertObjectContract(
  schema: JsonSchemaRecord,
  path: string,
  root: JsonSchemaRecord,
  depth: number,
  stats: SchemaStats,
): void {
  const properties = schema.properties === undefined
    ? {}
    : asSchemaRecord(schema.properties, `${path}.properties`);
  const propertyNames = Object.keys(properties);

  if (schema.additionalProperties !== false) {
    incompatible(path, "must set additionalProperties to false for every object.");
  }

  if (!Array.isArray(schema.required) || schema.required.some(item => typeof item !== "string")) {
    incompatible(path, "must declare every object property in required.");
  }
  const required = schema.required as string[];
  if (new Set(required).size !== required.length) {
    incompatible(path, "contains duplicated required property names.");
  }
  if (
    required.length !== propertyNames.length ||
    propertyNames.some(name => !required.includes(name)) ||
    required.some(name => !(name in properties))
  ) {
    incompatible(path, "must include every declared property, and only declared properties, in required.");
  }

  stats.propertyCount += propertyNames.length;
  for (const [name, child] of Object.entries(properties)) {
    stats.totalTrackedStringLength += name.length;
    assertSchema(child, `${path}.properties.${name}`, root, depth + 1, stats);
  }
}

function assertSchema(
  value: unknown,
  path: string,
  root: JsonSchemaRecord,
  depth: number,
  stats: SchemaStats,
): void {
  if (depth > MAX_NESTING_DEPTH) {
    incompatible(path, `exceeds the maximum nesting depth of ${MAX_NESTING_DEPTH}.`);
  }

  const schema = asSchemaRecord(value, path);
  for (const keyword of Object.keys(schema)) {
    if (!SUPPORTED_KEYWORDS.has(keyword)) {
      incompatible(path, `uses unsupported keyword ${keyword}.`);
    }
  }

  if (schema.type !== undefined) assertSchemaType(schema.type, path);
  if (schema.format !== undefined) {
    if (typeof schema.format !== "string" || !SUPPORTED_FORMATS.has(schema.format)) {
      incompatible(path, `uses unsupported string format ${String(schema.format)}.`);
    }
  }
  if (schema.pattern !== undefined && typeof schema.pattern !== "string") {
    incompatible(path, "requires pattern to be a string.");
  }
  if (schema.enum !== undefined) assertEnum(schema.enum, `${path}.enum`, stats);
  if (schema.const !== undefined) addTrackedString(stats, schema.const);

  for (const keyword of [
    "multipleOf",
    "maximum",
    "exclusiveMaximum",
    "minimum",
    "exclusiveMinimum",
  ] as const) {
    if (schema[keyword] !== undefined) assertFiniteNumber(schema[keyword], path, keyword);
  }
  for (const keyword of ["minItems", "maxItems"] as const) {
    if (schema[keyword] !== undefined) assertNonNegativeInteger(schema[keyword], path, keyword);
  }
  if (
    typeof schema.minItems === "number" &&
    typeof schema.maxItems === "number" &&
    schema.minItems > schema.maxItems
  ) {
    incompatible(path, "declares minItems greater than maxItems.");
  }

  if (schema.$ref !== undefined) {
    if (typeof schema.$ref !== "string" || !schema.$ref.trim()) {
      incompatible(path, "requires $ref to be a non-empty string.");
    }
    assertLocalReference(root, schema.$ref, path);
  }

  if (schema.$defs !== undefined) {
    const definitions = asSchemaRecord(schema.$defs, `${path}.$defs`);
    for (const [name, definition] of Object.entries(definitions)) {
      stats.totalTrackedStringLength += name.length;
      assertSchema(definition, `${path}.$defs.${name}`, root, depth + 1, stats);
    }
  }

  const types = new Set(Array.isArray(schema.type) ? schema.type : [schema.type]);
  if (types.has("object") || schema.properties !== undefined || schema.required !== undefined) {
    assertObjectContract(schema, path, root, depth, stats);
  }

  if (schema.items !== undefined) {
    assertSchema(schema.items, `${path}.items`, root, depth + 1, stats);
  }
  if (schema.anyOf !== undefined) {
    if (!Array.isArray(schema.anyOf) || schema.anyOf.length === 0) {
      incompatible(path, "requires anyOf to contain at least one schema.");
    }
    schema.anyOf.forEach((child, index) =>
      assertSchema(child, `${path}.anyOf[${index}]`, root, depth + 1, stats));
  }
}

/**
 * Validates the documented OpenAI Structured Outputs subset before any SDK
 * request is made. This keeps provider incompatibilities non-retryable and
 * prevents an invalid schema from consuming network, quota, or fallback.
 */
export function assertOpenAiStructuredOutputSchema(value: unknown): void {
  const root = asSchemaRecord(value, "$");
  if (root.type !== "object" || root.anyOf !== undefined) {
    incompatible("$", "must be an object and must not use anyOf at the root.");
  }

  const stats: SchemaStats = {
    propertyCount: 0,
    enumValueCount: 0,
    totalTrackedStringLength: 0,
  };
  assertSchema(root, "$", root, 0, stats);

  if (stats.propertyCount > MAX_OBJECT_PROPERTIES) {
    incompatible("$", `exceeds the ${MAX_OBJECT_PROPERTIES}-property limit.`);
  }
  if (stats.enumValueCount > MAX_ENUM_VALUES) {
    incompatible("$", `exceeds the ${MAX_ENUM_VALUES}-enum-value limit.`);
  }
  if (stats.totalTrackedStringLength > MAX_TRACKED_STRING_LENGTH) {
    incompatible("$", `exceeds the ${MAX_TRACKED_STRING_LENGTH}-character schema string limit.`);
  }
}
