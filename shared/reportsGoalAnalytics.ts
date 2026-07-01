export type MacroTotals = {
  protein: number;
  carbs: number;
  fat: number;
};

export type CalorieGoalDay = {
  calories: number;
  goalCalories: number;
};

export type MacroGoalDay = MacroTotals & {
  goalProtein: number;
  goalCarbs: number;
  goalFat: number;
};

export type WeightTrendPoint = {
  date: string;
  label?: string;
  weightKg: number;
};

export type WeightTrendSummary = {
  hasData: boolean;
  entryCount: number;
  firstWeightKg: number | null;
  lastWeightKg: number | null;
  deltaKg: number | null;
  deltaPercent: number | null;
  trendDirection: "insufficient_data" | "up" | "down" | "stable";
  trendMessage: string;
};

export type CalorieAdherenceSummary = {
  totalCalories: number;
  totalGoalCalories: number;
  averageCalories: number;
  averageGoalCalories: number;
  averageDeltaCalories: number;
  adherencePercent: number;
  daysWithinRange: number;
  daysAboveRange: number;
  daysBelowRange: number;
  daysWithoutRecords: number;
};

export type MacroAdherenceItem = {
  key: keyof MacroTotals;
  label: string;
  consumedGrams: number;
  plannedGrams: number;
  consumedPercent: number;
  plannedPercent: number;
  percentPointDelta: number;
  gramDelta: number;
};

export type MacroDaySummary = {
  daysWithMacroRecords: number;
  proteinDaysWithinGoal: number;
  fatDaysAboveGoal: number;
};

export type FoodProcessingCategory = "naturalOrMinimallyProcessed" | "ultraProcessed" | "unclassified";

export type FoodQualityUnclassifiedReason = "missing_catalog_id" | "catalog_id_not_found" | "unknown";

export type FoodQualityItem = {
  calories: number;
  foodCatalogId?: number | null;
  foodName?: string | null;
  canonicalName?: string | null;
  portionText?: string | null;
  isFruit?: boolean;
  isVegetable?: boolean;
  isUltraProcessed?: boolean;
  isClassified?: boolean;
  unclassifiedReason?: FoodQualityUnclassifiedReason;
};

export type FoodQualityDay = {
  date: string;
  items: FoodQualityItem[];
};

export type FoodQualityDistributionItem = {
  key: FoodProcessingCategory;
  label: string;
  calories: number;
  percent: number;
};

export type FoodQualityUnclassifiedItemDiagnostic = {
  key: string;
  foodName: string | null;
  canonicalName: string | null;
  portionText: string | null;
  foodCatalogId: number | null;
  totalCalories: number;
  occurrences: number;
  firstDate: string | null;
  lastDate: string | null;
  reason: FoodQualityUnclassifiedReason;
};

export type FoodQualitySummary = {
  hasData: boolean;
  dayCount: number;
  daysWithRecords: number;
  fruitDays: number;
  vegetableDays: number;
  totalCalories: number;
  classifiedCalories: number;
  unclassifiedCalories: number;
  ultraProcessedCalories: number;
  naturalOrMinimallyProcessedCalories: number;
  ultraProcessedCaloriesPercent: number;
  naturalOrMinimallyProcessedCaloriesPercent: number;
  unclassifiedCaloriesPercent: number;
  qualityIndex: number | null;
  distribution: FoodQualityDistributionItem[];
  unclassifiedItems: FoodQualityUnclassifiedItemDiagnostic[];
};

const MACRO_LABELS: Record<keyof MacroTotals, string> = {
  protein: "Proteínas",
  carbs: "Carboidratos",
  fat: "Gorduras",
};

const FOOD_PROCESSING_LABELS: Record<FoodProcessingCategory, string> = {
  naturalOrMinimallyProcessed: "In natura/minimamente processados",
  ultraProcessed: "Ultraprocessados",
  unclassified: "Não classificados",
};

function roundMetric(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 10) / 10;
}

function macroCalories(macros: MacroTotals) {
  return {
    protein: macros.protein * 4,
    carbs: macros.carbs * 4,
    fat: macros.fat * 9,
  };
}

function macroPercentages(macros: MacroTotals) {
  const calories = macroCalories(macros);
  const totalCalories = calories.protein + calories.carbs + calories.fat;

  if (totalCalories <= 0) {
    return { protein: 0, carbs: 0, fat: 0 } satisfies MacroTotals;
  }

  return {
    protein: roundMetric((calories.protein / totalCalories) * 100),
    carbs: roundMetric((calories.carbs / totalCalories) * 100),
    fat: roundMetric((calories.fat / totalCalories) * 100),
  } satisfies MacroTotals;
}

function percentOfTotal(value: number, total: number) {
  if (total <= 0) return 0;
  return roundMetric((value / total) * 100);
}

function isWithinMacroRange(consumed: number, planned: number) {
  if (consumed <= 0 || planned <= 0) return false;
  const ratio = consumed / planned;
  return ratio >= 0.9 && ratio <= 1.1;
}

function normalizeDiagnosticKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s-]/g, "")
    .toLowerCase()
    .replace(/[\s_-]+/g, " ")
    .trim();
}

function buildDiagnosticKey(item: FoodQualityItem) {
  return normalizeDiagnosticKey(item.canonicalName ?? item.foodName ?? item.portionText ?? "") || "alimento sem identificacao";
}

function mergeUnclassifiedReason(
  current: FoodQualityUnclassifiedReason,
  next: FoodQualityUnclassifiedReason,
): FoodQualityUnclassifiedReason {
  if (current === next) return current;
  if (current === "unknown") return next;
  if (next === "unknown") return current;
  return "unknown";
}

function addUnclassifiedDiagnostic(
  diagnostics: Map<string, FoodQualityUnclassifiedItemDiagnostic>,
  date: string,
  item: FoodQualityItem,
  calories: number,
) {
  const key = buildDiagnosticKey(item);
  const existing = diagnostics.get(key);
  const reason = item.unclassifiedReason ?? "unknown";

  if (!existing) {
    diagnostics.set(key, {
      key,
      foodName: item.foodName ?? null,
      canonicalName: item.canonicalName ?? null,
      portionText: item.portionText ?? null,
      foodCatalogId: item.foodCatalogId ?? null,
      totalCalories: calories,
      occurrences: 1,
      firstDate: date || null,
      lastDate: date || null,
      reason,
    });
    return;
  }

  existing.totalCalories += calories;
  existing.occurrences += 1;
  existing.reason = mergeUnclassifiedReason(existing.reason, reason);
  if (!existing.foodName && item.foodName) existing.foodName = item.foodName;
  if (!existing.canonicalName && item.canonicalName) existing.canonicalName = item.canonicalName;
  if (!existing.portionText && item.portionText) existing.portionText = item.portionText;
  if (!existing.foodCatalogId && item.foodCatalogId) existing.foodCatalogId = item.foodCatalogId;
  if (!existing.firstDate || (date && date < existing.firstDate)) existing.firstDate = date;
  if (!existing.lastDate || (date && date > existing.lastDate)) existing.lastDate = date;
}

export function calculateCalorieAdherence(days: CalorieGoalDay[], expectedDayCount = days.length): CalorieAdherenceSummary {
  const totalCalories = days.reduce((total, day) => total + day.calories, 0);
  const totalGoalCalories = days.reduce((total, day) => total + day.goalCalories, 0);
  const daysWithoutRecords = Math.max(expectedDayCount - days.filter(day => day.calories > 0).length, 0);
  const averageCalories = expectedDayCount ? totalCalories / expectedDayCount : 0;
  const averageGoalCalories = expectedDayCount ? totalGoalCalories / expectedDayCount : 0;

  const status = days.reduce(
    (acc, day) => {
      if (day.calories <= 0 || day.goalCalories <= 0) return acc;
      const ratio = day.calories / day.goalCalories;
      if (ratio > 1.05) acc.daysAboveRange += 1;
      else if (ratio < 0.9) acc.daysBelowRange += 1;
      else acc.daysWithinRange += 1;
      return acc;
    },
    { daysWithinRange: 0, daysAboveRange: 0, daysBelowRange: 0 },
  );

  return {
    totalCalories: roundMetric(totalCalories),
    totalGoalCalories: roundMetric(totalGoalCalories),
    averageCalories: roundMetric(averageCalories),
    averageGoalCalories: roundMetric(averageGoalCalories),
    averageDeltaCalories: roundMetric(averageCalories - averageGoalCalories),
    adherencePercent: totalGoalCalories > 0 ? roundMetric((totalCalories / totalGoalCalories) * 100) : 0,
    daysWithoutRecords,
    ...status,
  };
}

export function calculateMacroAdherence(consumed: MacroTotals, planned: MacroTotals) {
  const consumedPercentages = macroPercentages(consumed);
  const plannedPercentages = macroPercentages(planned);

  const items = (Object.keys(MACRO_LABELS) as Array<keyof MacroTotals>).map(key => ({
    key,
    label: MACRO_LABELS[key],
    consumedGrams: roundMetric(consumed[key]),
    plannedGrams: roundMetric(planned[key]),
    consumedPercent: consumedPercentages[key],
    plannedPercent: plannedPercentages[key],
    percentPointDelta: roundMetric(consumedPercentages[key] - plannedPercentages[key]),
    gramDelta: roundMetric(consumed[key] - planned[key]),
  }));

  const averagePercentDelta = items.reduce((total, item) => total + Math.abs(item.percentPointDelta), 0) / Math.max(items.length, 1);
  const distributionAdherencePercent = Math.max(100 - averagePercentDelta, 0);
  const mostDistantMacro = items.reduce<MacroAdherenceItem | null>((current, item) => {
    if (!current) return item;
    return Math.abs(item.percentPointDelta) > Math.abs(current.percentPointDelta) ? item : current;
  }, null);

  return {
    items,
    distributionAdherencePercent: roundMetric(distributionAdherencePercent),
    mostDistantMacro,
  };
}

export function calculateMacroDaySummary(days: MacroGoalDay[]): MacroDaySummary {
  return days.reduce(
    (summary, day) => {
      const hasMacroRecord = day.protein > 0 || day.carbs > 0 || day.fat > 0;
      if (!hasMacroRecord) return summary;

      summary.daysWithMacroRecords += 1;

      if (isWithinMacroRange(day.protein, day.goalProtein)) {
        summary.proteinDaysWithinGoal += 1;
      }

      if (day.goalFat > 0 && day.fat / day.goalFat > 1.05) {
        summary.fatDaysAboveGoal += 1;
      }

      return summary;
    },
    {
      daysWithMacroRecords: 0,
      proteinDaysWithinGoal: 0,
      fatDaysAboveGoal: 0,
    },
  );
}

export function calculateFoodQualitySummary(days: FoodQualityDay[], expectedDayCount = days.length): FoodQualitySummary {
  const summary = days.reduce(
    (acc, day) => {
      const dayCalories = day.items.reduce((total, item) => total + Math.max(item.calories, 0), 0);
      const hasFruit = day.items.some(item => item.isFruit);
      const hasVegetable = day.items.some(item => item.isVegetable);

      if (dayCalories > 0) acc.daysWithRecords += 1;
      if (hasFruit) acc.fruitDays += 1;
      if (hasVegetable) acc.vegetableDays += 1;

      for (const item of day.items) {
        const calories = Math.max(item.calories, 0);

        if (!item.isClassified) {
          addUnclassifiedDiagnostic(acc.unclassifiedDiagnostics, day.date, item, calories);
          if (calories <= 0) continue;
          acc.totalCalories += calories;
          acc.unclassifiedCalories += calories;
          continue;
        }

        if (calories <= 0) continue;

        acc.totalCalories += calories;
        acc.classifiedCalories += calories;

        if (item.isUltraProcessed) {
          acc.ultraProcessedCalories += calories;
        } else {
          acc.naturalOrMinimallyProcessedCalories += calories;
        }
      }

      return acc;
    },
    {
      daysWithRecords: 0,
      fruitDays: 0,
      vegetableDays: 0,
      totalCalories: 0,
      classifiedCalories: 0,
      unclassifiedCalories: 0,
      ultraProcessedCalories: 0,
      naturalOrMinimallyProcessedCalories: 0,
      unclassifiedDiagnostics: new Map<string, FoodQualityUnclassifiedItemDiagnostic>(),
    },
  );

  const totalCalories = roundMetric(summary.totalCalories);
  const ultraProcessedCalories = roundMetric(summary.ultraProcessedCalories);
  const naturalOrMinimallyProcessedCalories = roundMetric(summary.naturalOrMinimallyProcessedCalories);
  const unclassifiedCalories = roundMetric(summary.unclassifiedCalories);
  const naturalPercent = percentOfTotal(naturalOrMinimallyProcessedCalories, totalCalories);
  const ultraPercent = percentOfTotal(ultraProcessedCalories, totalCalories);
  const unclassifiedPercent = percentOfTotal(unclassifiedCalories, totalCalories);
  const qualityIndex = summary.classifiedCalories > 0
    ? Math.max(0, Math.min(100, roundMetric(100 - percentOfTotal(summary.ultraProcessedCalories, summary.classifiedCalories))))
    : null;
  const unclassifiedItems = Array.from(summary.unclassifiedDiagnostics.values())
    .map(item => ({
      ...item,
      totalCalories: roundMetric(item.totalCalories),
    }))
    .sort((first, second) => second.totalCalories - first.totalCalories || second.occurrences - first.occurrences || first.key.localeCompare(second.key));

  return {
    hasData: totalCalories > 0,
    dayCount: expectedDayCount,
    daysWithRecords: summary.daysWithRecords,
    fruitDays: summary.fruitDays,
    vegetableDays: summary.vegetableDays,
    totalCalories,
    classifiedCalories: roundMetric(summary.classifiedCalories),
    unclassifiedCalories,
    ultraProcessedCalories,
    naturalOrMinimallyProcessedCalories,
    ultraProcessedCaloriesPercent: ultraPercent,
    naturalOrMinimallyProcessedCaloriesPercent: naturalPercent,
    unclassifiedCaloriesPercent: unclassifiedPercent,
    qualityIndex,
    distribution: [
      {
        key: "naturalOrMinimallyProcessed",
        label: FOOD_PROCESSING_LABELS.naturalOrMinimallyProcessed,
        calories: naturalOrMinimallyProcessedCalories,
        percent: naturalPercent,
      },
      {
        key: "ultraProcessed",
        label: FOOD_PROCESSING_LABELS.ultraProcessed,
        calories: ultraProcessedCalories,
        percent: ultraPercent,
      },
      {
        key: "unclassified",
        label: FOOD_PROCESSING_LABELS.unclassified,
        calories: unclassifiedCalories,
        percent: unclassifiedPercent,
      },
    ],
    unclassifiedItems,
  };
}

export function calculateWeightTrendSummary(points: WeightTrendPoint[]): WeightTrendSummary {
  const orderedPoints = points
    .filter(point => Number.isFinite(point.weightKg) && point.weightKg > 0)
    .slice()
    .sort((first, second) => first.date.localeCompare(second.date));

  if (!orderedPoints.length) {
    return {
      hasData: false,
      entryCount: 0,
      firstWeightKg: null,
      lastWeightKg: null,
      deltaKg: null,
      deltaPercent: null,
      trendDirection: "insufficient_data",
      trendMessage: "Ainda não há registros de peso no período selecionado.",
    };
  }

  const firstWeightKg = orderedPoints[0].weightKg;
  const lastWeightKg = orderedPoints[orderedPoints.length - 1].weightKg;
  const deltaKg = roundMetric(lastWeightKg - firstWeightKg);
  const deltaPercent = firstWeightKg > 0 ? roundMetric((deltaKg / firstWeightKg) * 100) : null;
  const trendDirection = orderedPoints.length < 2
    ? "insufficient_data"
    : Math.abs(deltaKg) < 0.2
      ? "stable"
      : deltaKg > 0
        ? "up"
        : "down";

  const trendMessage = orderedPoints.length < 2
    ? "Há apenas um registro de peso no período. A tendência ainda é insuficiente para análise."
    : trendDirection === "stable"
      ? "O peso ficou estável no período. Relacione com a aderência calórica antes de tirar conclusões."
      : trendDirection === "up"
        ? "O peso subiu no período. Use a aderência calórica como contexto, sem interpretar de forma isolada."
        : "O peso caiu no período. Use a aderência calórica como contexto, sem interpretar de forma isolada.";

  return {
    hasData: true,
    entryCount: orderedPoints.length,
    firstWeightKg: roundMetric(firstWeightKg),
    lastWeightKg: roundMetric(lastWeightKg),
    deltaKg,
    deltaPercent,
    trendDirection,
    trendMessage,
  };
}
