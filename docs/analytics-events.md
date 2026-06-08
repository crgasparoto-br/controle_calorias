# Analytics events

Tracking uses a central event catalog in `shared/analytics.ts`.

Personal and health-sensitive raw values must not be sent. Do not send food names, free-text notes, search terms, phone, email, user ids, age, height, weight, barcode or medical details. Prefer counts, booleans and coarse categories.

| Event | Main properties |
| --- | --- |
| `onboarding_started` | `entry_point` |
| `onboarding_completed` | `objective`, `activity_level`, `has_restrictions`, `has_medical_condition`, `has_weight_entry` |
| `food_searched` | `query_length`, `limit` |
| `food_created` | `food_type`, `has_barcode`, `has_brand` |
| `meal_created` | `source`, `meal_label_category`, `item_count`, `has_notes`, `scheduled_for_future` |
| `meal_item_added` | `source`, `item_count`, `item_type` |
| `meal_copied` | `target_offset_days` |
| `meal_group_copied` | `item_count`, `target_offset_days` |
| `favorite_meal_created` | `item_count` |
| `daily_dashboard_viewed` | `surface` |
| `weekly_report_viewed` | `report_type`, `week_offset` |
| `period_report_viewed` | `report_type`, `period_days` |
| `goal_updated` | `exception_count`, `has_safety_warnings` |
| `weight_logged` | `source` |
| `subscription_started` | `plan_interval` |
| `subscription_cancelled` | `cancellation_type` |

The current server provider is a no-op provider by default. Replace it by calling `analyticsService.setProvider(...)` during server boot when a product analytics backend is selected.
