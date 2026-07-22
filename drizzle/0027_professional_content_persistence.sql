CREATE TABLE `professionalComments` (
	`id` varchar(64) NOT NULL,
	`professionalUserId` int NOT NULL,
	`patientUserId` int NOT NULL,
	`comment` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `professionalComments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `professionalGoalSuggestions` (
	`id` varchar(64) NOT NULL,
	`professionalUserId` int NOT NULL,
	`patientUserId` int NOT NULL,
	`rationale` text NOT NULL,
	`status` enum('draft','sent','accepted','refused','cancelled') NOT NULL,
	`goal` json NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`createdAt` timestamp NOT NULL,
	`sentAt` timestamp,
	`respondedAt` timestamp,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `professionalGoalSuggestions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `professionalHistoryEvents` (
	`id` varchar(64) NOT NULL,
	`actorUserId` int,
	`professionalUserId` int NOT NULL,
	`patientUserId` int,
	`eventType` varchar(80) NOT NULL,
	`entityType` varchar(80),
	`entityId` varchar(64),
	`occurredAt` timestamp NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `professionalHistoryEvents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `professionalMealSuggestions` (
	`id` varchar(64) NOT NULL,
	`professionalUserId` int NOT NULL,
	`patientUserId` int NOT NULL,
	`mealLabel` varchar(80) NOT NULL,
	`title` varchar(120) NOT NULL,
	`description` text NOT NULL,
	`rationale` text NOT NULL,
	`notes` text,
	`status` enum('draft','sent','accepted','refused','cancelled') NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`createdAt` timestamp NOT NULL,
	`sentAt` timestamp,
	`respondedAt` timestamp,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `professionalMealSuggestions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `professionalComments` ADD CONSTRAINT `professionalComments_professionalUserId_users_id_fk` FOREIGN KEY (`professionalUserId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `professionalComments` ADD CONSTRAINT `professionalComments_patientUserId_users_id_fk` FOREIGN KEY (`patientUserId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `professionalGoalSuggestions` ADD CONSTRAINT `professionalGoalSuggestions_professionalUserId_users_id_fk` FOREIGN KEY (`professionalUserId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `professionalGoalSuggestions` ADD CONSTRAINT `professionalGoalSuggestions_patientUserId_users_id_fk` FOREIGN KEY (`patientUserId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `professionalHistoryEvents` ADD CONSTRAINT `professionalHistoryEvents_actorUserId_users_id_fk` FOREIGN KEY (`actorUserId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `professionalHistoryEvents` ADD CONSTRAINT `professionalHistoryEvents_professionalUserId_users_id_fk` FOREIGN KEY (`professionalUserId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `professionalHistoryEvents` ADD CONSTRAINT `professionalHistoryEvents_patientUserId_users_id_fk` FOREIGN KEY (`patientUserId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `professionalMealSuggestions` ADD CONSTRAINT `professionalMealSuggestions_professionalUserId_users_id_fk` FOREIGN KEY (`professionalUserId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `professionalMealSuggestions` ADD CONSTRAINT `professionalMealSuggestions_patientUserId_users_id_fk` FOREIGN KEY (`patientUserId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `professionalComments_pair_created_idx` ON `professionalComments` (`professionalUserId`,`patientUserId`,`createdAt`,`id`);--> statement-breakpoint
CREATE INDEX `professionalComments_patient_created_idx` ON `professionalComments` (`patientUserId`,`createdAt`,`id`);--> statement-breakpoint
CREATE INDEX `professionalGoalSuggestions_pair_created_idx` ON `professionalGoalSuggestions` (`professionalUserId`,`patientUserId`,`createdAt`,`id`);--> statement-breakpoint
CREATE INDEX `professionalGoalSuggestions_patient_status_created_idx` ON `professionalGoalSuggestions` (`patientUserId`,`status`,`createdAt`,`id`);--> statement-breakpoint
CREATE INDEX `professionalHistory_professional_occurred_idx` ON `professionalHistoryEvents` (`professionalUserId`,`occurredAt`,`id`);--> statement-breakpoint
CREATE INDEX `professionalHistory_patient_occurred_idx` ON `professionalHistoryEvents` (`patientUserId`,`occurredAt`,`id`);--> statement-breakpoint
CREATE INDEX `professionalHistory_entity_idx` ON `professionalHistoryEvents` (`entityType`,`entityId`);--> statement-breakpoint
CREATE INDEX `professionalMealSuggestions_pair_created_idx` ON `professionalMealSuggestions` (`professionalUserId`,`patientUserId`,`createdAt`,`id`);--> statement-breakpoint
CREATE INDEX `professionalMealSuggestions_patient_status_created_idx` ON `professionalMealSuggestions` (`patientUserId`,`status`,`createdAt`,`id`);