ALTER TABLE `foodCatalog` ADD `brandName` varchar(255);--> statement-breakpoint
ALTER TABLE `foodCatalog` ADD `servingUnit` varchar(40) DEFAULT 'g' NOT NULL;--> statement-breakpoint
ALTER TABLE `foodCatalog` ADD `fiber` double;--> statement-breakpoint
ALTER TABLE `foodCatalog` ADD `isUserCreated` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `foodCatalog` ADD `createdByUserId` int;--> statement-breakpoint
ALTER TABLE `foodCatalog` ADD CONSTRAINT `foodCatalog_createdByUserId_users_id_fk` FOREIGN KEY (`createdByUserId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `foodCatalog_createdByUserId_idx` ON `foodCatalog` (`createdByUserId`);--> statement-breakpoint
CREATE TABLE `foodFavorites` (
  `id` int AUTO_INCREMENT NOT NULL,
  `userId` int NOT NULL,
  `foodCatalogId` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `foodFavorites_id` PRIMARY KEY(`id`),
  CONSTRAINT `foodFavorites_user_food_idx` UNIQUE(`userId`,`foodCatalogId`)
);--> statement-breakpoint
ALTER TABLE `foodFavorites` ADD CONSTRAINT `foodFavorites_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `foodFavorites` ADD CONSTRAINT `foodFavorites_foodCatalogId_foodCatalog_id_fk` FOREIGN KEY (`foodCatalogId`) REFERENCES `foodCatalog`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `foodFavorites_userId_idx` ON `foodFavorites` (`userId`);
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
);--> statement-breakpoint
ALTER TABLE `mealFavorites` ADD CONSTRAINT `mealFavorites_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `mealFavorites_userId_idx` ON `mealFavorites` (`userId`);
