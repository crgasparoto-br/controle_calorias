import { TRPCError } from "@trpc/server";
import { describe, expect, it } from "vitest";
import {
  PROFESSIONAL_REQUEST_ACCESS_REJECTED_MESSAGE,
  PROFESSIONAL_REQUEST_ACCESS_UNAVAILABLE_MESSAGE,
  sanitizeProfessionalRequestAccessResult,
} from "./requestAccessPublicBoundary";

function captureTrpcError(run: () => unknown) {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(TRPCError);
    return error as TRPCError;
  }
  throw new Error("Expected a TRPCError");
}

describe("professional request access public boundary", () => {
  it("returns only the authorization status from successful internal results", () => {
    expect(
      sanitizeProfessionalRequestAccessResult({
        ok: true,
        data: {
          id: "access-1",
          patientUserId: 42,
          status: "pending",
          patient: {
            userId: 42,
            name: "Pessoa protegida",
            email: "protected@example.com",
          },
        },
      })
    ).toEqual({ ok: true, data: { status: "pending" } });
  });

  it.each([
    "Nenhuma pessoa foi encontrada com esse e-mail ou celular.",
    "Profissional e pessoa acompanhada precisam ser usuários diferentes.",
  ])("maps expected rejections to the same public error", message => {
    const error = captureTrpcError(() =>
      sanitizeProfessionalRequestAccessResult({
        ok: false,
        error: new Error(message),
      })
    );

    expect(error.code).toBe("BAD_REQUEST");
    expect(error.message).toBe(PROFESSIONAL_REQUEST_ACCESS_REJECTED_MESSAGE);
  });

  it("keeps transient failures distinct without exposing internal details", () => {
    const error = captureTrpcError(() =>
      sanitizeProfessionalRequestAccessResult({
        ok: false,
        error: new Error("Failed query: users"),
      })
    );

    expect(error.code).toBe("SERVICE_UNAVAILABLE");
    expect(error.message).toBe(PROFESSIONAL_REQUEST_ACCESS_UNAVAILABLE_MESSAGE);
  });

  it("rejects malformed successful payloads without returning internal data", () => {
    expect(() =>
      sanitizeProfessionalRequestAccessResult({
        ok: true,
        data: { patient: { email: "protected@example.com" } },
      })
    ).toThrowError(TRPCError);
  });
});
