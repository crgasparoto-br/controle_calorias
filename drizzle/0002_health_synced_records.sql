CREATE TABLE `healthSyncedRecords` (
  `id` int AUTO_INCREMENT NOT NULL,
  `userId` int NOT NULL,
  `provider` enum('apple_health','health_connect','google_fit','strava','garmin_connect','mock') NOT NULL,
  `externalRecordId` varchar(160) NOT NULL,
  `dataType` enum('steps','weight','activity','energy_burned','sleep') NOT NULL,
  `measuredAt` timestamp NOT NULL,
  `value` double NOT NULL,
  `unit` varchar(40) NOT NULL,
  `activityType` varchar(120),
  `energyKind` varchar(40),
  `metadataJson` text,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `healthSyncedRecords_id` PRIMARY KEY(`id`),
  CONSTRAINT `healthSyncedRecords_user_provider_record_idx` UNIQUE(`userId`,`provider`,`externalRecordId`,`dataType`)
);
--> statement-breakpoint
ALTER TABLE `healthSyncedRecords` ADD CONSTRAINT `healthSyncedRecords_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX `healthSyncedRecords_user_measuredAt_idx` ON `healthSyncedRecords` (`userId`,`measuredAt`);
--> statement-breakpoint
CREATE INDEX `healthSyncedRecords_user_provider_idx` ON `healthSyncedRecords` (`userId`,`provider`);
--> statement-breakpoint
CREATE INDEX `healthSyncedRecords_user_dataType_idx` ON `healthSyncedRecords` (`userId`,`dataType`);
