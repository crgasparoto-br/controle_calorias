import { describe, expect, it } from "vitest";
import { redactSensitiveText, redactSensitiveValue, safeLogDetail, summarizeLlmMessagesForAudit } from "./privacy";

describe("privacy redaction", () => {
  it("redacts common personal identifiers and tokens from text", () => {
    const redacted = redactSensitiveText("meu email ana@example.com telefone +55 11 99999-9999 Bearer abc.def.ghi");

    expect(redacted).not.toContain("ana@example.com");
    expect(redacted).not.toContain("99999-9999");
    expect(redacted).not.toContain("abc.def.ghi");
    expect(redacted).toContain("[email_redacted]");
    expect(redacted).toContain("[phone_redacted]");
  });

  it("redacts sensitive object keys before logging", () => {
    const redacted = redactSensitiveValue({
      event: "meal_failed",
      sourceText: "comi arroz e frango",
      nested: {
        email: "ana@example.com",
        safeCount: 2,
      },
    });

    expect(redacted).toEqual({
      event: "meal_failed",
      sourceText: "[redacted]",
      nested: {
        email: "[redacted]",
        safeCount: 2,
      },
    });
  });

  it("summarizes LLM payloads without retaining message text", () => {
    const summary = summarizeLlmMessagesForAudit([
      { role: "user", content: "tenho alergia e meu telefone e +55 11 99999-9999" },
    ]);

    expect(JSON.stringify(summary)).not.toContain("telefone");
    expect(summary[0]?.role).toBe("user");
    expect(summary[0]?.contentKind).toBe("string");
    expect(summary[0]?.contentLength).toBeGreaterThan(0);
  });

  it("keeps persisted log details sanitized", () => {
    const detail = safeLogDetail(new Error("falha com ana@example.com e Bearer secret-token"));

    expect(detail).not.toContain("ana@example.com");
    expect(detail).not.toContain("secret-token");
  });
});
