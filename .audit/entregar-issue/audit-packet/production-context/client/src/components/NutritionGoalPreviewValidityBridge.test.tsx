// @vitest-environment jsdom
import React from "react";
import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { locationState, observers, queryState } = vi.hoisted(() => ({
  locationState: { value: "/goals" },
  observers: [] as Array<{
    callback: MutationCallback;
    disconnect: ReturnType<typeof vi.fn>;
  }>,
  queryState: {
    data: undefined as unknown,
    isLoading: false,
    isError: false,
    error: null as Error | null,
  },
}));

vi.mock("wouter", () => ({
  useLocation: () => [locationState.value, vi.fn()],
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    nutrition: {
      goals: { get: { useQuery: () => queryState } },
      reports: { periodBundle: { useQuery: () => queryState } },
      dashboard: { today: { useQuery: () => queryState } },
    },
  },
}));

class MutationObserverMock {
  callback: MutationCallback;
  disconnect = vi.fn();
  observe = vi.fn();

  constructor(callback: MutationCallback) {
    this.callback = callback;
    observers.push(this);
  }
}

function renderOriginalPreview() {
  document.body.innerHTML = `
    <input id="goal-start-date" value="2026-07-13" />
    <section data-nutrition-goal-week-preview="true">
      <h3>Prévia da semana</h3>
      ${Array.from(
        { length: 7 },
        (_, index) => `
        <div class="rounded-2xl">
          <p>Dia ${index + 1}</p><span>${String(13 + index).padStart(2, "0")}/07/2026</span>
          <p class="min-h-10">Usa a meta padrão.</p>
          <p>2.200 kcal</p><p>160 g proteína</p><p>240 g carbo</p><p>70 g gordura</p>
        </div>
      `
      ).join("")}
      <p>Total da Semana</p>
    </section>
  `;
  return document.querySelector<HTMLElement>(
    "[data-nutrition-goal-week-preview='true']"
  )!;
}

describe("NutritionGoalPreviewValidityBridge", () => {
  beforeEach(() => {
    observers.length = 0;
    locationState.value = "/goals";
    Object.assign(queryState, {
      data: undefined,
      isLoading: false,
      isError: false,
      error: null,
    });
    vi.stubGlobal("MutationObserver", MutationObserverMock);
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  it("ignora mutações do próprio host e limpa observer, portal e DOM ao desmontar", async () => {
    const originalPreview = renderOriginalPreview();
    const view = render(
      React.createElement(
        (await import("./NutritionGoalPreviewValidityBridge")).default
      )
    );

    await waitFor(() => {
      expect(
        document.querySelectorAll(
          "[data-nutrition-goal-preview-validity-bridge='true']"
        )
      ).toHaveLength(1);
      expect(originalPreview.style.display).toBe("none");
    });

    const observer = observers[0];
    const host = document.querySelector<HTMLElement>(
      "[data-nutrition-goal-preview-validity-bridge='true']"
    )!;
    act(() =>
      observer.callback(
        [{ target: host } as unknown as MutationRecord],
        observer as unknown as MutationObserver
      )
    );

    expect(
      document.querySelectorAll(
        "[data-nutrition-goal-preview-validity-bridge='true']"
      )
    ).toHaveLength(1);

    view.unmount();

    expect(observer.disconnect).toHaveBeenCalledOnce();
    expect(originalPreview.style.display).toBe("");
    expect(
      document.querySelector(
        "[data-nutrition-goal-preview-validity-bridge='true']"
      )
    ).toBeNull();
  });

  it.each([
    [
      "carregamento",
      { data: undefined, isLoading: true, isError: false, error: null },
    ],
    [
      "erro",
      {
        data: undefined,
        isLoading: false,
        isError: true,
        error: new Error("falha controlada"),
      },
    ],
    [
      "sem dados",
      { data: undefined, isLoading: false, isError: false, error: null },
    ],
    [
      "com histórico",
      {
        data: {
          days: Array.from({ length: 7 }, (_, weekday) => ({
            weekday,
            source: "default",
            effectiveFrom: "2026-07-13T00:00:00.000Z",
            calories: 2200,
            proteinGrams: 160,
            carbsGrams: 240,
            fatGrams: 70,
          })),
        },
        isLoading: false,
        isError: false,
        error: null,
      },
    ],
  ])("mantém a integração navegável no estado de %s", async (_label, state) => {
    Object.assign(queryState, state);
    const originalPreview = renderOriginalPreview();
    const view = render(
      React.createElement(
        (await import("./NutritionGoalPreviewValidityBridge")).default
      )
    );

    await waitFor(() =>
      expect(
        document.querySelectorAll(
          "[data-nutrition-goal-preview-validity-bridge='true']"
        )
      ).toHaveLength(1)
    );
    expect(originalPreview.style.display).toBe("none");

    view.unmount();
    expect(originalPreview.style.display).toBe("");
  });
});
