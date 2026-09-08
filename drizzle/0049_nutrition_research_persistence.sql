ALTER TABLE `foodCatalog` ADD `productVariant` varchar(255);--> statement-breakpoint
ALTER TABLE `foodCatalog` ADD `researchIdentityKey` varchar(255);--> statement-breakpoint
ALTER TABLE `foodCatalog` ADD `sourceUrls` text;--> statement-breakpoint
ALTER TABLE `foodCatalog` ADD `sourceEvidence` text;--> statement-breakpoint
ALTER TABLE `foodCatalog` ADD `sourceVerifiedAt` timestamp;--> statement-breakpoint
ALTER TABLE `foodCatalog` ADD `sourceConfidence` double;--> statement-breakpoint
ALTER TABLE `foodCatalog` ADD CONSTRAINT `foodCatalog_research_identity_unique` UNIQUE(`researchIdentityKey`);