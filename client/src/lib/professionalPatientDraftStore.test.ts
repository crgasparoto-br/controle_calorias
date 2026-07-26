import { beforeEach, describe, expect, it } from "vitest";
import {
  clearAllProfessionalPatientDraftSnapshots,
  clearProfessionalPatientDraftsForAuthorization,
  readProfessionalPatientDraftSnapshot,
  storeProfessionalPatientDraftSnapshot,
} from "./professionalPatientDraftStore";

beforeEach(clearAllProfessionalPatientDraftSnapshots);

describe("professional patient draft store", () => {
  it("isolates the same patient across authorization lifecycles", () => {
    const previousAuthorization = {
      patientId: 41,
      authorizationId: "authorization-previous",
    };
    const renewedAuthorization = {
      patientId: 41,
      authorizationId: "authorization-renewed",
    };

    storeProfessionalPatientDraftSnapshot(previousAuthorization, {
      note: "conteúdo sensível",
    });

    expect(
      readProfessionalPatientDraftSnapshot(previousAuthorization, () => ({
        note: "",
      }))
    ).toEqual({ note: "conteúdo sensível" });
    expect(
      readProfessionalPatientDraftSnapshot(renewedAuthorization, () => ({
        note: "",
      }))
    ).toEqual({ note: "" });
  });

  it("removes every draft associated with a revoked authorization", () => {
    const firstPatient = {
      patientId: 41,
      authorizationId: "authorization-shared",
    };
    const secondPatient = {
      patientId: 42,
      authorizationId: "authorization-shared",
    };
    storeProfessionalPatientDraftSnapshot(firstPatient, { note: "um" });
    storeProfessionalPatientDraftSnapshot(secondPatient, { note: "dois" });

    clearProfessionalPatientDraftsForAuthorization("authorization-shared");

    expect(
      readProfessionalPatientDraftSnapshot(firstPatient, () => ({ note: "" }))
    ).toEqual({ note: "" });
    expect(
      readProfessionalPatientDraftSnapshot(secondPatient, () => ({ note: "" }))
    ).toEqual({ note: "" });
  });

  it("clears drafts from every authorization when the professional session ends", () => {
    const firstAuthorization = {
      patientId: 41,
      authorizationId: "authorization-41",
    };
    const secondAuthorization = {
      patientId: 42,
      authorizationId: "authorization-42",
    };
    storeProfessionalPatientDraftSnapshot(firstAuthorization, { note: "um" });
    storeProfessionalPatientDraftSnapshot(secondAuthorization, { note: "dois" });

    clearAllProfessionalPatientDraftSnapshots();

    expect(
      readProfessionalPatientDraftSnapshot(firstAuthorization, () => ({
        note: "",
      }))
    ).toEqual({ note: "" });
    expect(
      readProfessionalPatientDraftSnapshot(secondAuthorization, () => ({
        note: "",
      }))
    ).toEqual({ note: "" });
  });
});
