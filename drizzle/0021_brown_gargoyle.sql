CREATE TABLE `whatsappConversationSummaries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`conversationId` int NOT NULL,
	`summaryText` text NOT NULL,
	`fromMessageId` int,
	`toMessageId` int,
	`promptVersion` varchar(32) NOT NULL,
	`algorithmVersion` varchar(32) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `whatsappConversationSummaries_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `whatsappConversationSummaries` ADD CONSTRAINT `whatsappConversationSummaries_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `whatsappConversationSummaries` ADD CONSTRAINT `whatsappConversationSummaries_conversationId_fk` FOREIGN KEY (`conversationId`) REFERENCES `whatsappConversations`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `whatsappConversationSummaries` ADD CONSTRAINT `whatsappConversationSummaries_fromMessageId_fk` FOREIGN KEY (`fromMessageId`) REFERENCES `whatsappConversationMessages`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `whatsappConversationSummaries` ADD CONSTRAINT `whatsappConversationSummaries_toMessageId_fk` FOREIGN KEY (`toMessageId`) REFERENCES `whatsappConversationMessages`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `whatsappConversationSummaries_conversation_createdAt_idx` ON `whatsappConversationSummaries` (`conversationId`,`createdAt`);