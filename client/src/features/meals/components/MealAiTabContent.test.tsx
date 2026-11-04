// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MealAiTabContent } from "./MealAiTabContent";

afterEach(cleanup);

function props() {
  return {
    description: "",
    onDescriptionChange: vi.fn(),
    imageFileName: "prato.jpg",
    imageKind: null,
    onImageKindChange: vi.fn(),
    audioFileName: undefined,
    onImageChange: vi.fn(),
    onAudioChange: vi.fn(),
    onProcess: vi.fn(),
    isProcessing: false,
    draft: null,
    mealLabel: "Almoço",
    onMealLabelChange: vi.fn(),
    suggestedMealLabel: null,
    occurredAt: "2026-11-04T12:00",
    onOccurredAtChange: vi.fn(),
    notes: "",
    onNotesChange: vi.fn(),
    editableItems: [],
    onEditableItemChange: vi.fn(),
    foodD1EditableItems: [],
    onFoodD1ItemChange: vi.fn(),
    previewTotals: { calories: 0, protein: 0, carbs: 0, fat: 0 },
    onConfirm: vi.fn(),
    isConfirmPending: false,
  } as const;
}

describe("D1 visual-role selection on meal registration", () => {
  it("starts without inferred plate identity and blocks submission until chosen", () => {
    render(<MealAiTabContent {...props()} />);
    const selector = screen.getByRole("combobox", { name: /Tipo de foto/i });
    expect(selector.getAttribute("aria-required")).toBe("true");
    expect(selector.getAttribute("aria-describedby")).toBe("meal-image-kind-help");
    expect(screen.getByText("Selecione o conteúdo da foto")).toBeTruthy();
    const submit = screen.getByRole("button", { name: "Registrar" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });

  it("enables the submission only after a controlled explicit role is selected", () => {
    const input = props();
    const { rerender } = render(<MealAiTabContent {...input} imageKind={null} />);
    const submit = screen.getByRole("button", { name: "Registrar" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    rerender(<MealAiTabContent {...input} imageKind="packaging" />);
    expect(submit.disabled).toBe(false);
  });

  it("does not treat a nutrition label as a new meal or enable its registration", () => {
    const input = props();
    render(<MealAiTabContent {...input} imageKind="nutrition_label" />);
    expect(screen.getByText(
      "Uma tabela nutricional precisa ser associada a um alimento já registrado. Este formulário cria uma nova refeição.",
    )).toBeTruthy();
    const submit = screen.getByRole("button", { name: "Registrar" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });

  it("keeps text/audio-only registration enabled without an image role", () => {
    render(<MealAiTabContent {...props()} imageFileName={undefined} />);
    expect(screen.queryByRole("combobox", { name: /Tipo de foto/i })).toBeNull();
    const submit = screen.getByRole("button", { name: "Registrar" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
  });
});
