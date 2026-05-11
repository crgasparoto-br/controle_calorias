CREATE TABLE `foodFavorites` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`foodCatalogId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `foodFavorites_id` PRIMARY KEY(`id`),
	CONSTRAINT `foodFavorites_user_food_idx` UNIQUE(`userId`,`foodCatalogId`)
);
--> statement-breakpoint
CREATE TABLE `mealFavorites` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`name` varchar(80) NOT NULL,
	`mealLabel` varchar(80) NOT NULL,
	`notes` text,
	`itemsJson` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `mealFavorites_id` PRIMARY KEY(`id`),
	CONSTRAINT `mealFavorites_user_name_idx` UNIQUE(`userId`,`name`)
);
--> statement-breakpoint
CREATE TABLE `userBadges` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`badgeCode` varchar(80) NOT NULL,
	`earnedAt` timestamp NOT NULL DEFAULT (now()),
	`weekStart` varchar(10),
	`metadataJson` text,
	CONSTRAINT `userBadges_id` PRIMARY KEY(`id`),
	CONSTRAINT `userBadges_user_badge_week_idx` UNIQUE(`userId`,`badgeCode`,`weekStart`)
);
--> statement-breakpoint
CREATE TABLE `userGamificationSettings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`enabled` int NOT NULL DEFAULT 1,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `userGamificationSettings_id` PRIMARY KEY(`id`),
	CONSTRAINT `userGamificationSettings_userId_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
ALTER TABLE `foodCatalog` ADD `brandName` varchar(255);--> statement-breakpoint
ALTER TABLE `foodCatalog` ADD `servingUnit` varchar(40) DEFAULT 'g' NOT NULL;--> statement-breakpoint
ALTER TABLE `foodCatalog` ADD `fiber` double;--> statement-breakpoint
ALTER TABLE `foodCatalog` ADD `isFruit` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `foodCatalog` ADD `isVegetable` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `foodCatalog` ADD `isUltraProcessed` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `foodCatalog` ADD `isUserCreated` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `foodCatalog` ADD `createdByUserId` int;--> statement-breakpoint
ALTER TABLE `foodFavorites` ADD CONSTRAINT `foodFavorites_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `foodFavorites` ADD CONSTRAINT `foodFavorites_foodCatalogId_foodCatalog_id_fk` FOREIGN KEY (`foodCatalogId`) REFERENCES `foodCatalog`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `mealFavorites` ADD CONSTRAINT `mealFavorites_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `userBadges` ADD CONSTRAINT `userBadges_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `userGamificationSettings` ADD CONSTRAINT `userGamificationSettings_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `foodFavorites_userId_idx` ON `foodFavorites` (`userId`);--> statement-breakpoint
CREATE INDEX `mealFavorites_userId_idx` ON `mealFavorites` (`userId`);--> statement-breakpoint
CREATE INDEX `userBadges_userId_idx` ON `userBadges` (`userId`);--> statement-breakpoint
CREATE INDEX `userGamificationSettings_userId_idx` ON `userGamificationSettings` (`userId`);--> statement-breakpoint
ALTER TABLE `foodCatalog` ADD CONSTRAINT `foodCatalog_createdByUserId_users_id_fk` FOREIGN KEY (`createdByUserId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `foodCatalog_createdByUserId_idx` ON `foodCatalog` (`createdByUserId`);