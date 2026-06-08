import { z } from "zod";
import { normalizeMeasurementUnit } from "../../../shared/measurementUnits";

const macro = z.coerce.number().min(0);
const measurementUnit = z.string().trim().min(1).max(40).transform(normalizeMeasurementUnit);
const catalogNutrient = z.coerce.number().min(0);
const optionalCatalogNutrient = catalogNutrient.optional().nullable();

export const foodSearchSchema = z.object({
  query: z.string().trim().default(""),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const catalogFoodSearchSchema = z.object({
  query: z.string().trim().default(""),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  includeInactive: z.boolean().default(false),
});

export const catalogFoodGetSchema = z.object({
  foodId: z.number().int().positive(),
});

export const catalogFoodRecentSchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const customFoodPortionSchema = z.object({
  label: z.string().trim().min(1).max(120),
  unit: z.string().trim().min(1).max(40).default("serving"),
  quantity: z.coerce.number().positive().default(1),
  grams: z.coerce.number().positive(),
  isDefault: z.boolean().default(false),
});

export const customFoodSchema = z.object({
  name: z.string().trim().min(2).max(255),
  brandName: z.string().trim().max(255).optional().nullable(),
  category: z.string().trim().max(160).optional().nullable(),
  description: z.string().trim().max(1000).optional().nullable(),
  caloriesKcalPer100g: catalogNutrient.max(10_000),
  proteinGramsPer100g: catalogNutrient.max(1_000),
  carbsGramsPer100g: catalogNutrient.max(1_000),
  fatGramsPer100g: catalogNutrient.max(1_000),
  fiberGramsPer100g: optionalCatalogNutrient,
  sugarGramsPer100g: optionalCatalogNutrient,
  sodiumMgPer100g: catalogNutrient.max(100_000).optional().nullable(),
  nutrients: z.record(z.string(), z.unknown()).optional().nullable(),
  aliases: z.array(z.string().trim().min(1).max(255)).default([]),
  portions: z.array(customFoodPortionSchema).default([]),
});

export const updateCustomFoodSchema = customFoodSchema.extend({
  foodId: z.number().int().positive(),
});

export const deleteCustomFoodSchema = z.object({
  foodId: z.number().int().positive(),
});

export const favoriteFoodSchema = z.object({
  foodId: z.number().int().positive(),
  favorite: z.boolean(),
});

export const catalogFoodFavoriteSchema = z.object({
  foodId: z.number().int().positive(),
  favorite: z.boolean(),
});

export const adminCatalogFoodCurationSchema = z.object({
  foodId: z.number().int().positive(),
  status: z.enum(["active", "deprecated", "merged"]),
  mergedIntoFoodId: z.number().int().positive().optional().nullable(),
}).superRefine((input, ctx) => {
  if (input.status === "merged" && !input.mergedIntoFoodId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Informe o alimento destino ao marcar um item como mesclado.",
      path: ["mergedIntoFoodId"],
    });
  }

  if (input.mergedIntoFoodId && input.mergedIntoFoodId === input.foodId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "O alimento destino deve ser diferente do alimento curado.",
      path: ["mergedIntoFoodId"],
    });
  }
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
export type CatalogFoodSearchInput = z.infer<typeof catalogFoodSearchSchema>;
export type CatalogFoodRecentInput = z.infer<typeof catalogFoodRecentSchema>;
export type CatalogFoodFavoriteInput = z.infer<typeof catalogFoodFavoriteSchema>;
export type AdminCatalogFoodCurationInput = z.infer<typeof adminCatalogFoodCurationSchema>;
export type CustomFoodInput = z.infer<typeof customFoodSchema>;
export type UpdateCustomFoodInput = z.infer<typeof updateCustomFoodSchema>;
