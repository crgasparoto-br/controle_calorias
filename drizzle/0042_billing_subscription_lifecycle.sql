CREATE TABLE `billingContractIntents` (
  `id` varchar(64) NOT NULL,
  `contractKey` varchar(191) NOT NULL,
  `subscriptionId` varchar(64) NOT NULL,
  `payerUserId` int NOT NULL,
  `planId` varchar(64) NOT NULL,
  `provider` varchar(64) NOT NULL,
  `paymentMethod` enum('credit_card','pix_automatic') NOT NULL,
  `trialChoice` enum('request','waive') NOT NULL,
  `trialWaivedAt` timestamp,
  `couponContractKey` varchar(191),
  `state` enum('pending','confirmed','failed','expired','canceled') NOT NULL DEFAULT 'pending',
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `billingContractIntents_id` PRIMARY KEY(`id`),
  CONSTRAINT `billingContractIntents_contract_key_uq` UNIQUE(`contractKey`),
  CONSTRAINT `billingContractIntents_subscription_uq` UNIQUE(`subscriptionId`)
);
--> statement-breakpoint
CREATE TABLE `billingSubscriptionLifecycle` (
  `subscriptionId` varchar(64) NOT NULL,
  `audience` enum('individual','professional') NOT NULL,
  `state` enum('pending','active','past_due','suspended','expired') NOT NULL DEFAULT 'pending',
  `revision` int NOT NULL DEFAULT 0,
  `trialStartedAt` timestamp,
  `trialEndsAt` timestamp,
  `firstChargeAt` timestamp,
  `trialCapacityLimit` int,
  `graceStartedAt` timestamp,
  `graceEndsAt` timestamp,
  `suspendedAt` timestamp,
  `recoveryEndsAt` timestamp,
  `lastAuthoritativeOccurredAt` timestamp,
  `lastConfirmedCompetenceKey` varchar(191),
  `reconciliationRequired` boolean NOT NULL DEFAULT false,
  `reconciliationReason` text,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `billingSubscriptionLifecycle_subscriptionId` PRIMARY KEY(`subscriptionId`)
);
--> statement-breakpoint
CREATE TABLE `billingTrialIdentityClaims` (
  `id` varchar(64) NOT NULL,
  `subscriptionId` varchar(64),
  `audience` enum('individual','professional') NOT NULL,
  `identityType` enum('user','cpf','cnpj','phone') NOT NULL,
  `identityHash` varchar(64) NOT NULL,
  `claimedAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `billingTrialIdentityClaims_id` PRIMARY KEY(`id`),
  CONSTRAINT `billingTrialIdentityClaims_identity_uq` UNIQUE(`audience`,`identityType`,`identityHash`)
);
--> statement-breakpoint
CREATE TABLE `billingTrialEligibilityAuditEvents` (
  `id` varchar(64) NOT NULL,
  `payerUserId` int,
  `audience` enum('individual','professional') NOT NULL,
  `versionCode` varchar(191) NOT NULL,
  `decision` enum('allowed','denied','review_required') NOT NULL,
  `reason` varchar(120) NOT NULL,
  `identityTypesJson` json NOT NULL,
  `correlationId` varchar(191) NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `billingTrialEligibilityAuditEvents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `billingSubscriptionFacts` (
  `id` varchar(64) NOT NULL,
  `subscriptionId` varchar(64) NOT NULL,
  `payerUserId` int NOT NULL,
  `factType` varchar(120) NOT NULL,
  `factVersion` int NOT NULL DEFAULT 1,
  `idempotencyKey` varchar(191) NOT NULL,
  `correlationId` varchar(191) NOT NULL,
  `audience` enum('individual','professional') NOT NULL,
  `productCode` varchar(120) NOT NULL,
  `versionCode` varchar(191) NOT NULL,
  `billingCycle` enum('monthly','yearly','custom') NOT NULL,
  `previousState` enum('pending','active','past_due','suspended','expired') NOT NULL,
  `newState` enum('pending','active','past_due','suspended','expired') NOT NULL,
  `actionAllowed` varchar(120),
  `effectiveAt` timestamp NOT NULL,
  `payloadJson` json,
  `invalidatedAt` timestamp,
  `invalidatedByFactId` varchar(64),
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `billingSubscriptionFacts_id` PRIMARY KEY(`id`),
  CONSTRAINT `billingSubscriptionFacts_idempotency_uq` UNIQUE(`idempotencyKey`)
);
--> statement-breakpoint
CREATE TABLE `billingSubscriptionLifecycleAuditEvents` (
  `id` varchar(64) NOT NULL,
  `subscriptionId` varchar(64) NOT NULL,
  `actorUserId` int,
  `action` varchar(120) NOT NULL,
  `reason` text NOT NULL,
  `metadataJson` json,
  `occurredAt` timestamp NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `billingSubscriptionLifecycleAuditEvents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `billingContractIntents` ADD CONSTRAINT `billingContractIntents_subscriptionId_fk` FOREIGN KEY (`subscriptionId`) REFERENCES `billingSubscriptions`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `billingContractIntents` ADD CONSTRAINT `billingContractIntents_payerUserId_fk` FOREIGN KEY (`payerUserId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `billingContractIntents` ADD CONSTRAINT `billingContractIntents_planId_fk` FOREIGN KEY (`planId`) REFERENCES `billingPlans`(`id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `billingSubscriptionLifecycle` ADD CONSTRAINT `billingSubscriptionLifecycle_subscriptionId_fk` FOREIGN KEY (`subscriptionId`) REFERENCES `billingSubscriptions`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `billingTrialIdentityClaims` ADD CONSTRAINT `billingTrialIdentityClaims_subscriptionId_fk` FOREIGN KEY (`subscriptionId`) REFERENCES `billingSubscriptions`(`id`) ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `billingTrialEligibilityAuditEvents` ADD CONSTRAINT `billingTrialEligibilityAuditEvents_payerUserId_fk` FOREIGN KEY (`payerUserId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `billingSubscriptionFacts` ADD CONSTRAINT `billingSubscriptionFacts_subscriptionId_fk` FOREIGN KEY (`subscriptionId`) REFERENCES `billingSubscriptions`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `billingSubscriptionFacts` ADD CONSTRAINT `billingSubscriptionFacts_payerUserId_fk` FOREIGN KEY (`payerUserId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `billingSubscriptionLifecycleAuditEvents` ADD CONSTRAINT `billingSubscriptionLifecycleAuditEvents_subscriptionId_fk` FOREIGN KEY (`subscriptionId`) REFERENCES `billingSubscriptions`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `billingSubscriptionLifecycleAuditEvents` ADD CONSTRAINT `billingSubscriptionLifecycleAuditEvents_actorUserId_fk` FOREIGN KEY (`actorUserId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX `billingContractIntents_payer_state_idx` ON `billingContractIntents` (`payerUserId`,`state`);
--> statement-breakpoint
CREATE INDEX `billingSubscriptionLifecycle_state_grace_idx` ON `billingSubscriptionLifecycle` (`state`,`graceEndsAt`);
--> statement-breakpoint
CREATE INDEX `billingSubscriptionLifecycle_state_recovery_idx` ON `billingSubscriptionLifecycle` (`state`,`recoveryEndsAt`);
--> statement-breakpoint
CREATE INDEX `billingSubscriptionLifecycle_state_trial_idx` ON `billingSubscriptionLifecycle` (`state`,`trialEndsAt`);
--> statement-breakpoint
CREATE INDEX `billingTrialIdentityClaims_subscription_idx` ON `billingTrialIdentityClaims` (`subscriptionId`);
--> statement-breakpoint
CREATE INDEX `billingTrialEligibilityAuditEvents_payer_created_idx` ON `billingTrialEligibilityAuditEvents` (`payerUserId`,`createdAt`);
--> statement-breakpoint
CREATE INDEX `billingTrialEligibilityAuditEvents_version_created_idx` ON `billingTrialEligibilityAuditEvents` (`versionCode`,`createdAt`);
--> statement-breakpoint
CREATE INDEX `billingSubscriptionFacts_subscription_created_idx` ON `billingSubscriptionFacts` (`subscriptionId`,`createdAt`);
--> statement-breakpoint
CREATE INDEX `billingSubscriptionFacts_subscription_type_idx` ON `billingSubscriptionFacts` (`subscriptionId`,`factType`);
--> statement-breakpoint
CREATE INDEX `billingSubscriptionLifecycleAuditEvents_sub_occurred_idx` ON `billingSubscriptionLifecycleAuditEvents` (`subscriptionId`,`occurredAt`);
--> statement-breakpoint
CREATE INDEX `billingSubscriptionLifecycleAuditEvents_actor_occurred_idx` ON `billingSubscriptionLifecycleAuditEvents` (`actorUserId`,`occurredAt`);
