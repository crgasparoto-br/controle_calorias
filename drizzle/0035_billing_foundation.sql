CREATE TABLE `billingPlans` (
  `id` int AUTO_INCREMENT NOT NULL,
  `code` varchar(80) NOT NULL,
  `name` varchar(160) NOT NULL,
  `description` text,
  `audience` enum('professional','individual') NOT NULL DEFAULT 'professional',
  `amountMinor` int NOT NULL,
  `currency` varchar(3) NOT NULL,
  `billingCycle` enum('monthly','yearly','custom') NOT NULL DEFAULT 'monthly',
  `patientCapacity` int,
  `entitlementsJson` json NOT NULL,
  `sponsoredEntitlementsJson` json,
  `provider` varchar(40) NOT NULL,
  `providerPlanId` varchar(191),
  `active` boolean NOT NULL DEFAULT false,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `billingPlans_id` PRIMARY KEY(`id`),
  CONSTRAINT `billingPlans_code_unique_idx` UNIQUE(`code`),
  CONSTRAINT `billingPlans_provider_plan_unique_idx` UNIQUE(`provider`,`providerPlanId`)
);
--> statement-breakpoint
CREATE INDEX `billingPlans_audience_active_idx` ON `billingPlans` (`audience`,`active`);
--> statement-breakpoint
CREATE TABLE `billingSubscriptions` (
  `id` varchar(64) NOT NULL,
  `payerUserId` int NOT NULL,
  `planId` int NOT NULL,
  `provider` varchar(40) NOT NULL,
  `providerCustomerId` varchar(191),
  `providerSubscriptionId` varchar(191),
  `status` enum('pending','active','past_due','canceled','expired') NOT NULL DEFAULT 'pending',
  `currentPeriodStart` timestamp NULL,
  `currentPeriodEnd` timestamp NULL,
  `cancelAtPeriodEnd` boolean NOT NULL DEFAULT false,
  `canceledAt` timestamp NULL,
  `endedAt` timestamp NULL,
  `providerStateUpdatedAt` timestamp NULL,
  `activePayerPlanKey` varchar(191),
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `billingSubscriptions_id` PRIMARY KEY(`id`),
  CONSTRAINT `billingSubscriptions_provider_subscription_unique_idx` UNIQUE(`provider`,`providerSubscriptionId`),
  CONSTRAINT `billingSubscriptions_active_payer_plan_unique_idx` UNIQUE(`activePayerPlanKey`),
  CONSTRAINT `billingSubscriptions_payerUserId_users_id_fk` FOREIGN KEY (`payerUserId`) REFERENCES `users`(`id`) ON DELETE cascade,
  CONSTRAINT `billingSubscriptions_planId_billingPlans_id_fk` FOREIGN KEY (`planId`) REFERENCES `billingPlans`(`id`) ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `billingSubscriptions_payer_status_idx` ON `billingSubscriptions` (`payerUserId`,`status`);
--> statement-breakpoint
CREATE INDEX `billingSubscriptions_plan_status_idx` ON `billingSubscriptions` (`planId`,`status`);
--> statement-breakpoint
CREATE TABLE `billingProviderEvents` (
  `id` int AUTO_INCREMENT NOT NULL,
  `provider` varchar(40) NOT NULL,
  `providerEventId` varchar(191) NOT NULL,
  `eventType` varchar(120) NOT NULL,
  `subscriptionId` varchar(64),
  `payloadHash` varchar(64) NOT NULL,
  `sanitizedPayloadJson` json,
  `status` enum('received','processed','failed','ignored') NOT NULL DEFAULT 'received',
  `occurredAt` timestamp NULL,
  `processedAt` timestamp NULL,
  `errorCode` varchar(120),
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `billingProviderEvents_id` PRIMARY KEY(`id`),
  CONSTRAINT `billingProviderEvents_provider_event_unique_idx` UNIQUE(`provider`,`providerEventId`),
  CONSTRAINT `billingProviderEvents_subscriptionId_billingSubscriptions_id_fk` FOREIGN KEY (`subscriptionId`) REFERENCES `billingSubscriptions`(`id`) ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `billingProviderEvents_subscription_created_idx` ON `billingProviderEvents` (`subscriptionId`,`createdAt`);
--> statement-breakpoint
CREATE INDEX `billingProviderEvents_status_created_idx` ON `billingProviderEvents` (`status`,`createdAt`);
--> statement-breakpoint
CREATE TABLE `billingEntitlements` (
  `id` varchar(64) NOT NULL,
  `beneficiaryUserId` int NOT NULL,
  `audience` enum('professional','individual') NOT NULL DEFAULT 'individual',
  `source` enum('subscription','professional_coverage','trial','free_access') NOT NULL,
  `sourceSubscriptionId` varchar(64),
  `sponsorUserId` int,
  `professionalAuthorizationId` varchar(64),
  `status` enum('active','ended','revoked','ineligible') NOT NULL DEFAULT 'active',
  `planCode` varchar(80),
  `entitlementsJson` json NOT NULL,
  `validFrom` timestamp NOT NULL,
  `validUntil` timestamp NULL,
  `endedReason` varchar(160),
  `activeBeneficiarySourceKey` varchar(191),
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `billingEntitlements_id` PRIMARY KEY(`id`),
  CONSTRAINT `billingEntitlements_active_beneficiary_source_unique_idx` UNIQUE(`activeBeneficiarySourceKey`),
  CONSTRAINT `billingEntitlements_beneficiaryUserId_users_id_fk` FOREIGN KEY (`beneficiaryUserId`) REFERENCES `users`(`id`) ON DELETE cascade,
  CONSTRAINT `billingEntitlements_sourceSubscriptionId_billingSubscriptions_id_fk` FOREIGN KEY (`sourceSubscriptionId`) REFERENCES `billingSubscriptions`(`id`) ON DELETE set null,
  CONSTRAINT `billingEntitlements_sponsorUserId_users_id_fk` FOREIGN KEY (`sponsorUserId`) REFERENCES `users`(`id`) ON DELETE set null,
  CONSTRAINT `billingEntitlements_professionalAuthorizationId_fk` FOREIGN KEY (`professionalAuthorizationId`) REFERENCES `professionalPatientAuthorizations`(`id`) ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `billingEntitlements_beneficiary_status_idx` ON `billingEntitlements` (`beneficiaryUserId`,`status`);
--> statement-breakpoint
CREATE INDEX `billingEntitlements_sponsor_status_idx` ON `billingEntitlements` (`sponsorUserId`,`status`);
--> statement-breakpoint
CREATE INDEX `billingEntitlements_subscription_status_idx` ON `billingEntitlements` (`sourceSubscriptionId`,`status`);
--> statement-breakpoint
CREATE TABLE `billingCapacityReservations` (
  `id` varchar(64) NOT NULL,
  `subscriptionId` varchar(64) NOT NULL,
  `professionalUserId` int NOT NULL,
  `patientUserId` int NOT NULL,
  `professionalAuthorizationId` varchar(64),
  `coverageKey` varchar(191) NOT NULL,
  `slotNumber` int NOT NULL,
  `status` enum('active','released') NOT NULL DEFAULT 'active',
  `activeCoverageKey` varchar(191),
  `activeSlotKey` varchar(191),
  `reservedAt` timestamp NOT NULL,
  `releasedAt` timestamp NULL,
  `releaseReason` varchar(160),
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `billingCapacityReservations_id` PRIMARY KEY(`id`),
  CONSTRAINT `billingCapacityReservations_active_coverage_unique_idx` UNIQUE(`activeCoverageKey`),
  CONSTRAINT `billingCapacityReservations_active_slot_unique_idx` UNIQUE(`activeSlotKey`),
  CONSTRAINT `billingCapacityReservations_subscriptionId_fk` FOREIGN KEY (`subscriptionId`) REFERENCES `billingSubscriptions`(`id`) ON DELETE cascade,
  CONSTRAINT `billingCapacityReservations_professionalUserId_fk` FOREIGN KEY (`professionalUserId`) REFERENCES `users`(`id`) ON DELETE cascade,
  CONSTRAINT `billingCapacityReservations_patientUserId_fk` FOREIGN KEY (`patientUserId`) REFERENCES `users`(`id`) ON DELETE cascade,
  CONSTRAINT `billingCapacityReservations_professionalAuthorizationId_fk` FOREIGN KEY (`professionalAuthorizationId`) REFERENCES `professionalPatientAuthorizations`(`id`) ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `billingCapacityReservations_subscription_status_idx` ON `billingCapacityReservations` (`subscriptionId`,`status`);
--> statement-breakpoint
CREATE INDEX `billingCapacityReservations_professional_status_idx` ON `billingCapacityReservations` (`professionalUserId`,`status`);
--> statement-breakpoint
CREATE INDEX `billingCapacityReservations_patient_status_idx` ON `billingCapacityReservations` (`patientUserId`,`status`);
--> statement-breakpoint
CREATE TABLE `billingAccessOverrides` (
  `id` varchar(64) NOT NULL,
  `userId` int NOT NULL,
  `accessWithoutSubscription` boolean NOT NULL DEFAULT true,
  `reason` text NOT NULL,
  `startsAt` timestamp NOT NULL,
  `endsAt` timestamp NULL,
  `active` boolean NOT NULL DEFAULT true,
  `activeUserKey` varchar(64),
  `grantedByUserId` int,
  `revokedByUserId` int,
  `revokedAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `billingAccessOverrides_id` PRIMARY KEY(`id`),
  CONSTRAINT `billingAccessOverrides_active_user_unique_idx` UNIQUE(`activeUserKey`),
  CONSTRAINT `billingAccessOverrides_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade,
  CONSTRAINT `billingAccessOverrides_grantedByUserId_users_id_fk` FOREIGN KEY (`grantedByUserId`) REFERENCES `users`(`id`) ON DELETE set null,
  CONSTRAINT `billingAccessOverrides_revokedByUserId_users_id_fk` FOREIGN KEY (`revokedByUserId`) REFERENCES `users`(`id`) ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `billingAccessOverrides_user_active_idx` ON `billingAccessOverrides` (`userId`,`active`);
--> statement-breakpoint
CREATE INDEX `billingAccessOverrides_ends_at_idx` ON `billingAccessOverrides` (`endsAt`);
--> statement-breakpoint
CREATE TABLE `billingAuditEvents` (
  `id` varchar(64) NOT NULL,
  `actorUserId` int,
  `subjectUserId` int,
  `action` varchar(120) NOT NULL,
  `entityType` varchar(80) NOT NULL,
  `entityId` varchar(191) NOT NULL,
  `metadataJson` json,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `billingAuditEvents_id` PRIMARY KEY(`id`),
  CONSTRAINT `billingAuditEvents_actorUserId_users_id_fk` FOREIGN KEY (`actorUserId`) REFERENCES `users`(`id`) ON DELETE set null,
  CONSTRAINT `billingAuditEvents_subjectUserId_users_id_fk` FOREIGN KEY (`subjectUserId`) REFERENCES `users`(`id`) ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `billingAuditEvents_subject_created_idx` ON `billingAuditEvents` (`subjectUserId`,`createdAt`);
--> statement-breakpoint
CREATE INDEX `billingAuditEvents_actor_created_idx` ON `billingAuditEvents` (`actorUserId`,`createdAt`);
--> statement-breakpoint
CREATE INDEX `billingAuditEvents_entity_created_idx` ON `billingAuditEvents` (`entityType`,`entityId`,`createdAt`);
