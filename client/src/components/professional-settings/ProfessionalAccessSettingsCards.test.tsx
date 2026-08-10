// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ProfessionalEntitlementSummaryCard } from "./ProfessionalAccessSettingsCards";

afterEach(cleanup);

describe("ProfessionalEntitlementSummaryCard", () => {
  it("describes suspended access without implying paid professional resources are available", () => {
    render(
      <ProfessionalEntitlementSummaryCard
        entitlements={{
          allowed: true,
          mode: "enforced",
          commercialState: "suspended",
          planName: "Profissional",
          fallbackUsed: false,
          enabledResources: ["professional_settings"],
          capacity: {
            limit: null,
            used: null,
            usageAvailable: false,
          },
        }}
      />
    );

    expect(screen.getByText("Assinatura suspensa")).toBeTruthy();
    expect(
      screen.getByText(
        "Identidade e preferências continuam editáveis; novas ações profissionais permanecem bloqueadas."
      )
    ).toBeTruthy();
    expect(screen.getByText("Configurações profissionais")).toBeTruthy();
  });
});
