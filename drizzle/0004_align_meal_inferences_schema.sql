ALTER TABLE `mealInferences` ADD COLUMN `sourceText` text AFTER `requestSummary`;
--> statement-breakpoint
ALTER TABLE `mealInferences` ADD COLUMN `transcript` text AFTER `sourceText`;
--> statement-breakpoint
ALTER TABLE `mealInferences` ADD COLUMN `mediaJson` text AFTER `transcript`;
--> statement-breakpoint
UPDATE `mealInferences` SET `mediaJson` = '[]' WHERE `mediaJson` IS NULL;
--> statement-breakpoint
ALTER TABLE `mealInferences` MODIFY COLUMN `mediaJson` text NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `mealInferences_draftId_unique` ON `mealInferences` (`draftId`);
--> statement-breakpoint
CREATE INDEX `mealInferences_userId_idx` ON `mealInferences` (`userId`);
--> statement-breakpoint
CREATE INDEX `mealInferences_mealId_idx` ON `mealInferences` (`mealId`);
--> statement-breakpoint
CREATE INDEX `habitMemories_user_food_idx` ON `habitMemories` (`userId`, `foodName`);
--> statement-breakpoint
CREATE INDEX `habitMemories_user_lastSeen_idx` ON `habitMemories` (`userId`, `lastSeenAt`);
