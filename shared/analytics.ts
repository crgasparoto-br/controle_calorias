export const ANALYTICS_EVENT_NAMES = [
  "onboarding_started",
  "onboarding_completed",
  "food_searched",
  "food_created",
  "meal_created",
  "meal_item_added",
  "meal_copied",
  "favorite_meal_created",
  "daily_dashboard_viewed",
  "weekly_report_viewed",
  "period_report_viewed",
  "goal_updated",
  "weight_logged",
  "subscription_started",
  "subscription_cancelled",
] as const;

export type AnalyticsEventName = typeof ANALYTICS_EVENT_NAMES[number];

export type AnalyticsPrimitive = string | number | boolean | null;
export type AnalyticsProperties = Record<string, AnalyticsPrimitive>;

export type AnalyticsEventMap = {
  onboarding_started: {
    entry_point?: "route" | "unknown";
  };
  onboarding_completed: {
    objective: "emagrecer" | "manter_peso" | "ganhar_massa" | "melhorar_habitos";
    activity_level: string;
    has_restrictions: boolean;
    has_medical_condition: boolean;
    has_weight_entry: boolean;
  };
  food_searched: {
    query_length: number;
    limit: number;
  };
  food_created: {
    food_type: "generic" | "branded";
    has_barcode: boolean;
    has_brand: boolean;
  };
  meal_created: {
    source: "web" | "whatsapp" | "ai_draft" | "favorite" | "copy" | "unknown";
    meal_label_category: string;
    item_count: number;
    has_notes: boolean;
    scheduled_for_future: boolean;
  };
  meal_item_added: {
    source: "web" | "whatsapp" | "ai_draft" | "favorite" | "copy" | "unknown";
    item_count: number;
    item_type: "food" | "recipe" | "unknown";
  };
  meal_copied: {
    target_offset_days: number;
  };
  favorite_meal_created: {
    item_count: number;
  };
  daily_dashboard_viewed: {
    surface: "home" | "api";
  };
  weekly_report_viewed: {
    report_type: "summary" | "progress" | "insights" | "bundle";
    week_offset?: number;
  };
  period_report_viewed: {
    report_type: "habit_analytics";
    period_days: number;
  };
  goal_updated: {
    exception_count: number;
    has_safety_warnings: boolean;
  };
  weight_logged: {
    source: "onboarding" | "manual" | "import";
  };
  subscription_started: {
    plan_interval?: "monthly" | "yearly" | "unknown";
  };
  subscription_cancelled: {
    cancellation_type?: "immediate" | "period_end" | "unknown";
  };
};

export type AnalyticsEventPayload<TName extends AnalyticsEventName = AnalyticsEventName> = {
  name: TName;
  properties?: AnalyticsEventMap[TName];
};

export const SENSITIVE_ANALYTICS_PROPERTY_KEYS = [
  "age",
  "ageYears",
  "barcode",
  "birthdate",
  "currentWeightKg",
  "email",
  "foodName",
  "heightCm",
  "name",
  "notes",
  "phone",
  "query",
  "restrictionNotes",
  "text",
  "userId",
  "weight",
  "weightKg",
] as const;
