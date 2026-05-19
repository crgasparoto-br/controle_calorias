CREATE TABLE `userGamificationSettings` (
  `id` int AUTO_INCREMENT NOT NULL,
  `userId` int NOT NULL,
  `enabled` int NOT NULL DEFAULT 1,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `userGamificationSettings_id` PRIMARY KEY(`id`),
  CONSTRAINT `userGamificationSettings_userId_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
CREATE TABLE `userBadges` (
  `id` int AUTO_INCREMENT NOT NULL,
  `userId` int NOT NULL,
  `badgeCode` varchar(80) NOT NULL,
  `earnedAt` timestamp NOT NULL DEFAULT (now()),
  `weekStart` varchar(10),
  `metadataJson` text,
  CONSTRAINT `userBadges_id` PRIMARY KEY(`id`),
  CONSTRAINT `userBadges_user_badge_week_idx` UNIQUE(`userId`,`badgeCode`,`weekStart`)
);
--> statement-breakpoint
ALTER TABLE `userGamificationSettings` ADD CONSTRAINT `userGamificationSettings_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `userBadges` ADD CONSTRAINT `userBadges_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX `userGamificationSettings_userId_idx` ON `userGamificationSettings` (`userId`);
--> statement-breakpoint
CREATE INDEX `userBadges_userId_idx` ON `userBadges` (`userId`);
