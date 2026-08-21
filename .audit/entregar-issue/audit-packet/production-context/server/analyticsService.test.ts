import { describe, expect, it, vi } from "vitest";
import { AnalyticsService } from "./analyticsService";

describe("AnalyticsService", () => {
  it("sanitizes sensitive properties before sending events", async () => {
    const track = vi.fn();
    const service = new AnalyticsService({ track });

    await service.track("food_searched", {
      query_length: 8,
      limit: 20,
      query: "banana",
    } as never);

    expect(track).toHaveBeenCalledWith({
      name: "food_searched",
      properties: {
        query_length: 8,
        limit: 20,
      },
    });
  });

  it("does not throw when the provider fails", async () => {
    const service = new AnalyticsService({
      track: () => {
        throw new Error("provider unavailable");
      },
    });

    await expect(service.track("meal_created", {
      source: "web",
      meal_label_category: "lunch",
      item_count: 1,
      has_notes: false,
      scheduled_for_future: false,
    })).resolves.toBeUndefined();
  });
});

