CREATE TABLE `appSecrets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`secretKey` varchar(64) NOT NULL,
	`valueEncrypted` text NOT NULL,
	`updatedByUserId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `appSecrets_id` PRIMARY KEY(`id`),
	CONSTRAINT `appSecrets_secretKey_unique` UNIQUE(`secretKey`)
);
