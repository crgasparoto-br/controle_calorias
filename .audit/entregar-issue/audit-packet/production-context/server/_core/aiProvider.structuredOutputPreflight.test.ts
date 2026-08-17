import { describe, expect, it, vi } from "vitest";
import { OpenAiProvider } from "./aiProvider";

const validSchema = {
  type: "object",
  additionalProperties: false,
  required: ["name", "quantity"],
  properties: {
    name: { type: "string" },
    quantity: { anyOf: [{ type: "number", minimum: 0 }, { type: "null" }] },
  },
} as const;

function createProvider() {
  const create = vi.fn().mockResolvedValue({ id: "response-1", output_text: "{}" });
  const provider = new OpenAiProvider({ responses: { create } } as never);
  return { create, provider };
}

describe("OpenAiProvider Structured Outputs preflight", () => {
  it("accepts the documented subset and calls the SDK once", async () => {
    const { create, provider } = createProvider();

    await provider.createTextResponse({
      model: "gpt-4.1-mini",
      input: "extract",
      format: {
        type: "json_schema",
        name: "valid_schema",
        schema: validSchema,
        strict: true,
      },
    });

    expect(create).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      label: "root anyOf",
      schema: { anyOf: [validSchema, validSchema] },
    },
    {
      label: "missing required property",
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["name"],
        properties: { name: { type: "string" }, quantity: { type: "number" } },
      },
    },
    {
      label: "additional properties enabled",
      schema: {
        type: "object",
        additionalProperties: true,
        required: ["name"],
        properties: { name: { type: "string" } },
      },
    },
    {
      label: "unsupported composition",
      schema: {
        type: "object",
        additionalProperties: false,
        required: [],
        properties: {},
        allOf: [validSchema],
      },
    },
  ])("rejects $label before network access", async ({ schema }) => {
    const { create, provider } = createProvider();

    await expect(provider.createTextResponse({
      model: "gpt-4.1-mini",
      input: "extract",
      format: {
        type: "json_schema",
        name: "invalid_schema",
        schema: schema as Record<string, unknown>,
        strict: true,
      },
    })).rejects.toMatchObject({ code: "incompatible_operation" });

    expect(create).not.toHaveBeenCalled();
  });
});
