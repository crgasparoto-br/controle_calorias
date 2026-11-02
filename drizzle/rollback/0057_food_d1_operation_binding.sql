-- D1 only added operation state. Never alter a legacy meal on rollback.
DROP TABLE IF EXISTS food_d1_user_operation_effects;
--> statement-breakpoint
DROP TABLE IF EXISTS food_d1_user_operation_routes;
