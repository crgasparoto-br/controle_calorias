DROP INDEX `meals_user_status_idx` ON `meals`;--> statement-breakpoint
ALTER TABLE `exercises` ADD `externalProvider` varchar(40);--> statement-breakpoint
ALTER TABLE `exercises` ADD `externalId` varchar(160);--> statement-breakpoint
ALTER TABLE `foodCatalog` ADD `processingLevel` enum('natural_or_minimally_processed','processed_culinary_ingredient','processed','ultra_processed');--> statement-breakpoint
ALTER TABLE `foodCatalog` ADD `classificationSource` varchar(40);--> statement-breakpoint
ALTER TABLE `foodCatalog` ADD `classificationConfidence` double;--> statement-breakpoint
ALTER TABLE `exercises` ADD CONSTRAINT `exercises_user_external_reference_unique` UNIQUE(`userId`,`externalProvider`,`externalId`);--> statement-breakpoint
CREATE INDEX `exercises_external_reference_idx` ON `exercises` (`externalProvider`,`externalId`);--> statement-breakpoint
CREATE INDEX `meals_user_status_occurredAt_idx` ON `meals` (`userId`,`status`,`occurredAt`);