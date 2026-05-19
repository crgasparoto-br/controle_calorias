CREATE TABLE `waterGoals` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`dailyTargetMl` int NOT NULL DEFAULT 2500,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `waterGoals_id` PRIMARY KEY(`id`),
	CONSTRAINT `waterGoals_userId_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
CREATE TABLE `waterLogs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`amountMl` int NOT NULL,
	`occurredAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `waterLogs_id` PRIMARY KEY(`id`)
);
