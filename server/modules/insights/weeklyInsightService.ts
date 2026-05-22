import { calculateMealTotals } from "../../../shared/mealTotals";
import { getDateKeyInTimeZone } from "../../../shared/timeZone";

export type WeeklyInsightSeverity = "info" | "positive" | "warning";

export type WeeklyInsight = {
  title: string;
  description: string;
  suggestion: string;
  severity: WeeklyInsightSeverity;
  data: Record<string, number | string | null>;
};

type WeeklyDay = {
  date: string;
  label: string;
  calories: number;
  protein: number;
  goalCalories: number;
  goalProtein: number;
};

type WeeklyMeal = {
  id: number;
  mealLabel: string;
  occurredAt: number;
  items: Array<{
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
  }>;
};

export type WeeklyInsightInput = {
  days: WeeklyDay[];
  meals: WeeklyMeal[];
};

function round(value: number) {
  return Math.round(value * 10) / 10;
}

function percent(value: number, total: number) {
  return total ? round((value / total) * 100) : 0;
}

function dayName(date: string) {
  return new Date(`${date}T12:00:00.000Z`).toLocaleDateString("pt-BR", { weekday: "long" });
}

function mealDateKey(meal: WeeklyMeal) {
  return getDateKeyInTimeZone(meal.occurredAt);
}

export class WeeklyInsightService {
  generate(input: WeeklyInsightInput): WeeklyInsight[] {
    return [
      this.buildCalorieAdherenceInsight(input.days),
      this.buildProteinInsight(input.days),
      this.buildHighestCalorieMealInsight(input.meals),
      this.buildWeekendInsight(input.days),
      this.buildLoggingFrequencyInsight(input.days),
      this.buildOpportunityInsight(input.days),
    ];
  }

  private buildCalorieAdherenceInsight(days: WeeklyDay[]): WeeklyInsight {
    const consumed = round(days.reduce((acc, day) => acc + day.calories, 0));
    const goal = round(days.reduce((acc, day) => acc + day.goalCalories, 0));
    const adherence = percent(consumed, goal);
    const severity: WeeklyInsightSeverity = adherence >= 90 && adherence <= 105 ? "positive" : adherence > 115 ? "warning" : "info";

    return {
      title: "Aderência à meta calórica semanal",
      description: `A semana ficou em ${adherence}% da meta calórica planejada.`,
      suggestion: adherence > 105
        ? "Observe uma ou duas refeições mais calóricas e planeje uma troca simples, como incluir mais volume de legumes ou uma proteína magra."
        : "Mantenha registros consistentes para a média semanal continuar ajudando nas decisões.",
      severity,
      data: {
        consumedCalories: consumed,
        goalCalories: goal,
        adherencePercent: adherence,
      },
    };
  }

  private buildProteinInsight(days: WeeklyDay[]): WeeklyInsight {
    const daysWithFood = days.filter(day => day.calories > 0);
    const daysWithinProtein = daysWithFood.filter(day => day.goalProtein > 0 && day.protein >= day.goalProtein * 0.9).length;
    const severity: WeeklyInsightSeverity = daysWithFood.length > 0 && daysWithinProtein >= Math.ceil(daysWithFood.length / 2) ? "positive" : "info";

    return {
      title: "Dias com proteína dentro da meta",
      description: `${daysWithinProtein} de ${daysWithFood.length} dias com registro chegaram perto da meta de proteína.`,
      suggestion: "Uma pequena âncora proteica em uma refeição do dia costuma ajudar, como ovos, iogurte, frango, peixe, tofu ou feijão.",
      severity,
      data: {
        daysWithFood: daysWithFood.length,
        daysWithinProtein,
        targetThresholdPercent: 90,
      },
    };
  }

  private buildHighestCalorieMealInsight(meals: WeeklyMeal[]): WeeklyInsight {
    const ranked = meals
      .map(meal => ({
        meal,
        totals: calculateMealTotals(meal.items),
      }))
      .sort((a, b) => b.totals.calories - a.totals.calories);
    const top = ranked[0];

    if (!top) {
      return {
        title: "Refeição com maior concentração calórica",
        description: "Ainda não há refeições registradas nesta semana.",
        suggestion: "Registre uma refeição simples para começar a identificar padrões com mais clareza.",
        severity: "info",
        data: {
          mealId: null,
          calories: 0,
        },
      };
    }

    return {
      title: "Refeição com maior concentração calórica",
      description: `${top.meal.mealLabel} concentrou ${round(top.totals.calories)} kcal na semana.`,
      suggestion: "Se fizer sentido para sua rotina, revise porção, bebida ou acompanhamento dessa refeição antes de mudar o resto do dia.",
      severity: "info",
      data: {
        mealId: top.meal.id,
        mealLabel: top.meal.mealLabel,
        date: mealDateKey(top.meal),
        calories: round(top.totals.calories),
      },
    };
  }

  private buildWeekendInsight(days: WeeklyDay[]): WeeklyInsight {
    const weekdays = days.filter(day => {
      const weekday = new Date(`${day.date}T12:00:00.000Z`).getUTCDay();
      return weekday >= 1 && weekday <= 5;
    });
    const weekends = days.filter(day => {
      const weekday = new Date(`${day.date}T12:00:00.000Z`).getUTCDay();
      return weekday === 0 || weekday === 6;
    });
    const weekdayAverage = round(weekdays.reduce((acc, day) => acc + day.calories, 0) / Math.max(weekdays.length, 1));
    const weekendAverage = round(weekends.reduce((acc, day) => acc + day.calories, 0) / Math.max(weekends.length, 1));
    const delta = round(weekendAverage - weekdayAverage);

    return {
      title: "Diferença entre semana e fim de semana",
      description: `Fim de semana ficou ${Math.abs(delta)} kcal ${delta >= 0 ? "acima" : "abaixo"} da média dos dias úteis.`,
      suggestion: "Escolha um ponto de atenção realista para o fim de semana, como manter proteína no café da manhã ou registrar a primeira refeição.",
      severity: Math.abs(delta) <= 150 ? "positive" : "info",
      data: {
        weekdayAverageCalories: weekdayAverage,
        weekendAverageCalories: weekendAverage,
        deltaCalories: delta,
      },
    };
  }

  private buildLoggingFrequencyInsight(days: WeeklyDay[]): WeeklyInsight {
    const daysWithRecords = days.filter(day => day.calories > 0).length;
    const frequency = percent(daysWithRecords, days.length);

    return {
      title: "Frequência de registro",
      description: `${daysWithRecords} de ${days.length} dias tiveram registros alimentares.`,
      suggestion: daysWithRecords < 5
        ? "Para a próxima semana, tente registrar ao menos uma refeição por dia. Esse hábito já melhora bastante a leitura."
        : "Continue com esse ritmo; registros frequentes deixam a média semanal mais confiável.",
      severity: daysWithRecords >= 5 ? "positive" : "info",
      data: {
        daysWithRecords,
        totalDays: days.length,
        frequencyPercent: frequency,
      },
    };
  }

  private buildOpportunityInsight(days: WeeklyDay[]): WeeklyInsight {
    const daysWithFood = days.filter(day => day.calories > 0);
    const largestCalorieDelta = daysWithFood
      .map(day => ({ day, delta: day.calories - day.goalCalories }))
      .sort((a, b) => b.delta - a.delta)[0];
    const lowProteinDays = daysWithFood.filter(day => day.goalProtein > 0 && day.protein < day.goalProtein * 0.8);

    if (lowProteinDays.length >= 2) {
      return {
        title: "Melhor oportunidade para a próxima semana",
        description: `${lowProteinDays.length} dias ficaram com proteína mais distante da meta.`,
        suggestion: "Escolha uma refeição fixa para reforçar proteína, sem mudar tudo ao mesmo tempo.",
        severity: "info",
        data: {
          lowProteinDays: lowProteinDays.length,
          thresholdPercent: 80,
        },
      };
    }

    if (largestCalorieDelta && largestCalorieDelta.delta > 250) {
      return {
        title: "Melhor oportunidade para a próxima semana",
        description: `${dayName(largestCalorieDelta.day.date)} teve a maior distância em relação à meta.`,
        suggestion: "Planeje uma pequena antecipação para esse tipo de dia, como deixar uma opção prática de refeição já definida.",
        severity: "warning",
        data: {
          date: largestCalorieDelta.day.date,
          calorieDelta: round(largestCalorieDelta.delta),
        },
      };
    }

    return {
      title: "Melhor oportunidade para a próxima semana",
      description: "A semana não mostra um ponto único de grande ajuste.",
      suggestion: "Mantenha o foco em consistência: registrar refeições e repetir escolhas que funcionaram bem.",
      severity: "positive",
      data: {
        daysAnalyzed: daysWithFood.length,
      },
    };
  }
}

export const weeklyInsightService = new WeeklyInsightService();
