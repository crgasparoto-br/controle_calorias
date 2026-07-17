CREATE TABLE `professionalProfiles` (
  `userId` int NOT NULL,
  `displayName` varchar(255) NOT NULL,
  `registrationNumber` varchar(120),
  `active` boolean DEFAULT false NOT NULL,
  `sourceUpdatedAt` timestamp NOT NULL,
  `createdAt` timestamp DEFAULT (now()) NOT NULL,
  `updatedAt` timestamp DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT `professionalProfiles_userId` PRIMARY KEY(`userId`),
  CONSTRAINT `professionalProfiles_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `professionalProfiles_active_idx` ON `professionalProfiles` (`active`);
--> statement-breakpoint
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
  `createdAt` timestamp DEFAULT (now()) NOT NULL,
  `updatedAt` timestamp DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT `professionalPatientAuthorizations_id` PRIMARY KEY(`id`),
  CONSTRAINT `professionalAuthorizations_professional_fk` FOREIGN KEY (`professionalUserId`) REFERENCES `users`(`id`) ON DELETE cascade,
  CONSTRAINT `professionalAuthorizations_patient_fk` FOREIGN KEY (`patientUserId`) REFERENCES `users`(`id`) ON DELETE cascade,
  CONSTRAINT `professionalAuthorizations_active_pair_unique_idx` UNIQUE(`activePairKey`)
);
--> statement-breakpoint
CREATE INDEX `professionalAuthorizations_professional_status_idx` ON `professionalPatientAuthorizations` (`professionalUserId`,`status`);
--> statement-breakpoint
CREATE INDEX `professionalAuthorizations_patient_status_idx` ON `professionalPatientAuthorizations` (`patientUserId`,`status`);
--> statement-breakpoint
CREATE INDEX `professionalAuthorizations_pair_idx` ON `professionalPatientAuthorizations` (`professionalUserId`,`patientUserId`);
--> statement-breakpoint
CREATE TABLE `professionalPatientTrackings` (
  `id` varchar(64) NOT NULL,
  `authorizationId` varchar(64) NOT NULL,
  `professionalUserId` int NOT NULL,
  `patientUserId` int NOT NULL,
  `status` enum('active','paused','ended') DEFAULT 'active' NOT NULL,
  `startedAt` timestamp NOT NULL,
  `pausedAt` timestamp,
  `endedAt` timestamp,
  `lastTransitionAt` timestamp NOT NULL,
  `lastTransitionByUserId` int NOT NULL,
  `lastTransitionReason` text,
  `createdAt` timestamp DEFAULT (now()) NOT NULL,
  `updatedAt` timestamp DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT `professionalPatientTrackings_id` PRIMARY KEY(`id`),
  CONSTRAINT `professionalTrackings_authorization_fk` FOREIGN KEY (`authorizationId`) REFERENCES `professionalPatientAuthorizations`(`id`) ON DELETE cascade,
  CONSTRAINT `professionalTrackings_professional_fk` FOREIGN KEY (`professionalUserId`) REFERENCES `users`(`id`) ON DELETE cascade,
  CONSTRAINT `professionalTrackings_patient_fk` FOREIGN KEY (`patientUserId`) REFERENCES `users`(`id`) ON DELETE cascade,
  CONSTRAINT `professionalTrackings_actor_fk` FOREIGN KEY (`lastTransitionByUserId`) REFERENCES `users`(`id`) ON DELETE restrict,
  CONSTRAINT `professionalTrackings_authorization_unique_idx` UNIQUE(`authorizationId`)
);
--> statement-breakpoint
CREATE INDEX `professionalTrackings_professional_status_idx` ON `professionalPatientTrackings` (`professionalUserId`,`status`);
--> statement-breakpoint
CREATE INDEX `professionalTrackings_patient_status_idx` ON `professionalPatientTrackings` (`patientUserId`,`status`);
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
  `createdAt` timestamp DEFAULT (now()) NOT NULL,
  CONSTRAINT `professionalPatientTrackingEvents_id` PRIMARY KEY(`id`),
  CONSTRAINT `professionalTrackingEvents_tracking_fk` FOREIGN KEY (`trackingId`) REFERENCES `professionalPatientTrackings`(`id`) ON DELETE cascade,
  CONSTRAINT `professionalTrackingEvents_authorization_fk` FOREIGN KEY (`authorizationId`) REFERENCES `professionalPatientAuthorizations`(`id`) ON DELETE cascade,
  CONSTRAINT `professionalTrackingEvents_actor_fk` FOREIGN KEY (`actorUserId`) REFERENCES `users`(`id`) ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `professionalTrackingEvents_tracking_occurred_idx` ON `professionalPatientTrackingEvents` (`trackingId`,`occurredAt`);
--> statement-breakpoint
CREATE INDEX `professionalTrackingEvents_authorization_occurred_idx` ON `professionalPatientTrackingEvents` (`authorizationId`,`occurredAt`);
--> statement-breakpoint
CREATE INDEX `professionalTrackingEvents_actor_occurred_idx` ON `professionalPatientTrackingEvents` (`actorUserId`,`occurredAt`);
