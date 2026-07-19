CREATE TABLE `professionalAssessments` (
  `id` varchar(64) NOT NULL,
  `authorizationId` varchar(64) NOT NULL,
  `professionalUserId` int NOT NULL,
  `patientUserId` int NOT NULL,
  `version` int NOT NULL,
  `objective` text NOT NULL,
  `weightKg` decimal(7,2),
  `heightCm` decimal(7,2),
  `routineAndSchedule` text,
  `physicalActivity` text,
  `foodPreferences` text,
  `restrictionsAndAllergies` text,
  `reportedDifficulties` text,
  `relevantHabits` text,
  `professionalObservations` text,
  `assessedAt` timestamp NOT NULL,
  `nextReviewAt` timestamp,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `professionalAssessments_id` PRIMARY KEY (`id`),
  CONSTRAINT `professionalAssessments_authorization_version_uq` UNIQUE (`authorizationId`,`version`)
);--> statement-breakpoint
ALTER TABLE `professionalAssessments` ADD CONSTRAINT `professionalAssessments_authorization_fk` FOREIGN KEY (`authorizationId`) REFERENCES `professionalPatientAuthorizations` (`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `professionalAssessments` ADD CONSTRAINT `professionalAssessments_professional_fk` FOREIGN KEY (`professionalUserId`) REFERENCES `users` (`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `professionalAssessments` ADD CONSTRAINT `professionalAssessments_patient_fk` FOREIGN KEY (`patientUserId`) REFERENCES `users` (`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `professionalAssessments_scope_idx` ON `professionalAssessments` (`professionalUserId`,`patientUserId`,`assessedAt`,`id`);--> statement-breakpoint
CREATE TABLE `professionalNotes` (
  `id` varchar(64) NOT NULL,
  `authorizationId` varchar(64) NOT NULL,
  `professionalUserId` int NOT NULL,
  `patientUserId` int NOT NULL,
  `content` text NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `professionalNotes_id` PRIMARY KEY (`id`)
);--> statement-breakpoint
ALTER TABLE `professionalNotes` ADD CONSTRAINT `professionalNotes_authorization_fk` FOREIGN KEY (`authorizationId`) REFERENCES `professionalPatientAuthorizations` (`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `professionalNotes` ADD CONSTRAINT `professionalNotes_professional_fk` FOREIGN KEY (`professionalUserId`) REFERENCES `users` (`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `professionalNotes` ADD CONSTRAINT `professionalNotes_patient_fk` FOREIGN KEY (`patientUserId`) REFERENCES `users` (`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `professionalNotes_scope_idx` ON `professionalNotes` (`professionalUserId`,`patientUserId`,`createdAt`,`id`);--> statement-breakpoint
CREATE TABLE `professionalGuidances` (
  `id` varchar(64) NOT NULL,
  `authorizationId` varchar(64) NOT NULL,
  `professionalUserId` int NOT NULL,
  `patientUserId` int NOT NULL,
  `version` int NOT NULL,
  `title` varchar(160) NOT NULL,
  `content` text NOT NULL,
  `visibility` enum('patient') NOT NULL DEFAULT 'patient',
  `deliveryStatus` enum('draft','pending','sent','failed') NOT NULL DEFAULT 'draft',
  `supersedesGuidanceId` varchar(64),
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `professionalGuidances_id` PRIMARY KEY (`id`),
  CONSTRAINT `professionalGuidances_authorization_version_uq` UNIQUE (`authorizationId`,`version`)
);--> statement-breakpoint
ALTER TABLE `professionalGuidances` ADD CONSTRAINT `professionalGuidances_authorization_fk` FOREIGN KEY (`authorizationId`) REFERENCES `professionalPatientAuthorizations` (`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `professionalGuidances` ADD CONSTRAINT `professionalGuidances_professional_fk` FOREIGN KEY (`professionalUserId`) REFERENCES `users` (`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `professionalGuidances` ADD CONSTRAINT `professionalGuidances_patient_fk` FOREIGN KEY (`patientUserId`) REFERENCES `users` (`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `professionalGuidances` ADD CONSTRAINT `professionalGuidances_supersedes_fk` FOREIGN KEY (`supersedesGuidanceId`) REFERENCES `professionalGuidances` (`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `professionalGuidances_professional_scope_idx` ON `professionalGuidances` (`professionalUserId`,`patientUserId`,`createdAt`,`id`);--> statement-breakpoint
CREATE INDEX `professionalGuidances_patient_visibility_idx` ON `professionalGuidances` (`patientUserId`,`visibility`,`createdAt`,`id`);
