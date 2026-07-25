CREATE TABLE `billingAccessAuditEvents` (
	`id` varchar(64) NOT NULL,
	`subjectUserId` int NOT NULL,
	`actorUserId` int,
	`action` enum('subscription_status_changed','entitlement_granted','entitlement_ended','entitlement_revoked','capacity_reserved','capacity_released','override_granted','override_revoked') NOT NULL,
	`sourceType` varchar(64) NOT NULL,
	`sourceId` varchar(191) NOT NULL,
	`reason` text,
	`metadataJson` json,
	`occurredAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `billingAccessAuditEvents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `billingAdminOverrides` (
	`id` varchar(64) NOT NULL,
	`userId` int NOT NULL,
	`accessWithoutSubscription` boolean NOT NULL DEFAULT true,
	`reason` text NOT NULL,
	`startsAt` timestamp NOT NULL DEFAULT (now()),
	`endsAt` timestamp,
	`state` enum('active','revoked','expired') NOT NULL DEFAULT 'active',
	`activeUserKey` varchar(64),
	`grantedByUserId` int,
	`revokedByUserId` int,
	`revokedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `billingAdminOverrides_id` PRIMARY KEY(`id`),
	CONSTRAINT `billingAdminOverrides_active_user_uq` UNIQUE(`activeUserKey`)
);
--> statement-breakpoint
CREATE TABLE `billingCapacityAllocations` (
	`id` varchar(64) NOT NULL,
	`subscriptionId` varchar(64) NOT NULL,
	`professionalUserId` int NOT NULL,
	`patientUserId` int NOT NULL,
	`authorizationId` varchar(64),
	`coverageKey` varchar(191) NOT NULL,
	`state` enum('reserved','active','released') NOT NULL DEFAULT 'active',
	`reservedAt` timestamp NOT NULL DEFAULT (now()),
	`activatedAt` timestamp,
	`releasedAt` timestamp,
	`releaseReason` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `billingCapacityAllocations_id` PRIMARY KEY(`id`),
	CONSTRAINT `billingCapacityAllocations_coverage_key_uq` UNIQUE(`coverageKey`)
);
--> statement-breakpoint
CREATE TABLE `billingEntitlements` (
	`id` varchar(64) NOT NULL,
	`beneficiaryUserId` int NOT NULL,
	`sourceType` enum('subscription','professional_coverage','trial','free_access','admin_override') NOT NULL,
	`sourceId` varchar(191) NOT NULL,
	`sponsorUserId` int,
	`planId` varchar(64),
	`professionalAuthorizationId` varchar(64),
	`state` enum('active','ended','revoked','ineligible') NOT NULL DEFAULT 'active',
	`activeGrantKey` varchar(191),
	`entitlementsJson` json NOT NULL,
	`validFrom` timestamp NOT NULL DEFAULT (now()),
	`validUntil` timestamp,
	`endedAt` timestamp,
	`revokedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `billingEntitlements_id` PRIMARY KEY(`id`),
	CONSTRAINT `billingEntitlements_active_grant_uq` UNIQUE(`activeGrantKey`)
);
--> statement-breakpoint
CREATE TABLE `billingPlans` (
	`id` varchar(64) NOT NULL,
	`code` varchar(120) NOT NULL,
	`audience` enum('individual','professional') NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`currency` varchar(3) NOT NULL,
	`unitAmount` int NOT NULL,
	`billingCycle` enum('monthly','yearly','custom') NOT NULL,
	`capacityLimit` int,
	`entitlementsJson` json NOT NULL,
	`active` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `billingPlans_id` PRIMARY KEY(`id`),
	CONSTRAINT `billingPlans_code_uq` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `billingProviderEvents` (
	`id` varchar(64) NOT NULL,
	`provider` varchar(64) NOT NULL,
	`providerEventId` varchar(191) NOT NULL,
	`eventType` varchar(120) NOT NULL,
	`status` enum('received','processed','ignored','failed') NOT NULL DEFAULT 'received',
	`subscriptionId` varchar(64),
	`occurredAt` timestamp,
	`processedAt` timestamp,
	`payloadJson` json,
	`errorCode` varchar(120),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `billingProviderEvents_id` PRIMARY KEY(`id`),
	CONSTRAINT `billingProviderEvents_provider_event_uq` UNIQUE(`provider`,`providerEventId`)
);
--> statement-breakpoint
CREATE TABLE `billingSubscriptions` (
	`id` varchar(64) NOT NULL,
	`provider` varchar(64) NOT NULL,
	`payerUserId` int NOT NULL,
	`planId` varchar(64) NOT NULL,
	`externalCustomerId` varchar(191),
	`externalSubscriptionId` varchar(191),
	`status` enum('pending','active','past_due','canceled','expired') NOT NULL DEFAULT 'pending',
	`activeHolderPlanKey` varchar(191),
	`currentPeriodStart` timestamp,
	`currentPeriodEnd` timestamp,
	`cancelAtPeriodEnd` boolean NOT NULL DEFAULT false,
	`canceledAt` timestamp,
	`endedAt` timestamp,
	`lastProviderEventAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `billingSubscriptions_id` PRIMARY KEY(`id`),
	CONSTRAINT `billingSubscriptions_provider_external_uq` UNIQUE(`provider`,`externalSubscriptionId`),
	CONSTRAINT `billingSubscriptions_active_holder_plan_uq` UNIQUE(`activeHolderPlanKey`)
);
--> statement-breakpoint
ALTER TABLE `billingAccessAuditEvents` ADD CONSTRAINT `billingAccessAuditEvents_subjectUserId_users_id_fk` FOREIGN KEY (`subjectUserId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `billingAccessAuditEvents` ADD CONSTRAINT `billingAccessAuditEvents_actorUserId_users_id_fk` FOREIGN KEY (`actorUserId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `billingAdminOverrides` ADD CONSTRAINT `billingAdminOverrides_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `billingAdminOverrides` ADD CONSTRAINT `billingAdminOverrides_grantedByUserId_users_id_fk` FOREIGN KEY (`grantedByUserId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `billingAdminOverrides` ADD CONSTRAINT `billingAdminOverrides_revokedByUserId_users_id_fk` FOREIGN KEY (`revokedByUserId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `billingCapacityAllocations` ADD CONSTRAINT `billingCapacityAllocations_subscriptionId_billingSubscriptions_id_fk` FOREIGN KEY (`subscriptionId`) REFERENCES `billingSubscriptions`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `billingCapacityAllocations` ADD CONSTRAINT `billingCapacityAllocations_professionalUserId_users_id_fk` FOREIGN KEY (`professionalUserId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `billingCapacityAllocations` ADD CONSTRAINT `billingCapacityAllocations_patientUserId_users_id_fk` FOREIGN KEY (`patientUserId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `billingCapacityAllocations` ADD CONSTRAINT `billingCapacityAllocations_authorizationId_professionalPatientAuthorizations_id_fk` FOREIGN KEY (`authorizationId`) REFERENCES `professionalPatientAuthorizations`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `billingEntitlements` ADD CONSTRAINT `billingEntitlements_beneficiaryUserId_users_id_fk` FOREIGN KEY (`beneficiaryUserId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `billingEntitlements` ADD CONSTRAINT `billingEntitlements_sponsorUserId_users_id_fk` FOREIGN KEY (`sponsorUserId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `billingEntitlements` ADD CONSTRAINT `billingEntitlements_planId_billingPlans_id_fk` FOREIGN KEY (`planId`) REFERENCES `billingPlans`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `billingEntitlements` ADD CONSTRAINT `billingEntitlements_professionalAuthorizationId_professionalPatientAuthorizations_id_fk` FOREIGN KEY (`professionalAuthorizationId`) REFERENCES `professionalPatientAuthorizations`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `billingProviderEvents` ADD CONSTRAINT `billingProviderEvents_subscriptionId_billingSubscriptions_id_fk` FOREIGN KEY (`subscriptionId`) REFERENCES `billingSubscriptions`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `billingSubscriptions` ADD CONSTRAINT `billingSubscriptions_payerUserId_users_id_fk` FOREIGN KEY (`payerUserId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `billingSubscriptions` ADD CONSTRAINT `billingSubscriptions_planId_billingPlans_id_fk` FOREIGN KEY (`planId`) REFERENCES `billingPlans`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `billingAccessAuditEvents_subject_occurred_idx` ON `billingAccessAuditEvents` (`subjectUserId`,`occurredAt`);--> statement-breakpoint
CREATE INDEX `billingAccessAuditEvents_actor_occurred_idx` ON `billingAccessAuditEvents` (`actorUserId`,`occurredAt`);--> statement-breakpoint
CREATE INDEX `billingAccessAuditEvents_source_occurred_idx` ON `billingAccessAuditEvents` (`sourceType`,`sourceId`,`occurredAt`);--> statement-breakpoint
CREATE INDEX `billingAdminOverrides_user_state_idx` ON `billingAdminOverrides` (`userId`,`state`);--> statement-breakpoint
CREATE INDEX `billingAdminOverrides_grantor_created_idx` ON `billingAdminOverrides` (`grantedByUserId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `billingCapacityAllocations_subscription_state_idx` ON `billingCapacityAllocations` (`subscriptionId`,`state`);--> statement-breakpoint
CREATE INDEX `billingCapacityAllocations_professional_state_idx` ON `billingCapacityAllocations` (`professionalUserId`,`state`);--> statement-breakpoint
CREATE INDEX `billingCapacityAllocations_patient_state_idx` ON `billingCapacityAllocations` (`patientUserId`,`state`);--> statement-breakpoint
CREATE INDEX `billingEntitlements_beneficiary_state_idx` ON `billingEntitlements` (`beneficiaryUserId`,`state`);--> statement-breakpoint
CREATE INDEX `billingEntitlements_sponsor_state_idx` ON `billingEntitlements` (`sponsorUserId`,`state`);--> statement-breakpoint
CREATE INDEX `billingEntitlements_source_idx` ON `billingEntitlements` (`sourceType`,`sourceId`);--> statement-breakpoint
CREATE INDEX `billingPlans_audience_active_idx` ON `billingPlans` (`audience`,`active`);--> statement-breakpoint
CREATE INDEX `billingProviderEvents_subscription_created_idx` ON `billingProviderEvents` (`subscriptionId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `billingProviderEvents_status_created_idx` ON `billingProviderEvents` (`status`,`createdAt`);--> statement-breakpoint
CREATE INDEX `billingSubscriptions_payer_status_idx` ON `billingSubscriptions` (`payerUserId`,`status`);--> statement-breakpoint
CREATE INDEX `billingSubscriptions_plan_status_idx` ON `billingSubscriptions` (`planId`,`status`);