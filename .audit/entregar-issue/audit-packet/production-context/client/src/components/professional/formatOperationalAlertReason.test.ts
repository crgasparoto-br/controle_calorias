import { describe, expect, it } from "vitest";
import { formatOperationalAlertReason } from "./formatOperationalAlertReason";

describe("formatOperationalAlertReason", () => {
  it("formats ISO date keys using the pt-BR day/month/year order", () => {
    expect(
      formatOperationalAlertReason(
        "Nenhum registro alimentar confirmado entre 2026-07-27 e 2026-07-29 no timezone America/Sao_Paulo."
      )
    ).toBe(
      "Nenhum registro alimentar confirmado entre 27/07/2026 e 29/07/2026 no timezone America/Sao_Paulo."
    );
  });

  it("preserves text that does not contain an ISO date key", () => {
    const reason = "A data de revisão definida para o acompanhamento foi alcançada.";

    expect(formatOperationalAlertReason(reason)).toBe(reason);
  });
});
