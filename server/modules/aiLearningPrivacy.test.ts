import { describe, expect, it } from "vitest";

import {
  assertGlobalRuleHasNoIdentifiableData,
  buildAiLearningPrivacyRecord,
  containsDirectIdentifier,
  sanitizeSampleForLearning,
} from "./aiLearningPrivacy";

describe("ai learning privacy", () => {
  it("anonimiza mensagens antes de uso em aprendizado global", () => {
    const sample = sanitizeSampleForLearning({
      kind: "raw_message",
      purpose: "global_learning",
      text: "Meu email ana@example.com, telefone +55 11 99999-9999 e CPF 123.456.789-10",
      origin: "whatsapp",
      createdAt: "2026-06-16T00:00:00.000Z",
    });

    expect(sample.text).not.toContain("ana@example.com");
    expect(sample.text).not.toContain("99999-9999");
    expect(sample.text).not.toContain("123.456.789-10");
    expect(sample.metadata).toEqual(expect.objectContaining({
      purpose: "global_learning",
      rawTextAllowed: false,
      anonymizationRequired: true,
      globalPromotionAllowed: false,
      retentionClass: "global_aggregate",
      expiresAt: null,
      anonymizationApplied: ["direct_identifier_redaction"],
    }));
  });

  it("separa finalidade operacional, auditoria e aprendizado com retencao propria", () => {
    expect(buildAiLearningPrivacyRecord({
      kind: "audit_event",
      purpose: "audit",
      origin: "intent-router",
      createdAt: "2026-06-16T00:00:00.000Z",
    })).toEqual(expect.objectContaining({
      retentionClass: "audit",
      retentionDays: 365,
      rawTextAllowed: true,
      expiresAt: "2027-06-16T00:00:00.000Z",
    }));

    expect(buildAiLearningPrivacyRecord({
      kind: "structured_decision",
      purpose: "individual_learning",
      origin: "whatsapp-feedback",
      createdAt: "2026-06-16T00:00:00.000Z",
    })).toEqual(expect.objectContaining({
      retentionClass: "learning_candidate",
      retentionDays: 180,
      anonymizationRequired: true,
      expiresAt: "2026-12-13T00:00:00.000Z",
    }));
  });

  it("anonimiza transcricoes e conversas reais", () => {
    const transcript = sanitizeSampleForLearning({
      kind: "transcript",
      purpose: "individual_learning",
      text: "Moro na Rua das Flores 123 e comi arroz",
      origin: "audio-transcription",
      createdAt: "2026-06-16T00:00:00.000Z",
    });

    expect(transcript.text).toContain("[address_redacted]");
    expect(transcript.metadata.anonymizationRequired).toBe(true);
  });

  it("bloqueia regra global com dado identificavel", () => {
    const sample = sanitizeSampleForLearning({
      kind: "candidate_rule",
      purpose: "global_learning",
      text: "Quando ana@example.com disser cafe, registrar cafe sem acucar",
      origin: "feedback",
      createdAt: "2026-06-16T00:00:00.000Z",
    });

    expect(() => assertGlobalRuleHasNoIdentifiableData({
      ...sample,
      text: "Regra derivada de ana@example.com",
    })).toThrow("Regra global");
  });

  it("detecta identificadores diretos em payloads estruturados", () => {
    expect(containsDirectIdentifier("contato +55 11 99999-9999")).toBe(true);
    expect(containsDirectIdentifier("registrar arroz e feijao no almoco")).toBe(false);
  });
});