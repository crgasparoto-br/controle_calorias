CREATE TABLE `whatsappPendingOperations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`type` varchar(64) NOT NULL,
	`target` json NOT NULL,
	`origin` varchar(64) NOT NULL,
	`state` varchar(16) NOT NULL DEFAULT 'active',
	`version` int NOT NULL DEFAULT 1,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`expiresAt` timestamp NOT NULL,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`consumedAt` timestamp,
	CONSTRAINT `whatsappPendingOperations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `whatsappPendingOperations` ADD CONSTRAINT `wa_pending_op_user_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `wa_pending_op_user_state_idx` ON `whatsappPendingOperations` (`userId`,`state`);