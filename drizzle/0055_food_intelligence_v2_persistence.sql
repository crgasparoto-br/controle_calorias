-- #1301 additive V2 persistence; do not drop or modify historical meal snapshots.
-- The legacy catalog remains operational until the separately approved cutover.
-- V1 writers omit canonical_name/key/scope; leave newly inserted legacy rows NULL (ineligible to V2)
-- until an explicit reconciliation step before activating V2 reads. Existing rows get a stable backfill.
ALTER TABLE `foods` ADD COLUMN `scope` enum('global','user') NULL;
--> statement-breakpoint
ALTER TABLE `foods` ADD COLUMN `canonical_name` varchar(255) NULL;
--> statement-breakpoint
ALTER TABLE `foods` ADD COLUMN `canonical_key` varchar(191) NULL;
--> statement-breakpoint
ALTER TABLE `food_aliases` ADD COLUMN `food_variant_id` int NULL;
--> statement-breakpoint
ALTER TABLE `food_aliases` ADD COLUMN `locale` varchar(20) NOT NULL DEFAULT 'pt-BR';
--> statement-breakpoint
ALTER TABLE `food_aliases` ADD COLUMN `status` enum('active','deprecated') NOT NULL DEFAULT 'active';
--> statement-breakpoint
ALTER TABLE `food_aliases` ADD COLUMN `governance_status` enum('provisional','pending_review','verified','rejected','revoked') NOT NULL DEFAULT 'provisional';
--> statement-breakpoint
ALTER TABLE `food_aliases` ADD COLUMN `revision` int NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `food_aliases` ADD COLUMN `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;
--> statement-breakpoint
ALTER TABLE `food_portions` ADD COLUMN `food_variant_id` int NULL;
--> statement-breakpoint
ALTER TABLE `food_portions` ADD COLUMN `milliliters` double NULL;
--> statement-breakpoint
ALTER TABLE `food_portions` ADD COLUMN `measure_kind` enum('exact','usual_average','contextual_estimate') NOT NULL DEFAULT 'usual_average';
--> statement-breakpoint
ALTER TABLE `food_portions` ADD COLUMN `evidence_id` int NULL;
--> statement-breakpoint
ALTER TABLE `food_portions` ADD COLUMN `confidence` double NULL;
--> statement-breakpoint
ALTER TABLE `food_portions` ADD COLUMN `status` enum('provisional','pending_review','verified','rejected','revoked') NOT NULL DEFAULT 'provisional';
--> statement-breakpoint
ALTER TABLE `food_portions` ADD COLUMN `valid_from` timestamp NULL;
--> statement-breakpoint
ALTER TABLE `food_portions` ADD COLUMN `valid_to` timestamp NULL;
--> statement-breakpoint
ALTER TABLE `user_food_favorites` ADD COLUMN `food_variant_id` int NULL;
--> statement-breakpoint
ALTER TABLE `user_food_usage_stats` ADD COLUMN `food_variant_id` int NULL;
--> statement-breakpoint
ALTER TABLE `mealItems` ADD COLUMN `foodVariantId` int NULL;
--> statement-breakpoint
ALTER TABLE `mealItems` ADD COLUMN `nutritionProfileId` int NULL;
--> statement-breakpoint
ALTER TABLE `mealItems` ADD COLUMN `foodPortionId` int NULL;
--> statement-breakpoint
UPDATE `foods` SET `canonical_name`=`name`,`canonical_key`=CONCAT('legacy:food:',`id`),`scope`=IF(`owner_user_id` IS NULL,'global','user') WHERE `canonical_key` IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `v2_foods_u0` ON `foods` (`canonical_key`);
--> statement-breakpoint
CREATE UNIQUE INDEX `v2_food_aliases_u0` ON `food_aliases` (`food_variant_id`,`normalized_alias`);
--> statement-breakpoint
CREATE INDEX `v2_food_aliases_i0` ON `food_aliases` (`normalized_alias`,`status`);
--> statement-breakpoint
CREATE UNIQUE INDEX `v2_food_portions_u0` ON `food_portions` (`food_variant_id`,`normalized_label`,`unit`);
--> statement-breakpoint
CREATE INDEX `v2_food_portions_i0` ON `food_portions` (`food_variant_id`,`status`);
--> statement-breakpoint
CREATE UNIQUE INDEX `v2_user_food_favorit_u0` ON `user_food_favorites` (`user_id`,`food_variant_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `v2_user_food_usage_s_u0` ON `user_food_usage_stats` (`user_id`,`food_variant_id`);
--> statement-breakpoint
CREATE INDEX `v2_mealItems_i0` ON `mealItems` (`foodVariantId`);
--> statement-breakpoint
CREATE INDEX `v2_mealItems_i1` ON `mealItems` (`nutritionProfileId`);
--> statement-breakpoint
CREATE INDEX `v2_mealItems_i2` ON `mealItems` (`foodPortionId`);
--> statement-breakpoint
CREATE TABLE `food_variants` (
  `id` int AUTO_INCREMENT NOT NULL,
  `food_id` int NOT NULL,
  `brand_id` int NULL,
  `variant_type` enum('generic','branded','custom') NOT NULL,
  `display_name` varchar(255) NOT NULL,
  `normalized_name` varchar(255) NOT NULL,
  `variant_name` varchar(255) NULL,
  `preparation` varchar(255) NULL,
  `qualifiers_json` text NULL,
  `identity_key` varchar(191) NOT NULL,
  `status` enum('draft','active','deprecated','merged') NOT NULL DEFAULT 'draft',
  `governance_status` enum('provisional','pending_review','verified','rejected','revoked') NOT NULL DEFAULT 'provisional',
  `revision` int NOT NULL DEFAULT '1',
  `merged_into_variant_id` int NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `food_variants_u0` ON `food_variants` (`identity_key`);
--> statement-breakpoint
CREATE INDEX `food_variants_i0` ON `food_variants` (`food_id`,`status`);
--> statement-breakpoint
CREATE TABLE `food_variant_sources` (
  `id` int AUTO_INCREMENT NOT NULL,
  `food_variant_id` int NOT NULL,
  `source_id` int NOT NULL,
  `source_item_code` varchar(120) NULL,
  `source_identity_key` varchar(191) NOT NULL,
  `source_url` varchar(500) NULL,
  `status` enum('active','deprecated') NOT NULL DEFAULT 'active',
  `first_seen_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `last_seen_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `food_variant_sources_u0` ON `food_variant_sources` (`source_identity_key`);
--> statement-breakpoint
CREATE UNIQUE INDEX `food_variant_sources_u1` ON `food_variant_sources` (`source_id`,`source_item_code`);
--> statement-breakpoint
CREATE INDEX `food_variant_sources_i0` ON `food_variant_sources` (`food_variant_id`);
--> statement-breakpoint
CREATE TABLE `food_nutrition_profiles` (
  `id` int AUTO_INCREMENT NOT NULL,
  `food_variant_id` int NOT NULL,
  `source_id` int NOT NULL,
  `food_variant_source_id` int NULL,
  `profile_key` varchar(191) NOT NULL,
  `version` int NOT NULL,
  `status` enum('provisional','pending_review','verified','rejected','revoked') NOT NULL DEFAULT 'provisional',
  `basis_quantity` double NOT NULL,
  `basis_unit` enum('g','ml','serving') NOT NULL,
  `calories_kcal` double NOT NULL,
  `protein_g` double NOT NULL,
  `carb_g` double NOT NULL,
  `fat_g` double NOT NULL,
  `fiber_g` double NULL,
  `sugar_g` double NULL,
  `sodium_mg` double NULL,
  `nutrients_json` text NULL,
  `source_serving_quantity` double NULL,
  `source_serving_unit` varchar(40) NULL,
  `source_serving_grams` double NULL,
  `content_hash` varchar(64) NOT NULL,
  `supersedes_profile_id` int NULL,
  `current_slot` int NULL,
  `valid_from` timestamp NULL,
  `valid_to` timestamp NULL,
  `collected_at` timestamp NULL,
  `verified_at` timestamp NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `food_nutrition_profi_u0` ON `food_nutrition_profiles` (`profile_key`,`version`);
--> statement-breakpoint
CREATE UNIQUE INDEX `food_nutrition_profi_u1` ON `food_nutrition_profiles` (`profile_key`,`current_slot`);
--> statement-breakpoint
CREATE INDEX `food_nutrition_profi_i0` ON `food_nutrition_profiles` (`food_variant_id`,`status`);
--> statement-breakpoint
CREATE TABLE `food_variant_classifications` (
  `id` int AUTO_INCREMENT NOT NULL,
  `food_variant_id` int NOT NULL,
  `version` int NOT NULL,
  `processing_level` enum('natural_or_minimally_processed','processed_culinary_ingredient','processed','ultra_processed') NULL,
  `is_fruit` int NOT NULL DEFAULT '0',
  `is_vegetable` int NOT NULL DEFAULT '0',
  `is_ultra_processed` int NOT NULL DEFAULT '0',
  `source_id` int NULL,
  `source_kind` varchar(60) NOT NULL,
  `confidence` double NULL,
  `status` enum('provisional','pending_review','verified','rejected','revoked') NOT NULL DEFAULT 'provisional',
  `supersedes_classification_id` int NULL,
  `current_slot` int NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `food_variant_classif_u0` ON `food_variant_classifications` (`food_variant_id`,`version`);
--> statement-breakpoint
CREATE UNIQUE INDEX `food_variant_classif_u1` ON `food_variant_classifications` (`food_variant_id`,`current_slot`);
--> statement-breakpoint
CREATE INDEX `food_variant_classif_i0` ON `food_variant_classifications` (`food_variant_id`,`status`);
--> statement-breakpoint
CREATE TABLE `user_food_aliases` (
  `id` int AUTO_INCREMENT NOT NULL,
  `user_id` int NOT NULL,
  `food_variant_id` int NOT NULL,
  `alias` varchar(255) NOT NULL,
  `normalized_alias` varchar(191) NOT NULL,
  `source` enum('user_confirmed','imported','system_suggested') NOT NULL,
  `confidence` double NULL,
  `status` enum('active','revoked') NOT NULL DEFAULT 'active',
  `current_slot` int NULL DEFAULT '1',
  `confirmed_at` timestamp NULL,
  `revoked_at` timestamp NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_food_aliases_u0` ON `user_food_aliases` (`user_id`,`normalized_alias`,`current_slot`);
--> statement-breakpoint
CREATE INDEX `user_food_aliases_i0` ON `user_food_aliases` (`user_id`,`normalized_alias`,`status`);
--> statement-breakpoint
CREATE TABLE `food_barcodes` (
  `id` int AUTO_INCREMENT NOT NULL,
  `food_variant_id` int NOT NULL,
  `barcode` varchar(64) NOT NULL,
  `package_quantity` double NULL,
  `package_unit` varchar(40) NULL,
  `source_id` int NULL,
  `evidence_id` int NULL,
  `status` enum('active','revoked') NOT NULL DEFAULT 'active',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `food_barcodes_u0` ON `food_barcodes` (`barcode`);
--> statement-breakpoint
CREATE INDEX `food_barcodes_i0` ON `food_barcodes` (`food_variant_id`);
--> statement-breakpoint
CREATE TABLE `food_evidence` (
  `id` int AUTO_INCREMENT NOT NULL,
  `subject_key` varchar(191) NOT NULL,
  `food_variant_id` int NULL,
  `evidence_type` enum('nutrition_label','ocr','barcode','manufacturer','official_source','external_source','user_correction','image') NOT NULL,
  `source_id` int NULL,
  `owner_user_id` int NULL,
  `source_reference` varchar(500) NULL,
  `content_hash` varchar(64) NOT NULL,
  `payload_json` text NOT NULL,
  `confidence` double NULL,
  `captured_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `retention_until` timestamp NULL,
  `retention_guard` int GENERATED ALWAYS AS (CASE WHEN owner_user_id IS NOT NULL AND retention_until IS NULL THEN NULL ELSE 1 END) VIRTUAL NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
);
--> statement-breakpoint
CREATE INDEX `food_evidence_i0` ON `food_evidence` (`subject_key`);
--> statement-breakpoint
CREATE INDEX `food_evidence_i1` ON `food_evidence` (`content_hash`);
--> statement-breakpoint
CREATE INDEX `food_evidence_i2` ON `food_evidence` (`retention_until`);
--> statement-breakpoint
CREATE TABLE `food_review_cases` (
  `id` int AUTO_INCREMENT NOT NULL,
  `case_key` varchar(191) NOT NULL,
  `case_type` varchar(80) NOT NULL,
  `status` enum('open','in_review','closed') NOT NULL DEFAULT 'open',
  `outcome` enum('approved','rejected','revoked','superseded','no_change') NULL,
  `review_cycle` int NOT NULL DEFAULT '1',
  `state_version` int NOT NULL DEFAULT '1',
  `cycle_opened_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `closed_at` timestamp NULL,
  `assigned_reviewer_id` int NULL,
  `superseded_by_case_id` int NULL,
  `supersession_guard` int GENERATED ALWAYS AS (CASE WHEN outcome='superseded' AND superseded_by_case_id IS NULL THEN NULL ELSE 1 END) VIRTUAL NOT NULL,
  `priority_score` double NOT NULL DEFAULT '0',
  `priority_snapshot_json` text NULL,
  `policy_version` varchar(100) NULL,
  `evaluation_at` timestamp NULL,
  `deadline_at` timestamp NULL,
  `occurrence_count` int NOT NULL DEFAULT '1',
  `distinct_user_count` int NOT NULL DEFAULT '0',
  `first_seen_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `last_seen_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `target_artifact_type` varchar(80) NOT NULL,
  `target_artifact_id` varchar(100) NOT NULL,
  `target_revision` int NOT NULL,
  `target_content_hash` varchar(64) NOT NULL,
  `proposed_payload_json` text NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `food_review_cases_u0` ON `food_review_cases` (`case_key`);
--> statement-breakpoint
CREATE INDEX `food_review_cases_i0` ON `food_review_cases` (`status`,`priority_score`);
--> statement-breakpoint
CREATE TABLE `food_review_events` (
  `id` int AUTO_INCREMENT NOT NULL,
  `case_id` int NOT NULL,
  `review_cycle` int NOT NULL,
  `request_key` varchar(191) NOT NULL,
  `action` varchar(60) NOT NULL,
  `actor_id` varchar(120) NOT NULL,
  `previous_status` varchar(30) NULL,
  `new_status` varchar(30) NOT NULL,
  `outcome` varchar(30) NULL,
  `target_artifact_type` varchar(80) NOT NULL,
  `target_artifact_id` varchar(100) NOT NULL,
  `target_revision` int NOT NULL,
  `target_content_hash` varchar(64) NOT NULL,
  `evidence_ids_json` text NULL,
  `request_hash` varchar(64) NOT NULL,
  `reason` text NULL,
  `policy_version` varchar(100) NOT NULL,
  `occurred_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `food_review_events_u0` ON `food_review_events` (`case_id`,`review_cycle`,`request_key`);
--> statement-breakpoint
CREATE INDEX `food_review_events_i0` ON `food_review_events` (`case_id`,`review_cycle`,`occurred_at`);
--> statement-breakpoint
CREATE TABLE `food_resolution_events` (
  `id` bigint AUTO_INCREMENT NOT NULL,
  `trace_id` varchar(120) NOT NULL,
  `user_id` int NULL,
  `modality` varchar(40) NOT NULL,
  `entrypoint` varchar(100) NOT NULL,
  `resolution_status` varchar(50) NOT NULL,
  `food_variant_id` int NULL,
  `nutrition_profile_id` int NULL,
  `food_portion_id` int NULL,
  `fallback_reason` varchar(100) NULL,
  `clarification_reason` varchar(100) NULL,
  `resolver_version` varchar(100) NOT NULL,
  `policy_version` varchar(100) NOT NULL,
  `input_hash` varchar(64) NOT NULL,
  `decision_json` text NOT NULL,
  `expires_at` timestamp NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `food_resolution_even_u0` ON `food_resolution_events` (`trace_id`);
--> statement-breakpoint
CREATE INDEX `food_resolution_even_i0` ON `food_resolution_events` (`expires_at`);
--> statement-breakpoint
CREATE TABLE `food_lexicon_entries` (
  `id` int AUTO_INCREMENT NOT NULL,
  `term` varchar(255) NOT NULL,
  `normalized_term` varchar(160) NOT NULL,
  `kind` enum('slang','abbreviation','regionalism','typo','alias_surface','portion_term','unit_term','protected_token') NOT NULL,
  `target_type` enum('canonical_term','food_variant','none') NOT NULL,
  `target_ref` varchar(160) NULL,
  `scope` enum('global') NOT NULL DEFAULT 'global',
  `locale` varchar(20) NOT NULL DEFAULT 'pt-BR',
  `source_id` int NULL,
  `evidence_id` int NULL,
  `confidence` double NULL,
  `requires_clarification` int NOT NULL DEFAULT '0',
  `status` enum('provisional','pending_review','verified','rejected','revoked') NOT NULL DEFAULT 'provisional',
  `current_slot` int NULL,
  `supersedes_id` int NULL,
  `valid_from` timestamp NULL,
  `valid_to` timestamp NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `food_lexicon_entries_u0` ON `food_lexicon_entries` (`locale`,`normalized_term`,`kind`,`current_slot`);
--> statement-breakpoint
CREATE INDEX `food_lexicon_entries_i0` ON `food_lexicon_entries` (`locale`,`normalized_term`,`kind`,`status`);
--> statement-breakpoint
CREATE TABLE `user_food_lexicon_entries` (
  `id` int AUTO_INCREMENT NOT NULL,
  `user_id` int NOT NULL,
  `term` varchar(255) NOT NULL,
  `normalized_term` varchar(160) NOT NULL,
  `kind` enum('slang','abbreviation','regionalism','typo','alias_surface','portion_term','unit_term','protected_token') NOT NULL,
  `target_type` enum('canonical_term','food_variant','none') NOT NULL,
  `target_ref` varchar(160) NULL,
  `locale` varchar(20) NOT NULL DEFAULT 'pt-BR',
  `source` enum('user_confirmed','imported','system_suggested') NOT NULL,
  `confidence` double NULL,
  `status` enum('active','revoked') NOT NULL DEFAULT 'active',
  `current_slot` int NULL DEFAULT '1',
  `confirmed_at` timestamp NULL,
  `revoked_at` timestamp NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_food_lexicon_en_u0` ON `user_food_lexicon_entries` (`user_id`,`locale`,`normalized_term`,`kind`,`current_slot`);
--> statement-breakpoint
CREATE INDEX `user_food_lexicon_en_i0` ON `user_food_lexicon_entries` (`user_id`,`locale`,`normalized_term`,`kind`,`status`);
--> statement-breakpoint
CREATE TABLE `food_attributes` (
  `id` int AUTO_INCREMENT NOT NULL,
  `code` varchar(100) NOT NULL,
  `label` varchar(160) NOT NULL,
  `value_kind` enum('enumerated','free_text') NOT NULL,
  `is_indexed` int NOT NULL DEFAULT '0',
  `status` enum('active','deprecated','merged') NOT NULL DEFAULT 'active',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `food_attributes_u0` ON `food_attributes` (`code`);
--> statement-breakpoint
CREATE TABLE `food_variant_attributes` (
  `id` int AUTO_INCREMENT NOT NULL,
  `food_variant_id` int NOT NULL,
  `attribute_id` int NOT NULL,
  `value` varchar(255) NOT NULL,
  `normalized_value` varchar(191) NOT NULL,
  `source_id` int NULL,
  `evidence_id` int NULL,
  `confidence` double NULL,
  `status` enum('provisional','pending_review','verified','rejected','revoked') NOT NULL DEFAULT 'provisional',
  `current_slot` int NULL,
  `supersedes_id` int NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `food_variant_attribu_u0` ON `food_variant_attributes` (`food_variant_id`,`attribute_id`,`current_slot`);
--> statement-breakpoint
CREATE INDEX `food_variant_attribu_i0` ON `food_variant_attributes` (`food_variant_id`,`attribute_id`,`normalized_value`,`status`);
--> statement-breakpoint
CREATE TABLE `food_attribute_materiality` (
  `id` int AUTO_INCREMENT NOT NULL,
  `food_id` int NOT NULL,
  `attribute_id` int NOT NULL,
  `materiality` enum('identity','nutrition','both','informational') NOT NULL,
  `derivation` enum('from_variants','from_profile_divergence','override') NOT NULL,
  `evidence_id` int NULL,
  `confidence` double NULL,
  `status` enum('provisional','pending_review','verified','rejected','revoked') NOT NULL DEFAULT 'provisional',
  `current_slot` int NULL,
  `supersedes_id` int NULL,
  `valid_from` timestamp NULL,
  `valid_to` timestamp NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `food_attribute_mater_u0` ON `food_attribute_materiality` (`food_id`,`attribute_id`,`current_slot`);
--> statement-breakpoint
CREATE INDEX `food_attribute_mater_i0` ON `food_attribute_materiality` (`food_id`,`status`);
--> statement-breakpoint
CREATE TABLE `food_attribute_materiality_overrides` (
  `id` int AUTO_INCREMENT NOT NULL,
  `food_id` int NOT NULL,
  `attribute_id` int NOT NULL,
  `materiality` enum('identity','nutrition','both','informational') NOT NULL,
  `justification` text NOT NULL,
  `evidence_id` int NULL,
  `author` varchar(120) NOT NULL,
  `status` enum('active','revoked') NOT NULL DEFAULT 'active',
  `current_slot` int NULL DEFAULT '1',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `food_attr_override_u0` ON `food_attribute_materiality_overrides` (`food_id`,`attribute_id`,`current_slot`);
--> statement-breakpoint
ALTER TABLE `food_variants` ADD CONSTRAINT `food_variants_food_id_foods_id_fk` FOREIGN KEY (`food_id`) REFERENCES `foods`(`id`) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE `food_variants` ADD CONSTRAINT `food_variants_brand_id_foodBrands_id_fk` FOREIGN KEY (`brand_id`) REFERENCES `foodBrands`(`id`) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE `food_variants` ADD CONSTRAINT `food_variants_merged_into_variant_id_food_variants_id_fk` FOREIGN KEY (`merged_into_variant_id`) REFERENCES `food_variants`(`id`) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE `food_variant_sources` ADD CONSTRAINT `food_variant_sources_food_variant_id_food_variants_id_fk` FOREIGN KEY (`food_variant_id`) REFERENCES `food_variants`(`id`) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE `food_variant_sources` ADD CONSTRAINT `food_variant_sources_source_id_food_sources_id_fk` FOREIGN KEY (`source_id`) REFERENCES `food_sources`(`id`) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE `food_nutrition_profiles` ADD CONSTRAINT `food_nutrition_profiles_food_variant_id_food_variants_id_fk` FOREIGN KEY (`food_variant_id`) REFERENCES `food_variants`(`id`) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE `food_nutrition_profiles` ADD CONSTRAINT `food_nutrition_profiles_source_id_food_sources_id_fk` FOREIGN KEY (`source_id`) REFERENCES `food_sources`(`id`) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE `food_nutrition_profiles` ADD CONSTRAINT `fnp_variant_source_fk` FOREIGN KEY (`food_variant_source_id`) REFERENCES `food_variant_sources`(`id`) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE `food_nutrition_profiles` ADD CONSTRAINT `fnp_supersedes_fk` FOREIGN KEY (`supersedes_profile_id`) REFERENCES `food_nutrition_profiles`(`id`) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE `food_variant_classifications` ADD CONSTRAINT `food_variant_classifications_food_variant_id_food_variants_id_fk` FOREIGN KEY (`food_variant_id`) REFERENCES `food_variants`(`id`) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE `food_variant_classifications` ADD CONSTRAINT `food_variant_classifications_source_id_food_sources_id_fk` FOREIGN KEY (`source_id`) REFERENCES `food_sources`(`id`) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE `food_variant_classifications` ADD CONSTRAINT `fvc_supersedes_fk` FOREIGN KEY (`supersedes_classification_id`) REFERENCES `food_variant_classifications`(`id`) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE `user_food_aliases` ADD CONSTRAINT `user_food_aliases_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE `user_food_aliases` ADD CONSTRAINT `user_food_aliases_food_variant_id_food_variants_id_fk` FOREIGN KEY (`food_variant_id`) REFERENCES `food_variants`(`id`) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE `food_barcodes` ADD CONSTRAINT `food_barcodes_food_variant_id_food_variants_id_fk` FOREIGN KEY (`food_variant_id`) REFERENCES `food_variants`(`id`) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE `food_barcodes` ADD CONSTRAINT `food_barcodes_source_id_food_sources_id_fk` FOREIGN KEY (`source_id`) REFERENCES `food_sources`(`id`) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE `food_barcodes` ADD CONSTRAINT `food_barcodes_evidence_id_food_evidence_id_fk` FOREIGN KEY (`evidence_id`) REFERENCES `food_evidence`(`id`) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE `food_evidence` ADD CONSTRAINT `food_evidence_food_variant_id_food_variants_id_fk` FOREIGN KEY (`food_variant_id`) REFERENCES `food_variants`(`id`) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE `food_evidence` ADD CONSTRAINT `food_evidence_source_id_food_sources_id_fk` FOREIGN KEY (`source_id`) REFERENCES `food_sources`(`id`) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE `food_evidence` ADD CONSTRAINT `food_evidence_owner_user_id_users_id_fk` FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE `food_review_cases` ADD CONSTRAINT `food_review_cases_assigned_reviewer_id_users_id_fk` FOREIGN KEY (`assigned_reviewer_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE `food_review_cases` ADD CONSTRAINT `food_review_cases_superseded_by_case_id_food_review_cases_id_fk` FOREIGN KEY (`superseded_by_case_id`) REFERENCES `food_review_cases`(`id`) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE `food_review_events` ADD CONSTRAINT `food_review_events_case_id_food_review_cases_id_fk` FOREIGN KEY (`case_id`) REFERENCES `food_review_cases`(`id`) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE `food_resolution_events` ADD CONSTRAINT `food_resolution_events_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE `food_resolution_events` ADD CONSTRAINT `food_resolution_events_food_variant_id_food_variants_id_fk` FOREIGN KEY (`food_variant_id`) REFERENCES `food_variants`(`id`) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE `food_resolution_events` ADD CONSTRAINT `fre_nutrition_profile_fk` FOREIGN KEY (`nutrition_profile_id`) REFERENCES `food_nutrition_profiles`(`id`) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE `food_resolution_events` ADD CONSTRAINT `food_resolution_events_food_portion_id_food_portions_id_fk` FOREIGN KEY (`food_portion_id`) REFERENCES `food_portions`(`id`) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE `food_lexicon_entries` ADD CONSTRAINT `food_lexicon_entries_source_id_food_sources_id_fk` FOREIGN KEY (`source_id`) REFERENCES `food_sources`(`id`) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE `food_lexicon_entries` ADD CONSTRAINT `food_lexicon_entries_evidence_id_food_evidence_id_fk` FOREIGN KEY (`evidence_id`) REFERENCES `food_evidence`(`id`) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE `food_lexicon_entries` ADD CONSTRAINT `food_lexicon_entries_supersedes_id_food_lexicon_entries_id_fk` FOREIGN KEY (`supersedes_id`) REFERENCES `food_lexicon_entries`(`id`) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE `user_food_lexicon_entries` ADD CONSTRAINT `user_food_lexicon_entries_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE `food_variant_attributes` ADD CONSTRAINT `food_variant_attributes_food_variant_id_food_variants_id_fk` FOREIGN KEY (`food_variant_id`) REFERENCES `food_variants`(`id`) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE `food_variant_attributes` ADD CONSTRAINT `food_variant_attributes_attribute_id_food_attributes_id_fk` FOREIGN KEY (`attribute_id`) REFERENCES `food_attributes`(`id`) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE `food_variant_attributes` ADD CONSTRAINT `food_variant_attributes_source_id_food_sources_id_fk` FOREIGN KEY (`source_id`) REFERENCES `food_sources`(`id`) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE `food_variant_attributes` ADD CONSTRAINT `food_variant_attributes_evidence_id_food_evidence_id_fk` FOREIGN KEY (`evidence_id`) REFERENCES `food_evidence`(`id`) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE `food_variant_attributes` ADD CONSTRAINT `fva_supersedes_fk` FOREIGN KEY (`supersedes_id`) REFERENCES `food_variant_attributes`(`id`) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE `food_attribute_materiality` ADD CONSTRAINT `food_attribute_materiality_food_id_foods_id_fk` FOREIGN KEY (`food_id`) REFERENCES `foods`(`id`) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE `food_attribute_materiality` ADD CONSTRAINT `food_attribute_materiality_attribute_id_food_attributes_id_fk` FOREIGN KEY (`attribute_id`) REFERENCES `food_attributes`(`id`) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE `food_attribute_materiality` ADD CONSTRAINT `food_attribute_materiality_evidence_id_food_evidence_id_fk` FOREIGN KEY (`evidence_id`) REFERENCES `food_evidence`(`id`) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE `food_attribute_materiality` ADD CONSTRAINT `fam_supersedes_fk` FOREIGN KEY (`supersedes_id`) REFERENCES `food_attribute_materiality`(`id`) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE `food_attribute_materiality_overrides` ADD CONSTRAINT `food_attribute_materiality_overrides_food_id_foods_id_fk` FOREIGN KEY (`food_id`) REFERENCES `foods`(`id`) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE `food_attribute_materiality_overrides` ADD CONSTRAINT `famo_attribute_fk` FOREIGN KEY (`attribute_id`) REFERENCES `food_attributes`(`id`) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE `food_attribute_materiality_overrides` ADD CONSTRAINT `famo_evidence_fk` FOREIGN KEY (`evidence_id`) REFERENCES `food_evidence`(`id`) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE `food_aliases` ADD CONSTRAINT `food_aliases_food_variant_id_food_variants_id_fk` FOREIGN KEY (`food_variant_id`) REFERENCES `food_variants`(`id`) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE `food_portions` ADD CONSTRAINT `food_portions_food_variant_id_food_variants_id_fk` FOREIGN KEY (`food_variant_id`) REFERENCES `food_variants`(`id`) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE `food_portions` ADD CONSTRAINT `food_portions_evidence_id_food_evidence_id_fk` FOREIGN KEY (`evidence_id`) REFERENCES `food_evidence`(`id`) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE `user_food_favorites` ADD CONSTRAINT `user_food_favorites_food_variant_id_food_variants_id_fk` FOREIGN KEY (`food_variant_id`) REFERENCES `food_variants`(`id`) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE `user_food_usage_stats` ADD CONSTRAINT `user_food_usage_stats_food_variant_id_food_variants_id_fk` FOREIGN KEY (`food_variant_id`) REFERENCES `food_variants`(`id`) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE `mealItems` ADD CONSTRAINT `mealItems_foodVariantId_food_variants_id_fk` FOREIGN KEY (`foodVariantId`) REFERENCES `food_variants`(`id`) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE `mealItems` ADD CONSTRAINT `mealItems_nutritionProfileId_food_nutrition_profiles_id_fk` FOREIGN KEY (`nutritionProfileId`) REFERENCES `food_nutrition_profiles`(`id`) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE `mealItems` ADD CONSTRAINT `mealItems_foodPortionId_food_portions_id_fk` FOREIGN KEY (`foodPortionId`) REFERENCES `food_portions`(`id`) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE `food_variants` ADD CONSTRAINT `food_variants_ck0` CHECK (revision > 0);
--> statement-breakpoint
ALTER TABLE `food_nutrition_profiles` ADD CONSTRAINT `food_nutrition_profiles_ck0` CHECK (version > 0);
--> statement-breakpoint
ALTER TABLE `food_nutrition_profiles` ADD CONSTRAINT `food_nutrition_profiles_ck1` CHECK (basis_quantity > 0);
--> statement-breakpoint
ALTER TABLE `food_nutrition_profiles` ADD CONSTRAINT `food_nutrition_profiles_ck2` CHECK (calories_kcal >= 0);
--> statement-breakpoint
ALTER TABLE `food_nutrition_profiles` ADD CONSTRAINT `food_nutrition_profiles_ck3` CHECK (protein_g >= 0);
--> statement-breakpoint
ALTER TABLE `food_nutrition_profiles` ADD CONSTRAINT `food_nutrition_profiles_ck4` CHECK (carb_g >= 0);
--> statement-breakpoint
ALTER TABLE `food_nutrition_profiles` ADD CONSTRAINT `food_nutrition_profiles_ck5` CHECK (fat_g >= 0);
--> statement-breakpoint
ALTER TABLE `food_nutrition_profiles` ADD CONSTRAINT `food_nutrition_profiles_ck6` CHECK (current_slot IS NULL OR current_slot = 1);
--> statement-breakpoint
ALTER TABLE `food_nutrition_profiles` ADD CONSTRAINT `food_nutrition_profiles_ck7` CHECK (current_slot IS NULL OR valid_to IS NULL);
--> statement-breakpoint
ALTER TABLE `food_variant_classifications` ADD CONSTRAINT `food_variant_classifica_ck0` CHECK (version > 0);
--> statement-breakpoint
ALTER TABLE `food_variant_classifications` ADD CONSTRAINT `food_variant_classifica_ck1` CHECK (current_slot IS NULL OR current_slot=1);
--> statement-breakpoint
ALTER TABLE `user_food_aliases` ADD CONSTRAINT `user_food_aliases_ck0` CHECK ((status='active' AND current_slot=1 AND revoked_at IS NULL) OR (status='revoked' AND current_slot IS NULL));
--> statement-breakpoint
ALTER TABLE `food_review_cases` ADD CONSTRAINT `food_review_cases_ck0` CHECK (review_cycle > 0);
--> statement-breakpoint
ALTER TABLE `food_review_cases` ADD CONSTRAINT `food_review_cases_ck1` CHECK (state_version > 0);
--> statement-breakpoint
ALTER TABLE `food_review_cases` ADD CONSTRAINT `food_review_cases_ck2` CHECK ((status='closed' AND outcome IS NOT NULL AND closed_at IS NOT NULL) OR (status IN ('open','in_review') AND outcome IS NULL AND closed_at IS NULL));

--> statement-breakpoint
ALTER TABLE `food_review_events` ADD CONSTRAINT `food_review_events_ck0` CHECK (review_cycle > 0);
--> statement-breakpoint
ALTER TABLE `food_lexicon_entries` ADD CONSTRAINT `food_lexicon_entries_ck0` CHECK (current_slot IS NULL OR current_slot = 1);
--> statement-breakpoint
ALTER TABLE `user_food_lexicon_entries` ADD CONSTRAINT `user_food_lexicon_entri_ck0` CHECK ((status='active' AND current_slot=1 AND revoked_at IS NULL) OR (status='revoked' AND current_slot IS NULL));
--> statement-breakpoint
ALTER TABLE `food_variant_attributes` ADD CONSTRAINT `food_variant_attributes_ck0` CHECK (current_slot IS NULL OR current_slot = 1);
--> statement-breakpoint
ALTER TABLE `food_attribute_materiality` ADD CONSTRAINT `food_attribute_material_ck0` CHECK (current_slot IS NULL OR current_slot = 1);
--> statement-breakpoint
ALTER TABLE `food_attribute_materiality_overrides` ADD CONSTRAINT `food_attr_override_ck0` CHECK ((status='active' AND current_slot=1) OR (status='revoked' AND current_slot IS NULL));
--> statement-breakpoint
ALTER TABLE `food_aliases` ADD CONSTRAINT `v2_food_aliases_ck0` CHECK (revision > 0);
--> statement-breakpoint
