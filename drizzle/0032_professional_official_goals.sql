CREATE TABLE `professionalOfficialGoals` (
  `id` varchar(64) NOT NULL,
  `authorizationId` varchar(64) NOT NULL,
  `trackingId` varchar(64) NOT NULL,
  `professionalUserId` int NOT NULL,
  `patientUserId` int NOT NULL,
  `activePatientKey` varchar(64),
  `version` int NOT NULL,
  `status` enum('active','superseded','ended') NOT NULL DEFAULT 'active',
  `calories` int NOT NULL,
  `proteinGrams` int NOT NULL,
  `carbsGrams` int NOT NULL,
  `fatGrams` int NOT NULL,
  `exceptionsJson` json NOT NULL,
  `includeExerciseCalories` boolean NOT NULL DEFAULT true,
  `effectiveFrom` timestamp NOT NULL,
  `effectiveUntil` timestamp,
  `justification` text NOT NULL,
  `supersedesGoalId` varchar(64),
  `endedAt` timestamp,
  `endReason` varchar(160),
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `professionalOfficialGoals_id` PRIMARY KEY (`id`),
  CONSTRAINT `professionalOfficialGoals_active_patient_uq` UNIQUE (`activePatientKey`),
  CONSTRAINT `professionalOfficialGoals_authorization_version_uq` UNIQUE (`authorizationId`,`version`)
);--> statement-breakpoint
ALTER TABLE `professionalOfficialGoals` ADD CONSTRAINT `professionalOfficialGoals_authorization_fk` FOREIGN KEY (`authorizationId`) REFERENCES `professionalPatientAuthorizations` (`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `professionalOfficialGoals` ADD CONSTRAINT `professionalOfficialGoals_tracking_fk` FOREIGN KEY (`trackingId`) REFERENCES `professionalPatientTrackings` (`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `professionalOfficialGoals` ADD CONSTRAINT `professionalOfficialGoals_professional_fk` FOREIGN KEY (`professionalUserId`) REFERENCES `users` (`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `professionalOfficialGoals` ADD CONSTRAINT `professionalOfficialGoals_patient_fk` FOREIGN KEY (`patientUserId`) REFERENCES `users` (`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `professionalOfficialGoals` ADD CONSTRAINT `professionalOfficialGoals_supersedes_fk` FOREIGN KEY (`supersedesGoalId`) REFERENCES `professionalOfficialGoals` (`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `professionalOfficialGoals_patient_effective_idx` ON `professionalOfficialGoals` (`patientUserId`,`effectiveFrom`,`effectiveUntil`);--> statement-breakpoint
CREATE TABLE `professionalGoalReviewRequests` (
  `id` varchar(64) NOT NULL,
  `goalId` varchar(64) NOT NULL,
  `professionalUserId` int NOT NULL,
  `patientUserId` int NOT NULL,
  `openRequestKey` varchar(128),
  `reason` text,
  `status` enum('open','resolved','cancelled') NOT NULL DEFAULT 'open',
  `resolvedByUserId` int,
  `resolvedAt` timestamp,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `professionalGoalReviewRequests_id` PRIMARY KEY (`id`),
  CONSTRAINT `professionalGoalReviewRequests_open_uq` UNIQUE (`openRequestKey`)
);--> statement-breakpoint
ALTER TABLE `professionalGoalReviewRequests` ADD CONSTRAINT `professionalGoalReviewRequests_goal_fk` FOREIGN KEY (`goalId`) REFERENCES `professionalOfficialGoals` (`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `professionalGoalReviewRequests` ADD CONSTRAINT `professionalGoalReviewRequests_professional_fk` FOREIGN KEY (`professionalUserId`) REFERENCES `users` (`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `professionalGoalReviewRequests` ADD CONSTRAINT `professionalGoalReviewRequests_patient_fk` FOREIGN KEY (`patientUserId`) REFERENCES `users` (`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `professionalGoalReviewRequests` ADD CONSTRAINT `professionalGoalReviewRequests_resolver_fk` FOREIGN KEY (`resolvedByUserId`) REFERENCES `users` (`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `professionalGoalReviewRequests_professional_status_idx` ON `professionalGoalReviewRequests` (`professionalUserId`,`status`,`createdAt`);--> statement-breakpoint
CREATE INDEX `professionalGoalReviewRequests_patient_status_idx` ON `professionalGoalReviewRequests` (`patientUserId`,`status`,`createdAt`);--> statement-breakpoint
CREATE TABLE `professionalGoalNotifications` (
  `id` varchar(64) NOT NULL,
  `goalId` varchar(64) NOT NULL,
  `patientUserId` int NOT NULL,
  `idempotencyKey` varchar(128) NOT NULL,
  `channel` enum('whatsapp') NOT NULL DEFAULT 'whatsapp',
  `status` enum('pending','sending','sent','failed','skipped') NOT NULL DEFAULT 'pending',
  `attempts` int NOT NULL DEFAULT 0,
  `claimToken` varchar(64),
  `claimedAt` timestamp,
  `sentAt` timestamp,
  `lastError` varchar(500),
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `professionalGoalNotifications_id` PRIMARY KEY (`id`),
  CONSTRAINT `professionalGoalNotifications_idempotency_uq` UNIQUE (`idempotencyKey`)
);--> statement-breakpoint
ALTER TABLE `professionalGoalNotifications` ADD CONSTRAINT `professionalGoalNotifications_goal_fk` FOREIGN KEY (`goalId`) REFERENCES `professionalOfficialGoals` (`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `professionalGoalNotifications` ADD CONSTRAINT `professionalGoalNotifications_patient_fk` FOREIGN KEY (`patientUserId`) REFERENCES `users` (`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `professionalGoalNotifications_status_created_idx` ON `professionalGoalNotifications` (`status`,`createdAt`);
