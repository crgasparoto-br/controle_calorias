-- #1301 PRE-CUTOVER rollback only. Never execute after V2 data is accepted.
-- Operator MUST take/verify backup, prove zero V2 references/writes, and disable V2 writers.
-- MySQL/TiDB DDL is not transactionally rolled back: run on disposable validation DB first.
ALTER TABLE `food_aliases` DROP FOREIGN KEY `food_aliases_food_variant_id_food_variants_id_fk`;
--> statement-breakpoint
ALTER TABLE `food_portions` DROP FOREIGN KEY `food_portions_food_variant_id_food_variants_id_fk`;
--> statement-breakpoint
ALTER TABLE `food_portions` DROP FOREIGN KEY `food_portions_evidence_id_food_evidence_id_fk`;
--> statement-breakpoint
ALTER TABLE `user_food_favorites` DROP FOREIGN KEY `user_food_favorites_food_variant_id_food_variants_id_fk`;
--> statement-breakpoint
ALTER TABLE `user_food_usage_stats` DROP FOREIGN KEY `user_food_usage_stats_food_variant_id_food_variants_id_fk`;
--> statement-breakpoint
ALTER TABLE `mealItems` DROP FOREIGN KEY `mealItems_foodVariantId_food_variants_id_fk`;
--> statement-breakpoint
ALTER TABLE `mealItems` DROP FOREIGN KEY `mealItems_nutritionProfileId_food_nutrition_profiles_id_fk`;
--> statement-breakpoint
ALTER TABLE `mealItems` DROP FOREIGN KEY `mealItems_foodPortionId_food_portions_id_fk`;
--> statement-breakpoint
DROP INDEX `v2_foods_u0` ON `foods`;
--> statement-breakpoint
DROP INDEX `v2_food_aliases_u0` ON `food_aliases`;
--> statement-breakpoint
DROP INDEX `v2_food_aliases_i0` ON `food_aliases`;
--> statement-breakpoint
DROP INDEX `v2_food_portions_u0` ON `food_portions`;
--> statement-breakpoint
DROP INDEX `v2_food_portions_i0` ON `food_portions`;
--> statement-breakpoint
DROP INDEX `v2_user_food_favorit_u0` ON `user_food_favorites`;
--> statement-breakpoint
DROP INDEX `v2_user_food_usage_s_u0` ON `user_food_usage_stats`;
--> statement-breakpoint
DROP INDEX `v2_mealItems_i0` ON `mealItems`;
--> statement-breakpoint
DROP INDEX `v2_mealItems_i1` ON `mealItems`;
--> statement-breakpoint
DROP INDEX `v2_mealItems_i2` ON `mealItems`;
--> statement-breakpoint
ALTER TABLE `food_aliases` DROP CHECK `v2_food_aliases_ck0`;
--> statement-breakpoint
ALTER TABLE `foods` DROP COLUMN `scope`;
--> statement-breakpoint
ALTER TABLE `foods` DROP COLUMN `canonical_name`;
--> statement-breakpoint
ALTER TABLE `foods` DROP COLUMN `canonical_key`;
--> statement-breakpoint
ALTER TABLE `food_aliases` DROP COLUMN `food_variant_id`;
--> statement-breakpoint
ALTER TABLE `food_aliases` DROP COLUMN `locale`;
--> statement-breakpoint
ALTER TABLE `food_aliases` DROP COLUMN `status`;
--> statement-breakpoint
ALTER TABLE `food_aliases` DROP COLUMN `governance_status`;
--> statement-breakpoint
ALTER TABLE `food_aliases` DROP COLUMN `revision`;
--> statement-breakpoint
ALTER TABLE `food_aliases` DROP COLUMN `updated_at`;
--> statement-breakpoint
ALTER TABLE `food_portions` DROP COLUMN `food_variant_id`;
--> statement-breakpoint
ALTER TABLE `food_portions` DROP COLUMN `milliliters`;
--> statement-breakpoint
ALTER TABLE `food_portions` DROP COLUMN `measure_kind`;
--> statement-breakpoint
ALTER TABLE `food_portions` DROP COLUMN `evidence_id`;
--> statement-breakpoint
ALTER TABLE `food_portions` DROP COLUMN `confidence`;
--> statement-breakpoint
ALTER TABLE `food_portions` DROP COLUMN `status`;
--> statement-breakpoint
ALTER TABLE `food_portions` DROP COLUMN `valid_from`;
--> statement-breakpoint
ALTER TABLE `food_portions` DROP COLUMN `valid_to`;
--> statement-breakpoint
ALTER TABLE `user_food_favorites` DROP COLUMN `food_variant_id`;
--> statement-breakpoint
ALTER TABLE `user_food_usage_stats` DROP COLUMN `food_variant_id`;
--> statement-breakpoint
ALTER TABLE `mealItems` DROP COLUMN `foodVariantId`;
--> statement-breakpoint
ALTER TABLE `mealItems` DROP COLUMN `nutritionProfileId`;
--> statement-breakpoint
ALTER TABLE `mealItems` DROP COLUMN `foodPortionId`;
--> statement-breakpoint
DROP TABLE `food_resolution_events`;
--> statement-breakpoint
DROP TABLE `food_attribute_materiality_overrides`;
--> statement-breakpoint
DROP TABLE `food_attribute_materiality`;
--> statement-breakpoint
DROP TABLE `food_variant_attributes`;
--> statement-breakpoint
DROP TABLE `food_attributes`;
--> statement-breakpoint
DROP TABLE `user_food_lexicon_entries`;
--> statement-breakpoint
DROP TABLE `food_lexicon_entries`;
--> statement-breakpoint
DROP TABLE `food_review_events`;
--> statement-breakpoint
DROP TABLE `food_review_cases`;
--> statement-breakpoint
DROP TABLE `food_barcodes`;
--> statement-breakpoint
DROP TABLE `user_food_aliases`;
--> statement-breakpoint
DROP TABLE `food_variant_classifications`;
--> statement-breakpoint
DROP TABLE `food_nutrition_profiles`;
--> statement-breakpoint
DROP TABLE `food_variant_sources`;
--> statement-breakpoint
DROP TABLE `food_evidence`;
--> statement-breakpoint
DROP TABLE `food_variants`;
--> statement-breakpoint
