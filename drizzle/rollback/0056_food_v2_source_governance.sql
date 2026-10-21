-- #1302 B2 rollback: drop only new source grants and cache index.
-- No V1 food, meal or snapshot row is modified.
ALTER TABLE `food_evidence` DROP INDEX `food_evidence_cache_u0`;
--> statement-breakpoint
DROP TABLE `food_source_read_grants`;
