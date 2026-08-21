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

  it("keeps ended tracking read-only in messages and history", () => {
    expect(professionalPatientHeaderActionSections("ended", "record")).toEqual([
      "messages",
      "history",
    ]);
    expect(professionalPatientHeaderActionSections("ended", "messages")).toEqual([
      "history",
    ]);
    expect(professionalPatientHeaderActionSections("ended", "history")).toEqual([
      "messages",
    ]);
    expect(
      professionalPatientSectionsForTracking("ended").map(item => item.section)
    ).toEqual(["messages", "history"]);
  });

  it("routes not-started tracking back to the summary before intervention", () => {
    expect(
      professionalPatientHeaderActionSections("not_started", "assessment")
    ).toEqual(["record"]);
  });
});
