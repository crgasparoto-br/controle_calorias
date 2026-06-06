import { z } from "zod";
import { normalizeMeasurementUnit } from "../../../shared/measurementUnits";

const macro = z.coerce.number().min(0);
const measurementUnit = z.string().trim().min(1).max(40).transform(normalizeMeasurementUnit);

export const foodSearchSchema = z.object({
  query: z.string().trim().default(""),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const favoriteFoodSchema = z.object({
  foodId: z.number().int().positive(),
  favorite: z.boolean(),
});

export const foodFormSchema = z.object({
  name: z.string().trim().min(2).max(255),
  brandName: z.string().trim().max(255).optional().nullable(),
  servingSize: z.coerce.number().positive(),
  servingUnit: measurementUnit,
  calories: macro,
  protein: macro,
  carbs: macro,
  fat: macro,
  fiber: macro.optional().nullable(),
  isFruit: z.boolean().default(false),
  isVegetable: z.boolean().default(false),
  isUltraProcessed: z.boolean().default(false),
  source: z.string().trim().min(1).max(80).default("manual"),
  foodType: z.enum(["generic", "branded"]).default("generic"),
});

export const updateFoodSchema = foodFormSchema.extend({
  foodId: z.number().int().positive(),
});

export type FoodFormInput = z.infer<typeof foodFormSchema>;
