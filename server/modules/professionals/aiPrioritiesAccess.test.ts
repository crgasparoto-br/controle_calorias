import { describe, expect, it, vi } from "vitest";
import {
  createProfessionalAiPriorityAlertSource,
  createProfessionalPriorityAlertSource,
} from "./aiPrioritiesAccess";

describe("professional priority alert sources", () => {
  it("preserves patient and period filters for contextual AI analysis", async () => {
    const listAlerts = vi.fn().mockResolvedValue([]);
    const source = createProfessionalAiPriorityAlertSource({
      getStatus: vi.fn().mockResolvedValue({ hasActiveProfile: true }) as any,
      listAlerts: listAlerts as any,
    });
    const range = { startDate: "2026-07-01", endDate: "2026-07-07" };

    await source(10, 41, range);

    expect(listAlerts).toHaveBeenCalledWith(10, 41, range);
  });

  it("evaluates and reads the complete alert projection for the global queue", async () => {
    const evaluateAlerts = vi.fn().mockResolvedValue(undefined);
    const listAlerts = vi.fn().mockResolvedValue([]);
    const source = createProfessionalPriorityAlertSource({
      evaluateAlerts: evaluateAlerts as any,
      getStatus: vi.fn().mockResolvedValue({ hasActiveProfile: true }) as any,
      listAlerts: listAlerts as any,
    });

    await source(10);

    expect(evaluateAlerts).toHaveBeenCalledWith(10);
    expect(listAlerts).toHaveBeenCalledWith(10);
  });

  it("blocks both projections when the professional profile is inactive", async () => {
    const listAlerts = vi.fn().mockResolvedValue([]);
    const source = createProfessionalPriorityAlertSource({
      evaluateAlerts: vi.fn() as any,
      getStatus: vi.fn().mockResolvedValue({ hasActiveProfile: false }) as any,
      listAlerts: listAlerts as any,
    });

    await expect(source(10)).rejects.toThrow(
      "A Área Profissional está indisponível para este perfil."
    );
    expect(listAlerts).not.toHaveBeenCalled();
  });
});
