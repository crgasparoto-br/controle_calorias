CREATE TABLE `professionalPatientAuthorizations` (
	`id` varchar(64) NOT NULL,
	`professionalUserId` int NOT NULL,
	`patientUserId` int NOT NULL,
	`status` enum('pending','approved','rejected','revoked') NOT NULL,
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
	`authorizationMessageError` varchar(500),
	`sourceUpdatedAt` timestamp NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `professionalPatientAuthorizations_id` PRIMARY KEY(`id`),
	CONSTRAINT `professionalAuthorizations_active_pair_unique_idx` UNIQUE(`activePairKey`)
);
--> statement-breakpoint
CREATE TABLE `professionalPatientTrackingEvents` (
	`id` varchar(64) NOT NULL,
	`trackingId` varchar(64) NOT NULL,
	`authorizationId` varchar(64) NOT NULL,
	`actorUserId` int NOT NULL,
	`fromStatus` enum('active','paused','ended'),
	`toStatus` enum('active','paused','ended') NOT NULL,
	`reason` text,
	`occurredAt` timestamp NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `professionalPatientTrackingEvents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `professionalPatientTrackings` (
	`id` varchar(64) NOT NULL,
	`authorizationId` varchar(64) NOT NULL,
	`professionalUserId` int NOT NULL,
	`patientUserId` int NOT NULL,
	`status` enum('active','paused','ended') NOT NULL DEFAULT 'active',
	`startedAt` timestamp NOT NULL,
	`pausedAt` timestamp,
	`endedAt` timestamp,
	`lastTransitionAt` timestamp NOT NULL,
	`lastTransitionByUserId` int NOT NULL,
	`lastTransitionReason` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `professionalPatientTrackings_id` PRIMARY KEY(`id`),
	CONSTRAINT `professionalTrackings_authorization_unique_idx` UNIQUE(`authorizationId`)
);
--> statement-breakpoint
CREATE TABLE `professionalProfiles` (
	`userId` int NOT NULL,
	`displayName` varchar(255) NOT NULL,
	`registrationNumber` varchar(120),
	`active` boolean NOT NULL DEFAULT false,
	`sourceUpdatedAt` timestamp NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `professionalProfiles_userId` PRIMARY KEY(`userId`)
);
--> statement-breakpoint
ALTER TABLE `professionalPatientAuthorizations` ADD CONSTRAINT `professionalPatientAuthorizations_professionalUserId_users_id_fk` FOREIGN KEY (`professionalUserId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `professionalPatientAuthorizations` ADD CONSTRAINT `professionalPatientAuthorizations_patientUserId_users_id_fk` FOREIGN KEY (`patientUserId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `professionalPatientTrackingEvents` ADD CONSTRAINT `professionalPatientTrackingEvents_trackingId_professionalPatientTrackings_id_fk` FOREIGN KEY (`trackingId`) REFERENCES `professionalPatientTrackings`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `professionalPatientTrackingEvents` ADD CONSTRAINT `professionalPatientTrackingEvents_authorizationId_professionalPatientAuthorizations_id_fk` FOREIGN KEY (`authorizationId`) REFERENCES `professionalPatientAuthorizations`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `professionalPatientTrackingEvents` ADD CONSTRAINT `professionalPatientTrackingEvents_actorUserId_users_id_fk` FOREIGN KEY (`actorUserId`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `professionalPatientTrackings` ADD CONSTRAINT `professionalPatientTrackings_authorizationId_professionalPatientAuthorizations_id_fk` FOREIGN KEY (`authorizationId`) REFERENCES `professionalPatientAuthorizations`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `professionalPatientTrackings` ADD CONSTRAINT `professionalPatientTrackings_professionalUserId_users_id_fk` FOREIGN KEY (`professionalUserId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `professionalPatientTrackings` ADD CONSTRAINT `professionalPatientTrackings_patientUserId_users_id_fk` FOREIGN KEY (`patientUserId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `professionalPatientTrackings` ADD CONSTRAINT `professionalPatientTrackings_lastTransitionByUserId_users_id_fk` FOREIGN KEY (`lastTransitionByUserId`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `professionalProfiles` ADD CONSTRAINT `professionalProfiles_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `professionalAuthorizations_professional_status_idx` ON `professionalPatientAuthorizations` (`professionalUserId`,`status`);--> statement-breakpoint
CREATE INDEX `professionalAuthorizations_patient_status_idx` ON `professionalPatientAuthorizations` (`patientUserId`,`status`);--> statement-breakpoint
CREATE INDEX `professionalAuthorizations_pair_idx` ON `professionalPatientAuthorizations` (`professionalUserId`,`patientUserId`);--> statement-breakpoint
CREATE INDEX `professionalTrackingEvents_tracking_occurred_idx` ON `professionalPatientTrackingEvents` (`trackingId`,`occurredAt`);--> statement-breakpoint
CREATE INDEX `professionalTrackingEvents_authorization_occurred_idx` ON `professionalPatientTrackingEvents` (`authorizationId`,`occurredAt`);--> statement-breakpoint
CREATE INDEX `professionalTrackingEvents_actor_occurred_idx` ON `professionalPatientTrackingEvents` (`actorUserId`,`occurredAt`);--> statement-breakpoint
CREATE INDEX `professionalTrackings_professional_status_idx` ON `professionalPatientTrackings` (`professionalUserId`,`status`);--> statement-breakpoint
CREATE INDEX `professionalTrackings_patient_status_idx` ON `professionalPatientTrackings` (`patientUserId`,`status`);--> statement-breakpoint
CREATE INDEX `professionalProfiles_active_idx` ON `professionalProfiles` (`active`);