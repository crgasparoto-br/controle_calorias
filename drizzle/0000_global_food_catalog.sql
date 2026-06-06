CREATE TABLE `food_sources` (
  `id` int AUTO_INCREMENT NOT NULL,
  `slug` varchar(80) NOT NULL,
  `name` varchar(160) NOT NULL,
  `version` varchar(80) NOT NULL,
  `country_code` varchar(2),
  `source_url` varchar(255),
  `notes` text,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `food_sources_id` PRIMARY KEY(`id`),
  CONSTRAINT `food_sources_slug_version_unique` UNIQUE(`slug`, `version`)
);
--> statement-breakpoint
CREATE TABLE `foods` (
  `id` int AUTO_INCREMENT NOT NULL,
  `owner_user_id` int,
  `source_id` int,
  `source_food_code` varchar(120),
  `name` varchar(255) NOT NULL,
  `normalized_name` varchar(255) NOT NULL,
  `brand_name` varchar(255),
  `category` varchar(160),
  `description` text,
  `status` enum('active','deprecated','merged') NOT NULL DEFAULT 'active',
  `merged_into_food_id` int,
  `calories_kcal_per_100g` double NOT NULL,
  `protein_grams_per_100g` double NOT NULL,
  `carbs_grams_per_100g` double NOT NULL,
  `fat_grams_per_100g` double NOT NULL,
  `fiber_grams_per_100g` double,
  `sugar_grams_per_100g` double,
  `sodium_mg_per_100g` double,
  `nutrients_json` text,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `foods_id` PRIMARY KEY(`id`),
  CONSTRAINT `foods_source_code_unique` UNIQUE(`source_id`, `source_food_code`)
);
--> statement-breakpoint
CREATE TABLE `food_aliases` (
  `id` int AUTO_INCREMENT NOT NULL,
  `food_id` int NOT NULL,
  `alias` varchar(255) NOT NULL,
  `normalized_alias` varchar(255) NOT NULL,
  `source_id` int,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `food_aliases_id` PRIMARY KEY(`id`),
  CONSTRAINT `food_aliases_food_alias_unique` UNIQUE(`food_id`, `normalized_alias`)
);
--> statement-breakpoint
CREATE TABLE `food_portions` (
  `id` int AUTO_INCREMENT NOT NULL,
  `food_id` int NOT NULL,
  `label` varchar(120) NOT NULL,
  `normalized_label` varchar(120) NOT NULL,
  `unit` varchar(40) NOT NULL DEFAULT 'serving',
  `quantity` double NOT NULL DEFAULT 1,
  `grams` double NOT NULL,
  `is_default` int NOT NULL DEFAULT 0,
  `source_id` int,
  `source_portion_code` varchar(120),
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `food_portions_id` PRIMARY KEY(`id`),
  CONSTRAINT `food_portions_food_label_unit_unique` UNIQUE(`food_id`, `normalized_label`, `unit`)
);
--> statement-breakpoint
ALTER TABLE `foods` ADD CONSTRAINT `foods_owner_user_id_users_id_fk` FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `foods` ADD CONSTRAINT `foods_source_id_food_sources_id_fk` FOREIGN KEY (`source_id`) REFERENCES `food_sources`(`id`) ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `foods` ADD CONSTRAINT `foods_merged_into_food_id_foods_id_fk` FOREIGN KEY (`merged_into_food_id`) REFERENCES `foods`(`id`) ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `food_aliases` ADD CONSTRAINT `food_aliases_food_id_foods_id_fk` FOREIGN KEY (`food_id`) REFERENCES `foods`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `food_aliases` ADD CONSTRAINT `food_aliases_source_id_food_sources_id_fk` FOREIGN KEY (`source_id`) REFERENCES `food_sources`(`id`) ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `food_portions` ADD CONSTRAINT `food_portions_food_id_foods_id_fk` FOREIGN KEY (`food_id`) REFERENCES `foods`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `food_portions` ADD CONSTRAINT `food_portions_source_id_food_sources_id_fk` FOREIGN KEY (`source_id`) REFERENCES `food_sources`(`id`) ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX `food_sources_slug_idx` ON `food_sources` (`slug`);
--> statement-breakpoint
CREATE INDEX `foods_owner_user_id_idx` ON `foods` (`owner_user_id`);
--> statement-breakpoint
CREATE INDEX `foods_normalized_name_idx` ON `foods` (`normalized_name`);
--> statement-breakpoint
CREATE INDEX `foods_scope_search_idx` ON `foods` (`owner_user_id`, `normalized_name`);
--> statement-breakpoint
CREATE INDEX `foods_status_idx` ON `foods` (`status`);
--> statement-breakpoint
CREATE INDEX `foods_merged_into_food_id_idx` ON `foods` (`merged_into_food_id`);
--> statement-breakpoint
CREATE INDEX `food_aliases_normalized_alias_idx` ON `food_aliases` (`normalized_alias`);
--> statement-breakpoint
CREATE INDEX `food_aliases_source_id_idx` ON `food_aliases` (`source_id`);
--> statement-breakpoint
CREATE INDEX `food_portions_food_id_idx` ON `food_portions` (`food_id`);
--> statement-breakpoint
CREATE INDEX `food_portions_source_id_idx` ON `food_portions` (`source_id`);