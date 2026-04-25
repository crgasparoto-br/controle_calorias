ALTER TABLE `nutritionGoals` DROP INDEX `nutritionGoals_user_weekday_idx`;--> statement-breakpoint
ALTER TABLE `nutritionGoals` MODIFY COLUMN `weekday` int NOT NULL DEFAULT -1;--> statement-breakpoint
ALTER TABLE `nutritionGoals` ADD `ruleType` enum('default','exception') DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE `nutritionGoals` ADD `durationType` enum('1_week','2_weeks','3_weeks','always') DEFAULT 'always' NOT NULL;--> statement-breakpoint
ALTER TABLE `nutritionGoals` ADD `effectiveUntil` timestamp;--> statement-breakpoint
ALTER TABLE `nutritionGoals` ADD CONSTRAINT `nutritionGoals_user_rule_window_idx` UNIQUE(`userId`,`ruleType`,`weekday`,`effectiveFrom`);