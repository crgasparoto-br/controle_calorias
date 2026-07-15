CREATE TABLE `professionalAccessEvents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`accessId` varchar(64) NOT NULL,
	`fromStatus` enum('pending','approved','rejected','revoked'),
	`toStatus` enum('pending','approved','rejected','revoked') NOT NULL,
	`actorUserId` int,
	`origin` enum('web','whatsapp','migration','system') NOT NULL DEFAULT 'system',
	`reason` text,
	`occurredAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `professionalAccessEvents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `professionalFollowUpEvents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`followUpId` int NOT NULL,
	`fromStatus` enum('active','paused','ended'),
	`toStatus` enum('active','paused','ended') NOT NULL,
	`actorUserId` int,
	`reason` text,
	`occurredAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `professionalFollowUpEvents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `professionalFollowUps` (
	`id` int AUTO_INCREMENT NOT NULL,
	`accessId` varchar(64) NOT NULL,
	`status` enum('active','paused','ended') NOT NULL DEFAULT 'active',
	`statusChangedAt` timestamp NOT NULL DEFAULT (now()),
	`statusChangedByUserId` int,
	`reason` text,
	`startedAt` timestamp NOT NULL DEFAULT (now()),
	`endedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `professionalFollowUps_id` PRIMARY KEY(`id`),
	CONSTRAINT `professionalFollowUps_access_unique_idx` UNIQUE(`accessId`)
);
--> statement-breakpoint
CREATE TABLE `professionalPatientAccesses` (
	`id` varchar(64) NOT NULL,
	`professionalUserId` int NOT NULL,
	`patientUserId` int NOT NULL,
	`authorizationStatus` enum('pending','approved','rejected','revoked') NOT NULL DEFAULT 'pending',
	`activePairKey` varchar(64),
	`reason` text NOT NULL,
	`requestedAt` timestamp NOT NULL,
	`approvedAt` timestamp,
	`rejectedAt` timestamp,
	`revokedAt` timestamp,
	`respondedAt` timestamp,
	`responseOrigin` enum('web','whatsapp'),
	`responseDecision` enum('approved','rejected','revoked'),
	`authorizationMessageStatus` enum('sent','failed','skipped'),
	`authorizationMessageSentAt` timestamp,
	`authorizationMessageError` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `professionalPatientAccesses_id` PRIMARY KEY(`id`),
	CONSTRAINT `professionalAccesses_active_pair_unique_idx` UNIQUE(`activePairKey`)
);
--> statement-breakpoint
CREATE TABLE `professionalProfiles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`displayName` varchar(120) NOT NULL,
	`registrationNumber` varchar(80),
	`active` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `professionalProfiles_id` PRIMARY KEY(`id`),
	CONSTRAINT `professionalProfiles_user_unique_idx` UNIQUE(`userId`)
);
--> statement-breakpoint
ALTER TABLE `professionalAccessEvents` ADD CONSTRAINT `professionalAccessEvents_accessId_professionalPatientAccesses_id_fk` FOREIGN KEY (`accessId`) REFERENCES `professionalPatientAccesses`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `professionalAccessEvents` ADD CONSTRAINT `professionalAccessEvents_actorUserId_users_id_fk` FOREIGN KEY (`actorUserId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `professionalFollowUpEvents` ADD CONSTRAINT `professionalFollowUpEvents_followUpId_professionalFollowUps_id_fk` FOREIGN KEY (`followUpId`) REFERENCES `professionalFollowUps`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `professionalFollowUpEvents` ADD CONSTRAINT `professionalFollowUpEvents_actorUserId_users_id_fk` FOREIGN KEY (`actorUserId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `professionalFollowUps` ADD CONSTRAINT `professionalFollowUps_accessId_professionalPatientAccesses_id_fk` FOREIGN KEY (`accessId`) REFERENCES `professionalPatientAccesses`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `professionalFollowUps` ADD CONSTRAINT `professionalFollowUps_statusChangedByUserId_users_id_fk` FOREIGN KEY (`statusChangedByUserId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `professionalPatientAccesses` ADD CONSTRAINT `professionalPatientAccesses_professionalUserId_users_id_fk` FOREIGN KEY (`professionalUserId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `professionalPatientAccesses` ADD CONSTRAINT `professionalPatientAccesses_patientUserId_users_id_fk` FOREIGN KEY (`patientUserId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `professionalProfiles` ADD CONSTRAINT `professionalProfiles_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `professionalAccessEvents_access_occurred_idx` ON `professionalAccessEvents` (`accessId`,`occurredAt`);--> statement-breakpoint
CREATE INDEX `professionalAccessEvents_actor_occurred_idx` ON `professionalAccessEvents` (`actorUserId`,`occurredAt`);--> statement-breakpoint
CREATE INDEX `professionalFollowUpEvents_followup_occurred_idx` ON `professionalFollowUpEvents` (`followUpId`,`occurredAt`);--> statement-breakpoint
CREATE INDEX `professionalFollowUpEvents_actor_occurred_idx` ON `professionalFollowUpEvents` (`actorUserId`,`occurredAt`);--> statement-breakpoint
CREATE INDEX `professionalFollowUps_status_idx` ON `professionalFollowUps` (`status`);--> statement-breakpoint
CREATE INDEX `professionalAccesses_professional_status_idx` ON `professionalPatientAccesses` (`professionalUserId`,`authorizationStatus`);--> statement-breakpoint
CREATE INDEX `professionalAccesses_patient_status_idx` ON `professionalPatientAccesses` (`patientUserId`,`authorizationStatus`);--> statement-breakpoint
CREATE INDEX `professionalAccesses_pair_requested_idx` ON `professionalPatientAccesses` (`professionalUserId`,`patientUserId`,`requestedAt`);--> statement-breakpoint
CREATE INDEX `professionalProfiles_active_idx` ON `professionalProfiles` (`active`);