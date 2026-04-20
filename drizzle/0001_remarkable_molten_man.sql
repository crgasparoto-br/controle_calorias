CREATE TABLE `dailySummaries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`summaryDate` varchar(10) NOT NULL,
	`caloriesConsumed` double NOT NULL DEFAULT 0,
	`proteinConsumed` double NOT NULL DEFAULT 0,
	`carbsConsumed` double NOT NULL DEFAULT 0,
	`fatConsumed` double NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `dailySummaries_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `foodCatalog` (
	`id` int AUTO_INCREMENT NOT NULL,
	`slug` varchar(128) NOT NULL,
	`name` varchar(255) NOT NULL,
	`aliases` text,
	`servingLabel` varchar(120) NOT NULL,
	`gramsPerServing` double NOT NULL,
	`calories` double NOT NULL,
	`protein` double NOT NULL,
	`carbs` double NOT NULL,
	`fat` double NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `foodCatalog_id` PRIMARY KEY(`id`),
	CONSTRAINT `foodCatalog_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `habitMemories` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`foodName` varchar(255) NOT NULL,
	`typicalMealLabel` varchar(80),
	`preferredPortionGrams` double NOT NULL DEFAULT 0,
	`notes` text,
	`occurrenceCount` int NOT NULL DEFAULT 1,
	`lastSeenAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `habitMemories_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `inferenceLogs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int,
	`origin` enum('web','whatsapp','admin') NOT NULL DEFAULT 'web',
	`status` enum('success','warning','error') NOT NULL DEFAULT 'success',
	`eventType` varchar(120) NOT NULL,
	`detail` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `inferenceLogs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `mealInferences` (
	`id` int AUTO_INCREMENT NOT NULL,
	`mealId` int,
	`userId` int NOT NULL,
	`source` enum('web','whatsapp') NOT NULL DEFAULT 'web',
	`requestSummary` text,
	`reasoning` text,
	`confidence` double NOT NULL DEFAULT 0.5,
	`itemsJson` text NOT NULL,
	`totalsJson` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `mealInferences_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `mealItems` (
	`id` int AUTO_INCREMENT NOT NULL,
	`mealId` int NOT NULL,
	`foodCatalogId` int,
	`foodName` varchar(255) NOT NULL,
	`canonicalName` varchar(255) NOT NULL,
	`portionText` varchar(120) NOT NULL,
	`servings` double NOT NULL DEFAULT 1,
	`estimatedGrams` double NOT NULL DEFAULT 0,
	`calories` double NOT NULL,
	`protein` double NOT NULL,
	`carbs` double NOT NULL,
	`fat` double NOT NULL,
	`source` enum('catalog','hybrid','heuristic') NOT NULL DEFAULT 'catalog',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `mealItems_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `mealMedia` (
	`id` int AUTO_INCREMENT NOT NULL,
	`mealId` int NOT NULL,
	`mediaType` enum('image','audio') NOT NULL,
	`storageKey` varchar(255) NOT NULL,
	`storageUrl` text NOT NULL,
	`mimeType` varchar(120) NOT NULL,
	`originalFileName` varchar(255),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `mealMedia_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `meals` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`source` enum('web','whatsapp') NOT NULL DEFAULT 'web',
	`status` enum('draft','confirmed') NOT NULL DEFAULT 'draft',
	`mealLabel` varchar(80) NOT NULL,
	`notes` text,
	`sourceText` text,
	`transcript` text,
	`confidence` double NOT NULL DEFAULT 0.5,
	`occurredAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `meals_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `nutritionGoals` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`calories` int NOT NULL,
	`proteinGrams` double NOT NULL,
	`carbsGrams` double NOT NULL,
	`fatGrams` double NOT NULL,
	`effectiveFrom` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `nutritionGoals_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `whatsappConnections` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`phoneNumber` varchar(32) NOT NULL,
	`displayName` varchar(255),
	`status` enum('pending','active','disabled') NOT NULL DEFAULT 'pending',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `whatsappConnections_id` PRIMARY KEY(`id`)
);
