-- B2 rollback never rewrites alias content or historical meal snapshots.
ALTER TABLE food_aliases DROP COLUMN source_version;
--> statement-breakpoint
-- AUD-1302-026: rollback metadata without rewriting V1 or historical meals.
ALTER TABLE food_portions DROP COLUMN source_version;
--> statement-breakpoint
ALTER TABLE food_nutrition_profiles DROP COLUMN source_version;
--> statement-breakpoint
-- Personal quarantine is V2-only and never modifies V1/historical meals.
DROP TABLE `food_personal_reconciliation_quarantine`;
--> statement-breakpoint
-- #1302 B2 rollback: drop only new source grants and cache index.
-- No V1 food, meal or snapshot row is modified.
ALTER TABLE `food_evidence` DROP INDEX `food_evidence_cache_u0`;
--> statement-breakpoint
DROP TABLE `food_source_read_grants`;
