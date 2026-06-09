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

const MACRO_LABELS: Record<keyof MacroTotals, string> = {
  protein: "Proteínas",
  carbs: "Carboidratos",
  fat: "Gorduras",
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

function isWithinMacroRange(consumed: number, planned: number) {
  if (consumed <= 0 || planned <= 0) return false;
  const ratio = consumed / planned;
  return ratio >= 0.9 && ratio <= 1.1;
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
