import { afterEach, describe, expect, it } from "vitest";
import {
  assertNewMealLabelHasExistingTarget,
  assertUnmigratedFoodD1DraftOff,
  assertUnmigratedFoodD1EntrypointsOff,
  UNMIGRATED_FOOD_D1_PUBLIC_ENTRYPOINT,
} from "./publicUnmigratedEntrypoints";

const savedGlobal = process.env.FOOD_V2_D1_ENABLED;
const savedEntrypoints = process.env.FOOD_V2_D1_ENTRYPOINTS;
afterEach(() => {
  if (savedGlobal === undefined) delete process.env.FOOD_V2_D1_ENABLED;
  else process.env.FOOD_V2_D1_ENABLED = savedGlobal;
  if (savedEntrypoints === undefined) delete process.env.FOOD_V2_D1_ENTRYPOINTS;
  else process.env.FOOD_V2_D1_ENTRYPOINTS = savedEntrypoints;
});

describe("#1308 fail-closed unmigrated D1 public boundaries", () => {
  it("refuses explicitly marked nutrition-label photos without a physical item even with rollout OFF", () => {
    const image = { base64: "YQ==", mimeType: "image/jpeg" };
    process.env.FOOD_V2_D1_ENABLED = "false";
    process.env.FOOD_V2_D1_ENTRYPOINTS = "";
    expect(() => assertNewMealLabelHasExistingTarget({
      image, imageKind: "nutrition_label",
    })).toThrow("food-d1-new-meal-label-requires-existing-item");
    expect(() => assertNewMealLabelHasExistingTarget({
      image, imageKind: "plate_image",
    })).not.toThrow();
    expect(() => assertNewMealLabelHasExistingTarget({
      image, imageKind: "packaging",
    })).not.toThrow();
    expect(() => assertNewMealLabelHasExistingTarget({
      image: undefined, imageKind: "nutrition_label",
    })).not.toThrow();
  });

  it("preserves V1 while rollout is disabled", () => {
    process.env.FOOD_V2_D1_ENABLED = "false";
    process.env.FOOD_V2_D1_ENTRYPOINTS =
      "text,audio_transcript,plate_image,packaging,nutrition_label";
    expect(() => assertUnmigratedFoodD1DraftOff({
      text: "100 g de arroz",
      audio: { base64: "YQ==", mimeType: "audio/webm" },
      image: { base64: "YQ==", mimeType: "image/jpeg" },
    })).not.toThrow();
  });
  it("blocks every selected modality before a V1 public draft", () => {
    process.env.FOOD_V2_D1_ENABLED = "true";
    const image = { base64: "YQ==", mimeType: "image/jpeg" };
    const audio = { base64: "YQ==", mimeType: "audio/webm" };
    for (const { selector, draft } of [
      { selector: "text", draft: { text: "100 g de arroz" } },
      { selector: "audio_transcript", draft: { audio } },
      { selector: "plate_image", draft: { image } },
      { selector: "packaging", draft: { image } },
      { selector: "nutrition_label", draft: { image } },
      { selector: "nutrition_label", draft: { text: "rótulo", image } },
      { selector: "multimodal", draft: { text: "1 prato", image } },
      { selector: "multimodal", draft: { audio, image } },
    ]) {
      process.env.FOOD_V2_D1_ENTRYPOINTS = selector;
      expect(() => assertUnmigratedFoodD1DraftOff(draft), selector)
        .toThrow(UNMIGRATED_FOOD_D1_PUBLIC_ENTRYPOINT);
    }
  });
  it("ignores unrelated modes, but protects V2 continuation", () => {
    process.env.FOOD_V2_D1_ENABLED = "true";
    process.env.FOOD_V2_D1_ENTRYPOINTS = "packaging";
    expect(() => assertUnmigratedFoodD1DraftOff({ text: "arroz" })).not.toThrow();
    expect(() => assertUnmigratedFoodD1EntrypointsOff(["continuation", "nutrition_label"]))
      .not.toThrow();
    process.env.FOOD_V2_D1_ENTRYPOINTS = "continuation";
    expect(() => assertUnmigratedFoodD1EntrypointsOff(["continuation"]))
      .toThrow(UNMIGRATED_FOOD_D1_PUBLIC_ENTRYPOINT);
    process.env.FOOD_V2_D1_ENTRYPOINTS = "addition";
    expect(() => assertUnmigratedFoodD1DraftOff({ text: "arroz" })).not.toThrow();
  });
});
