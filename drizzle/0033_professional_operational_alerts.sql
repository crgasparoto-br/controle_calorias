CREATE TABLE `professionalOperationalRequests` (
  `id` varchar(64) NOT NULL,
  `authorizationId` varchar(64) NOT NULL,
  `professionalUserId` int NOT NULL,
  `patientUserId` int NOT NULL,
  `type` enum('weigh_in','professional_request') NOT NULL,
  `title` varchar(160) NOT NULL,
  `dueAt` timestamp NOT NULL,
  `state` enum('open','answered','cancelled','dismissed') NOT NULL DEFAULT 'open',
  `answeredAt` timestamp,
  `closedAt` timestamp,
  `closedByUserId` int,
  `closureReason` enum('response','weight_recorded','cancelled','dismissed','manual_resolution'),
  `responseReference` varchar(191),
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `professionalOperationalRequests_id` PRIMARY KEY (`id`),
  CONSTRAINT `professionalOperationalRequests_authorization_fk` FOREIGN KEY (`authorizationId`) REFERENCES `professionalPatientAuthorizations` (`id`) ON DELETE restrict ON UPDATE no action,
  CONSTRAINT `professionalOperationalRequests_professional_fk` FOREIGN KEY (`professionalUserId`) REFERENCES `users` (`id`) ON DELETE restrict ON UPDATE no action,
  CONSTRAINT `professionalOperationalRequests_patient_fk` FOREIGN KEY (`patientUserId`) REFERENCES `users` (`id`) ON DELETE restrict ON UPDATE no action,
  CONSTRAINT `professionalOperationalRequests_closed_by_fk` FOREIGN KEY (`closedByUserId`) REFERENCES `users` (`id`) ON DELETE set null ON UPDATE no action
);--> statement-breakpoint
CREATE INDEX `professionalOperationalRequests_scope_idx` ON `professionalOperationalRequests` (`professionalUserId`,`patientUserId`,`state`,`dueAt`);--> statement-breakpoint
CREATE INDEX `professionalOperationalRequests_patient_open_idx` ON `professionalOperationalRequests` (`patientUserId`,`state`,`createdAt`);--> statement-breakpoint
CREATE TABLE `professionalReviewSignals` (
  `id` varchar(64) NOT NULL,
  `authorizationId` varchar(64) NOT NULL,
  `professionalUserId` int NOT NULL,
  `patientUserId` int NOT NULL,
  `originType` varchar(80) NOT NULL,
  `originId` varchar(128) NOT NULL,
  `reason` varchar(500) NOT NULL,
  `state` enum('open','corrected','invalidated') NOT NULL DEFAULT 'open',
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `professionalReviewSignals_id` PRIMARY KEY (`id`),
  CONSTRAINT `professionalReviewSignals_origin_uq` UNIQUE (`authorizationId`,`originType`,`originId`),
  CONSTRAINT `professionalReviewSignals_authorization_fk` FOREIGN KEY (`authorizationId`) REFERENCES `professionalPatientAuthorizations` (`id`) ON DELETE restrict ON UPDATE no action
);--> statement-breakpoint
CREATE INDEX `professionalReviewSignals_scope_idx` ON `professionalReviewSignals` (`professionalUserId`,`patientUserId`,`state`,`createdAt`);--> statement-breakpoint
CREATE TABLE `professionalOperationalAlerts` (
  `id` varchar(64) NOT NULL,
  `dedupeKey` varchar(191) NOT NULL,
  `type` enum('no_food_records','weigh_in_overdue','goal_review_due','professional_request_overdue','record_requires_review') NOT NULL,
  `professionalUserId` int NOT NULL,
  `patientUserId` int NOT NULL,
  `authorizationId` varchar(64) NOT NULL,
  `originType` varchar(80) NOT NULL,
  `originId` varchar(128),
  `periodStart` timestamp,
  `periodEnd` timestamp,
  `reason` varchar(500) NOT NULL,
  `severity` enum('info','attention','urgent') NOT NULL DEFAULT 'attention',
  `state` enum('open','resolved','dismissed','inactive') NOT NULL DEFAULT 'open',
  `suggestedAction` varchar(300) NOT NULL,
  `resolvedByUserId` int,
  `resolvedAt` timestamp,
  `resolutionNote` varchar(500),
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `professionalOperationalAlerts_id` PRIMARY KEY (`id`),
  CONSTRAINT `professionalOperationalAlerts_dedupe_uq` UNIQUE (`dedupeKey`),
  CONSTRAINT `professionalOperationalAlerts_authorization_fk` FOREIGN KEY (`authorizationId`) REFERENCES `professionalPatientAuthorizations` (`id`) ON DELETE restrict ON UPDATE no action
);--> statement-breakpoint
CREATE INDEX `professionalOperationalAlerts_professional_state_idx` ON `professionalOperationalAlerts` (`professionalUserId`,`state`,`updatedAt`);--> statement-breakpoint
CREATE INDEX `professionalOperationalAlerts_patient_state_idx` ON `professionalOperationalAlerts` (`patientUserId`,`state`,`updatedAt`);