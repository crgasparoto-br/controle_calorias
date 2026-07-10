CREATE TABLE `whatsappConversationMessages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`conversationId` int NOT NULL,
	`userId` int NOT NULL,
	`direction` enum('inbound','outbound') NOT NULL,
	`channel` enum('whatsapp') NOT NULL DEFAULT 'whatsapp',
	`externalMessageId` varchar(128),
	`idempotencyKey` varchar(191) NOT NULL,
	`contentType` enum('text','image','audio','multimodal','system') NOT NULL,
	`rawTextStored` boolean NOT NULL DEFAULT false,
	`text` text,
	`sanitizedText` text,
	`transcript` text,
	`sanitizedTranscript` text,
	`mediaStorageKey` varchar(255),
	`mediaMimeType` varchar(120),
	`captionText` text,
	`privacyPolicyVersion` varchar(32),
	`retentionExpiresAt` timestamp,
	`respondsToMessageId` int,
	`occurredAt` timestamp NOT NULL,
	`processedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `whatsappConversationMessages_id` PRIMARY KEY(`id`),
	CONSTRAINT `whatsappConversationMessages_idempotencyKey_unique_idx` UNIQUE(`idempotencyKey`)
);
--> statement-breakpoint
CREATE TABLE `whatsappConversations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`whatsappConnectionId` int,
	`phoneNumber` varchar(32) NOT NULL,
	`status` enum('active','expired','closed') NOT NULL DEFAULT 'active',
	`startedAt` timestamp NOT NULL DEFAULT (now()),
	`lastActivityAt` timestamp NOT NULL DEFAULT (now()),
	`endedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `whatsappConversations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `whatsappMessageDomainLinks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`messageId` int NOT NULL,
	`mealId` int,
	`mealItemId` int,
	`waterLogId` int,
	`weightEntryId` int,
	`exerciseId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `whatsappMessageDomainLinks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `whatsappConversationMessages` ADD CONSTRAINT `whatsappConversationMessages_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `whatsappConversationMessages` ADD CONSTRAINT `whatsappConversationMessages_conversationId_fk` FOREIGN KEY (`conversationId`) REFERENCES `whatsappConversations`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `whatsappConversationMessages` ADD CONSTRAINT `whatsappConversationMessages_respondsToMessageId_fk` FOREIGN KEY (`respondsToMessageId`) REFERENCES `whatsappConversationMessages`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `whatsappConversations` ADD CONSTRAINT `whatsappConversations_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `whatsappConversations` ADD CONSTRAINT `whatsappConversations_whatsappConnectionId_fk` FOREIGN KEY (`whatsappConnectionId`) REFERENCES `whatsappConnections`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `whatsappMessageDomainLinks` ADD CONSTRAINT `whatsappMessageDomainLinks_mealId_meals_id_fk` FOREIGN KEY (`mealId`) REFERENCES `meals`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `whatsappMessageDomainLinks` ADD CONSTRAINT `whatsappMessageDomainLinks_mealItemId_mealItems_id_fk` FOREIGN KEY (`mealItemId`) REFERENCES `mealItems`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `whatsappMessageDomainLinks` ADD CONSTRAINT `whatsappMessageDomainLinks_waterLogId_waterLogs_id_fk` FOREIGN KEY (`waterLogId`) REFERENCES `waterLogs`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `whatsappMessageDomainLinks` ADD CONSTRAINT `whatsappMessageDomainLinks_weightEntryId_weightEntries_id_fk` FOREIGN KEY (`weightEntryId`) REFERENCES `weightEntries`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `whatsappMessageDomainLinks` ADD CONSTRAINT `whatsappMessageDomainLinks_exerciseId_exercises_id_fk` FOREIGN KEY (`exerciseId`) REFERENCES `exercises`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `whatsappMessageDomainLinks` ADD CONSTRAINT `whatsappMessageDomainLinks_messageId_fk` FOREIGN KEY (`messageId`) REFERENCES `whatsappConversationMessages`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `whatsappConversationMessages_conversation_occurredAt_idx` ON `whatsappConversationMessages` (`conversationId`,`occurredAt`,`id`);--> statement-breakpoint
CREATE INDEX `whatsappConversationMessages_user_occurredAt_idx` ON `whatsappConversationMessages` (`userId`,`occurredAt`,`id`);--> statement-breakpoint
CREATE INDEX `whatsappConversationMessages_respondsTo_idx` ON `whatsappConversationMessages` (`respondsToMessageId`);--> statement-breakpoint
CREATE INDEX `whatsappConversations_user_status_idx` ON `whatsappConversations` (`userId`,`status`);--> statement-breakpoint
CREATE INDEX `whatsappConversations_user_lastActivityAt_idx` ON `whatsappConversations` (`userId`,`lastActivityAt`);--> statement-breakpoint
CREATE INDEX `whatsappMessageDomainLinks_messageId_idx` ON `whatsappMessageDomainLinks` (`messageId`);--> statement-breakpoint
CREATE INDEX `whatsappMessageDomainLinks_mealId_idx` ON `whatsappMessageDomainLinks` (`mealId`);--> statement-breakpoint
CREATE INDEX `whatsappMessageDomainLinks_waterLogId_idx` ON `whatsappMessageDomainLinks` (`waterLogId`);--> statement-breakpoint
CREATE INDEX `whatsappMessageDomainLinks_weightEntryId_idx` ON `whatsappMessageDomainLinks` (`weightEntryId`);--> statement-breakpoint
CREATE INDEX `whatsappMessageDomainLinks_exerciseId_idx` ON `whatsappMessageDomainLinks` (`exerciseId`);