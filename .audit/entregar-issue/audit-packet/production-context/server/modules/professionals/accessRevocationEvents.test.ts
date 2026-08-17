import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  _forTestOnly_clearProfessionalAccessRevocationListeners,
  publishProfessionalAccessRevoked,
  subscribeProfessionalAccessRevocations,
} from "./accessRevocationEvents";

beforeEach(() => {
  _forTestOnly_clearProfessionalAccessRevocationListeners();
});

describe("professional access revocation events", () => {
  it("delivers only to the matching professional and patient", () => {
    const matching = vi.fn();
    const otherPatient = vi.fn();
    const otherProfessional = vi.fn();
    subscribeProfessionalAccessRevocations(7, 41, matching);
    subscribeProfessionalAccessRevocations(7, 72, otherPatient);
    subscribeProfessionalAccessRevocations(8, 41, otherProfessional);

    publishProfessionalAccessRevoked({
      type: "access_revoked",
      professionalUserId: 7,
      patientUserId: 41,
      authorizationId: "authorization-41",
      occurredAt: 123,
    });

    expect(matching).toHaveBeenCalledWith(
      expect.objectContaining({ patientUserId: 41, occurredAt: 123 })
    );
    expect(otherPatient).not.toHaveBeenCalled();
    expect(otherProfessional).not.toHaveBeenCalled();
  });

  it("stops delivery after the stream unsubscribes", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeProfessionalAccessRevocations(7, 41, listener);
    unsubscribe();

    publishProfessionalAccessRevoked({
      type: "access_revoked",
      professionalUserId: 7,
      patientUserId: 41,
      authorizationId: "authorization-41",
      occurredAt: 456,
    });

    expect(listener).not.toHaveBeenCalled();
  });

  it("does not roll back delivery to other streams when one listener fails", () => {
    const delivered = vi.fn();
    subscribeProfessionalAccessRevocations(7, 41, () => {
      throw new Error("closed response");
    });
    subscribeProfessionalAccessRevocations(7, 41, delivered);

    expect(() =>
      publishProfessionalAccessRevoked({
        type: "access_revoked",
        professionalUserId: 7,
        patientUserId: 41,
        authorizationId: "authorization-41",
        occurredAt: 789,
      })
    ).not.toThrow();
    expect(delivered).toHaveBeenCalledTimes(1);
  });
});
