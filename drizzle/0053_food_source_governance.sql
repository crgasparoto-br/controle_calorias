CREATE TABLE `food_source_imports` (
	`id` int AUTO_INCREMENT NOT NULL,
	`source_id` int NOT NULL,
	`content_hash` varchar(64) NOT NULL,
	`initiated_by` varchar(120) NOT NULL,
	`status` enum('running','succeeded','warning','failed') NOT NULL DEFAULT 'running',
	`collected_at` timestamp,
	`started_at` timestamp NOT NULL DEFAULT (now()),
	`finished_at` timestamp,
	`record_count` int NOT NULL DEFAULT 0,
	`inserted_count` int NOT NULL DEFAULT 0,
	`updated_count` int NOT NULL DEFAULT 0,
	`ignored_count` int NOT NULL DEFAULT 0,
	`aliases_inserted` int NOT NULL DEFAULT 0,
	`portions_inserted` int NOT NULL DEFAULT 0,
	`error_code` varchar(120),
	`result_json` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `food_source_imports_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `food_sources` ADD `source_reference` varchar(255);--> statement-breakpoint
ALTER TABLE `food_sources` ADD `content_hash` varchar(64);--> statement-breakpoint
UPDATE `food_sources` SET `source_reference` = `name` WHERE `source_reference` IS NULL;--> statement-breakpoint
ALTER TABLE `food_source_imports` ADD CONSTRAINT `food_source_imports_source_id_food_sources_id_fk` FOREIGN KEY (`source_id`) REFERENCES `food_sources`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `food_source_imports_source_created_at_idx` ON `food_source_imports` (`source_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `food_source_imports_status_created_at_idx` ON `food_source_imports` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `food_source_imports_content_hash_idx` ON `food_source_imports` (`content_hash`);--> statement-breakpoint
CREATE INDEX `food_sources_content_hash_idx` ON `food_sources` (`content_hash`);
