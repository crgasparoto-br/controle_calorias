import { describe, expect, it } from "vitest";
import {
  professionalPatientHeaderActionSections,
  professionalPatientSectionsForTracking,
} from "./ProfessionalPatientWorkspace";

describe("workspace patient header actions", () => {
  it("offers active clinical shortcuts without repeating the current section", () => {
    expect(professionalPatientHeaderActionSections("active", "record")).toEqual(
      ["assessment", "goals", "guidance"]
    );
    expect(professionalPatientHeaderActionSections("active", "goals")).toEqual([
      "assessment",
      "guidance",
    ]);
  });

  it("limits paused tracking to administrative messaging and history", () => {
    expect(professionalPatientHeaderActionSections("paused", "record")).toEqual(
      ["messages", "history"]
    );
  });

  it("keeps ended tracking restricted to history", () => {
    expect(professionalPatientHeaderActionSections("ended", "record")).toEqual([
      "history",
    ]);
    expect(professionalPatientHeaderActionSections("ended", "history")).toEqual(
      []
    );
    expect(
      professionalPatientSectionsForTracking("ended").map(item => item.section)
    ).toEqual(["history"]);
  });

  it("routes not-started tracking back to the summary before intervention", () => {
    expect(
      professionalPatientHeaderActionSections("not_started", "assessment")
    ).toEqual(["record"]);
  });
});
