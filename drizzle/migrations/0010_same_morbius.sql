CREATE TABLE `foodBrands` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`normalizedName` varchar(255) NOT NULL,
	`countryCode` varchar(2),
	`website` varchar(255),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `foodBrands_id` PRIMARY KEY(`id`),
	CONSTRAINT `foodBrands_normalizedName_unique` UNIQUE(`normalizedName`)
);
--> statement-breakpoint
CREATE TABLE `portions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`foodCatalogId` int NOT NULL,
	`label` varchar(120) NOT NULL,
	`unit` varchar(40) NOT NULL DEFAULT 'serving',
	`quantity` double NOT NULL DEFAULT 1,
	`grams` double NOT NULL,
	`isDefault` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `portions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `recipeItems` (
	`id` int AUTO_INCREMENT NOT NULL,
	`recipeId` int NOT NULL,
	`foodCatalogId` int,
	`portionId` int,
	`quantity` double NOT NULL DEFAULT 1,
	`unit` varchar(40) NOT NULL DEFAULT 'g',
	`grams` double NOT NULL DEFAULT 0,
	`calories` double NOT NULL DEFAULT 0,
	`protein` double NOT NULL DEFAULT 0,
	`carbs` double NOT NULL DEFAULT 0,
	`fat` double NOT NULL DEFAULT 0,
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `recipeItems_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `recipes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`servings` double NOT NULL DEFAULT 1,
	`totalGrams` double NOT NULL DEFAULT 0,
	`caloriesPerServing` double NOT NULL DEFAULT 0,
	`proteinPerServing` double NOT NULL DEFAULT 0,
	`carbsPerServing` double NOT NULL DEFAULT 0,
	`fatPerServing` double NOT NULL DEFAULT 0,
	`visibility` enum('private','shared') NOT NULL DEFAULT 'private',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `recipes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `userPreferences` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`preferenceKey` varchar(120) NOT NULL,
	`preferenceValue` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `userPreferences_id` PRIMARY KEY(`id`),
	CONSTRAINT `userPreferences_user_key_idx` UNIQUE(`userId`,`preferenceKey`)
);
--> statement-breakpoint
CREATE TABLE `userProfiles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`displayName` varchar(255),
	`birthDate` varchar(10),
	`sex` enum('female','male','non_binary','prefer_not_to_say') NOT NULL DEFAULT 'prefer_not_to_say',
	`heightCm` double,
	`timezone` varchar(80) NOT NULL DEFAULT 'UTC',
	`locale` varchar(16) NOT NULL DEFAULT 'pt-BR',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `userProfiles_id` PRIMARY KEY(`id`),
	CONSTRAINT `userProfiles_userId_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
CREATE TABLE `userRestrictions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`restrictionType` enum('allergy','intolerance','diet','avoidance','medical','other') NOT NULL DEFAULT 'other',
	`label` varchar(160) NOT NULL,
	`severity` enum('info','avoid','strict') NOT NULL DEFAULT 'info',
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `userRestrictions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `weightEntries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`weightKg` double NOT NULL,
	`measuredAt` timestamp NOT NULL DEFAULT (now()),
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `weightEntries_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `foodCatalog` ADD `brandId` int;--> statement-breakpoint
ALTER TABLE `foodCatalog` ADD `foodType` enum('generic','branded') DEFAULT 'generic' NOT NULL;--> statement-breakpoint
ALTER TABLE `foodCatalog` ADD `barcode` varchar(64);--> statement-breakpoint
ALTER TABLE `foodCatalog` ADD `dataSource` varchar(80) DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE `mealItems` ADD `recipeId` int;--> statement-breakpoint
ALTER TABLE `mealItems` ADD `portionId` int;--> statement-breakpoint
ALTER TABLE `mealItems` ADD `itemType` enum('food','recipe','free_text') DEFAULT 'food' NOT NULL;--> statement-breakpoint
ALTER TABLE `mealItems` ADD `quantity` double DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `mealItems` ADD `unit` varchar(40) DEFAULT 'serving' NOT NULL;--> statement-breakpoint
ALTER TABLE `foodCatalog` ADD CONSTRAINT `foodCatalog_barcode_unique` UNIQUE(`barcode`);--> statement-breakpoint
ALTER TABLE `portions` ADD CONSTRAINT `portions_foodCatalogId_foodCatalog_id_fk` FOREIGN KEY (`foodCatalogId`) REFERENCES `foodCatalog`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `recipeItems` ADD CONSTRAINT `recipeItems_recipeId_recipes_id_fk` FOREIGN KEY (`recipeId`) REFERENCES `recipes`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `recipeItems` ADD CONSTRAINT `recipeItems_foodCatalogId_foodCatalog_id_fk` FOREIGN KEY (`foodCatalogId`) REFERENCES `foodCatalog`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `recipeItems` ADD CONSTRAINT `recipeItems_portionId_portions_id_fk` FOREIGN KEY (`portionId`) REFERENCES `portions`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `recipes` ADD CONSTRAINT `recipes_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `userPreferences` ADD CONSTRAINT `userPreferences_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `userProfiles` ADD CONSTRAINT `userProfiles_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `userRestrictions` ADD CONSTRAINT `userRestrictions_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `weightEntries` ADD CONSTRAINT `weightEntries_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `foodBrands_normalizedName_idx` ON `foodBrands` (`normalizedName`);--> statement-breakpoint
CREATE INDEX `portions_foodCatalogId_idx` ON `portions` (`foodCatalogId`);--> statement-breakpoint
CREATE INDEX `portions_food_unit_idx` ON `portions` (`foodCatalogId`,`unit`);--> statement-breakpoint
CREATE INDEX `recipeItems_recipeId_idx` ON `recipeItems` (`recipeId`);--> statement-breakpoint
CREATE INDEX `recipeItems_foodCatalogId_idx` ON `recipeItems` (`foodCatalogId`);--> statement-breakpoint
CREATE INDEX `recipeItems_portionId_idx` ON `recipeItems` (`portionId`);--> statement-breakpoint
CREATE INDEX `recipes_userId_idx` ON `recipes` (`userId`);--> statement-breakpoint
CREATE INDEX `recipes_user_name_idx` ON `recipes` (`userId`,`name`);--> statement-breakpoint
CREATE INDEX `userProfiles_userId_idx` ON `userProfiles` (`userId`);--> statement-breakpoint
CREATE INDEX `userRestrictions_user_type_idx` ON `userRestrictions` (`userId`,`restrictionType`);--> statement-breakpoint
CREATE INDEX `userRestrictions_user_label_idx` ON `userRestrictions` (`userId`,`label`);--> statement-breakpoint
CREATE INDEX `weightEntries_user_measuredAt_idx` ON `weightEntries` (`userId`,`measuredAt`);--> statement-breakpoint
ALTER TABLE `foodCatalog` ADD CONSTRAINT `foodCatalog_brandId_foodBrands_id_fk` FOREIGN KEY (`brandId`) REFERENCES `foodBrands`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `mealItems` ADD CONSTRAINT `mealItems_recipeId_recipes_id_fk` FOREIGN KEY (`recipeId`) REFERENCES `recipes`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `mealItems` ADD CONSTRAINT `mealItems_portionId_portions_id_fk` FOREIGN KEY (`portionId`) REFERENCES `portions`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `foodCatalog_brandId_idx` ON `foodCatalog` (`brandId`);--> statement-breakpoint
CREATE INDEX `foodCatalog_foodType_idx` ON `foodCatalog` (`foodType`);--> statement-breakpoint
CREATE INDEX `mealItems_recipeId_idx` ON `mealItems` (`recipeId`);--> statement-breakpoint
CREATE INDEX `mealItems_portionId_idx` ON `mealItems` (`portionId`);