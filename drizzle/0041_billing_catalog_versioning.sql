CREATE TABLE `billingCommercialAuditEvents` (
	`id` varchar(64) NOT NULL,
	`actorUserId` int,
	`entityType` enum('product','version','coupon') NOT NULL,
	`entityId` varchar(64) NOT NULL,
	`action` varchar(120) NOT NULL,
	`reason` text NOT NULL,
	`metadataJson` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `billingCommercialAuditEvents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `billingCouponRedemptions` (
	`id` varchar(64) NOT NULL,
	`couponId` varchar(64) NOT NULL,
	`planId` varchar(64) NOT NULL,
	`userId` int NOT NULL,
	`contractKey` varchar(191) NOT NULL,
	`state` enum('reserved','confirmed','canceled') NOT NULL DEFAULT 'reserved',
	`discountAmount` int NOT NULL,
	`finalAmount` int NOT NULL,
	`reservedAt` timestamp NOT NULL DEFAULT (now()),
	`confirmedAt` timestamp,
	`canceledAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `billingCouponRedemptions_id` PRIMARY KEY(`id`),
	CONSTRAINT `billingCouponRedemptions_contract_key_uq` UNIQUE(`contractKey`)
);
--> statement-breakpoint
CREATE TABLE `billingCoupons` (
	`id` varchar(64) NOT NULL,
	`code` varchar(80) NOT NULL,
	`revision` int NOT NULL,
	`activeCodeKey` varchar(80),
	`discountType` enum('percentage','fixed_amount') NOT NULL,
	`discountValue` int NOT NULL,
	`currency` varchar(3),
	`eligibleProductCodesJson` json NOT NULL,
	`eligibleVersionCodesJson` json NOT NULL,
	`eligibleCyclesJson` json NOT NULL,
	`validFrom` timestamp NOT NULL,
	`validUntil` timestamp,
	`maxTotalUses` int,
	`maxUsesPerUser` int,
	`firstContractOnly` boolean NOT NULL DEFAULT false,
	`durationCharges` int NOT NULL,
	`state` enum('active','inactive') NOT NULL DEFAULT 'active',
	`supersedesCouponId` varchar(64),
	`createdByUserId` int,
	`deactivatedByUserId` int,
	`deactivatedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `billingCoupons_id` PRIMARY KEY(`id`),
	CONSTRAINT `billingCoupons_active_code_uq` UNIQUE(`activeCodeKey`),
	CONSTRAINT `billingCoupons_code_revision_uq` UNIQUE(`code`,`revision`)
);
--> statement-breakpoint
CREATE TABLE `billingProducts` (
	`id` varchar(64) NOT NULL,
	`code` varchar(120) NOT NULL,
	`audience` enum('individual','professional') NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`state` enum('active','inactive') NOT NULL DEFAULT 'active',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `billingProducts_id` PRIMARY KEY(`id`),
	CONSTRAINT `billingProducts_code_uq` UNIQUE(`code`)
);
--> statement-breakpoint
ALTER TABLE `billingPlans` DROP INDEX `billingPlans_code_uq`;--> statement-breakpoint
ALTER TABLE `billingPlans` ADD `productId` varchar(64) NOT NULL;--> statement-breakpoint
ALTER TABLE `billingPlans` ADD `versionCode` varchar(191) NOT NULL;--> statement-breakpoint
ALTER TABLE `billingPlans` ADD `version` int NOT NULL;--> statement-breakpoint
ALTER TABLE `billingPlans` ADD `coveredBeneficiaryEntitlementsJson` json NOT NULL;--> statement-breakpoint
ALTER TABLE `billingPlans` ADD `commercialPaymentMethodsJson` json NOT NULL;--> statement-breakpoint
ALTER TABLE `billingPlans` ADD `status` enum('draft','active','inactive') DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE `billingPlans` ADD `effectiveFrom` timestamp NOT NULL;--> statement-breakpoint
ALTER TABLE `billingPlans` ADD `effectiveUntil` timestamp;--> statement-breakpoint
ALTER TABLE `billingPlans` ADD `sortOrder` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `billingPlans` ADD `createdByUserId` int;--> statement-breakpoint
ALTER TABLE `billingPlans` ADD CONSTRAINT `billingPlans_version_code_uq` UNIQUE(`versionCode`);--> statement-breakpoint
ALTER TABLE `billingPlans` ADD CONSTRAINT `billingPlans_product_cycle_version_uq` UNIQUE(`productId`,`billingCycle`,`version`);--> statement-breakpoint
ALTER TABLE `billingCommercialAuditEvents` ADD CONSTRAINT `billingCommercialAuditEvents_actorUserId_users_id_fk` FOREIGN KEY (`actorUserId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `billingCouponRedemptions` ADD CONSTRAINT `billingCouponRedemptions_couponId_billingCoupons_id_fk` FOREIGN KEY (`couponId`) REFERENCES `billingCoupons`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `billingCouponRedemptions` ADD CONSTRAINT `billingCouponRedemptions_planId_billingPlans_id_fk` FOREIGN KEY (`planId`) REFERENCES `billingPlans`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `billingCouponRedemptions` ADD CONSTRAINT `billingCouponRedemptions_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `billingCoupons` ADD CONSTRAINT `billingCoupons_supersedesCouponId_billingCoupons_id_fk` FOREIGN KEY (`supersedesCouponId`) REFERENCES `billingCoupons`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `billingCoupons` ADD CONSTRAINT `billingCoupons_createdByUserId_users_id_fk` FOREIGN KEY (`createdByUserId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `billingCoupons` ADD CONSTRAINT `billingCoupons_deactivatedByUserId_users_id_fk` FOREIGN KEY (`deactivatedByUserId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `billingCommercialAuditEvents_entity_created_idx` ON `billingCommercialAuditEvents` (`entityType`,`entityId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `billingCommercialAuditEvents_actor_created_idx` ON `billingCommercialAuditEvents` (`actorUserId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `billingCouponRedemptions_coupon_state_idx` ON `billingCouponRedemptions` (`couponId`,`state`);--> statement-breakpoint
CREATE INDEX `billingCouponRedemptions_user_coupon_state_idx` ON `billingCouponRedemptions` (`userId`,`couponId`,`state`);--> statement-breakpoint
CREATE INDEX `billingCoupons_code_state_idx` ON `billingCoupons` (`code`,`state`);--> statement-breakpoint
CREATE INDEX `billingProducts_audience_state_idx` ON `billingProducts` (`audience`,`state`);--> statement-breakpoint
ALTER TABLE `billingPlans` ADD CONSTRAINT `billingPlans_productId_billingProducts_id_fk` FOREIGN KEY (`productId`) REFERENCES `billingProducts`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `billingPlans` ADD CONSTRAINT `billingPlans_createdByUserId_users_id_fk` FOREIGN KEY (`createdByUserId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `billingPlans_product_status_effective_idx` ON `billingPlans` (`productId`,`status`,`effectiveFrom`);