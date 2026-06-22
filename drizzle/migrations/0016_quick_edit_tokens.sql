CREATE TABLE `quickEditTokens` (
  `id` int AUTO_INCREMENT NOT NULL,
  `userId` int NOT NULL,
  `mealId` int NOT NULL,
  `tokenHash` varchar(64) NOT NULL,
  `expiresAt` timestamp NOT NULL,
  `usedAt` timestamp,
  `lastAccessedAt` timestamp,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `quickEditTokens_id` PRIMARY KEY(`id`),
  CONSTRAINT `quickEditTokens_tokenHash_unique` UNIQUE(`tokenHash`),
  CONSTRAINT `quickEditTokens_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action,
  CONSTRAINT `quickEditTokens_mealId_meals_id_fk` FOREIGN KEY (`mealId`) REFERENCES `meals`(`id`) ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX `quickEditTokens_user_meal_idx` ON `quickEditTokens` (`userId`, `mealId`);
--> statement-breakpoint
CREATE INDEX `quickEditTokens_expiresAt_idx` ON `quickEditTokens` (`expiresAt`);
