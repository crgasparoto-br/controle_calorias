import { describe, expect, it } from "vitest";
import {
  compareCanonicalProfessionalAccessVersions,
  isProfessionalFollowUpTransitionAllowed,
  resolveCanonicalProfessionalAccessWrite,
  type CanonicalProfessionalAccess,
} from "./professionalRepository";

function access(overrides: Partial<CanonicalProfessionalAccess> = {}): CanonicalProfessionalAccess {
  return {
    id: "access-1",
    professionalUserId: 10,
    patientUserId: 20,
    status: "pending",
    reason: "Acompanhamento",
    requestedAt: 1_780_000_000_000,
    approvedAt: null,
    revokedAt: null,
    rejectedAt: null,
    respondedAt: null,
    responseOrigin: null,
    responseDecision: null,
    authorizationMessageStatus: null,
    authorizationMessageSentAt: null,
    authorizationMessageError: null,
    ...overrides,
  };
}

describe("professional follow-up state machine", () => {
  it.each([
    ["active", "paused"],
    ["paused", "active"],
    ["active", "ended"],
    ["paused", "ended"],
  ] as const)("permite %s -> %s", (from, to) => {
    expect(isProfessionalFollowUpTransitionAllowed(from, to)).toBe(true);
  });

  it("mantém encerramento como estado terminal", () => {
    expect(isProfessionalFollowUpTransitionAllowed("ended", "active")).toBe(false);
    expect(isProfessionalFollowUpTransitionAllowed("ended", "paused")).toBe(false);
  });
});

describe("professional authorization convergence", () => {
  it("prioriza revogação quando cópias legadas têm o mesmo requestedAt", () => {
    const pending = access();
    const revoked = access({ status: "revoked", revokedAt: pending.requestedAt + 100, respondedAt: pending.requestedAt + 100 });

    expect(compareCanonicalProfessionalAccessVersions(revoked, pending)).toBeGreaterThan(0);
    expect(compareCanonicalProfessionalAccessVersions(pending, revoked)).toBeLessThan(0);
  });

  it("não rebaixa vínculo aprovado por conflito de outro ID no par ativo", () => {
    const approved = access({ id: "winner", status: "approved", approvedAt: 1_780_000_001_000, respondedAt: 1_780_000_001_000 });
    const incoming = access({ id: "loser", status: "pending" });

    expect(resolveCanonicalProfessionalAccessWrite({
      incoming,
      existingById: null,
      existingByActivePair: approved,
      origin: "web",
    })).toMatchObject({ access: approved, outcome: "conflict", shouldWrite: false });
  });

  it("promove deterministicamente pending para approved durante migration sem trocar o ID vencedor", () => {
    const pending = access({ id: "winner" });
    const approved = access({ id: "legacy-copy", status: "approved", approvedAt: 1_780_000_001_000, respondedAt: 1_780_000_001_000 });

    const result = resolveCanonicalProfessionalAccessWrite({
      incoming: approved,
      existingById: null,
      existingByActivePair: pending,
      origin: "migration",
    });
    expect(result).toMatchObject({ outcome: "updated", shouldWrite: true });
    expect(result.access).toMatchObject({ id: "winner", status: "approved" });
  });

  it("expõe conflito quando uma decisão concorrente já venceu", () => {
    const approved = access({ status: "approved", approvedAt: 1_780_000_001_000, respondedAt: 1_780_000_001_000 });
    const rejected = access({ status: "rejected", rejectedAt: 1_780_000_002_000, respondedAt: 1_780_000_002_000 });

    expect(resolveCanonicalProfessionalAccessWrite({
      incoming: rejected,
      existingById: approved,
      existingByActivePair: null,
      origin: "whatsapp",
    })).toMatchObject({ access: approved, outcome: "conflict", shouldWrite: false });
  });
});
