ALTER TABLE `appSecrets` ADD CONSTRAINT `appSecrets_updatedByUserId_users_id_fk` FOREIGN KEY (`updatedByUserId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `dailySummaries` ADD CONSTRAINT `dailySummaries_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `exercises` ADD CONSTRAINT `exercises_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `habitMemories` ADD CONSTRAINT `habitMemories_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `inferenceLogs` ADD CONSTRAINT `inferenceLogs_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `mealInferences` ADD CONSTRAINT `mealInferences_mealId_meals_id_fk` FOREIGN KEY (`mealId`) REFERENCES `meals`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `mealInferences` ADD CONSTRAINT `mealInferences_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `mealItems` ADD CONSTRAINT `mealItems_mealId_meals_id_fk` FOREIGN KEY (`mealId`) REFERENCES `meals`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `mealItems` ADD CONSTRAINT `mealItems_foodCatalogId_foodCatalog_id_fk` FOREIGN KEY (`foodCatalogId`) REFERENCES `foodCatalog`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `mealMedia` ADD CONSTRAINT `mealMedia_mealId_meals_id_fk` FOREIGN KEY (`mealId`) REFERENCES `meals`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `meals` ADD CONSTRAINT `meals_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `nutritionGoals` ADD CONSTRAINT `nutritionGoals_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `waterGoals` ADD CONSTRAINT `waterGoals_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `waterLogs` ADD CONSTRAINT `waterLogs_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `whatsappConnections` ADD CONSTRAINT `whatsappConnections_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `dailySummaries_user_summaryDate_idx` ON `dailySummaries` (`userId`,`summaryDate`);--> statement-breakpoint
CREATE INDEX `exercises_user_occurredAt_idx` ON `exercises` (`userId`,`occurredAt`);--> statement-breakpoint
CREATE INDEX `habitMemories_user_food_idx` ON `habitMemories` (`userId`,`foodName`);--> statement-breakpoint
CREATE INDEX `habitMemories_user_lastSeen_idx` ON `habitMemories` (`userId`,`lastSeenAt`);--> statement-breakpoint
CREATE INDEX `inferenceLogs_user_createdAt_idx` ON `inferenceLogs` (`userId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `inferenceLogs_eventType_idx` ON `inferenceLogs` (`eventType`);--> statement-breakpoint
CREATE INDEX `mealInferences_userId_idx` ON `mealInferences` (`userId`);--> statement-breakpoint
CREATE INDEX `mealInferences_mealId_idx` ON `mealInferences` (`mealId`);--> statement-breakpoint
CREATE INDEX `mealItems_mealId_idx` ON `mealItems` (`mealId`);--> statement-breakpoint
CREATE INDEX `mealItems_foodCatalogId_idx` ON `mealItems` (`foodCatalogId`);--> statement-breakpoint
CREATE INDEX `mealMedia_mealId_idx` ON `mealMedia` (`mealId`);--> statement-breakpoint
CREATE INDEX `meals_user_occurredAt_idx` ON `meals` (`userId`,`occurredAt`);--> statement-breakpoint
CREATE INDEX `meals_user_status_idx` ON `meals` (`userId`,`status`);--> statement-breakpoint
CREATE INDEX `nutritionGoals_userId_idx` ON `nutritionGoals` (`userId`);--> statement-breakpoint
CREATE INDEX `waterLogs_user_occurredAt_idx` ON `waterLogs` (`userId`,`occurredAt`);--> statement-breakpoint
CREATE INDEX `whatsappConnections_userId_idx` ON `whatsappConnections` (`userId`);--> statement-breakpoint
CREATE INDEX `whatsappConnections_phoneNumber_idx` ON `whatsappConnections` (`phoneNumber`);