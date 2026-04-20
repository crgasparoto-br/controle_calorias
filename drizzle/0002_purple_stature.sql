ALTER TABLE `mealInferences` ADD `draftId` varchar(64) NOT NULL;--> statement-breakpoint
ALTER TABLE `mealInferences` ADD `sourceText` text;--> statement-breakpoint
ALTER TABLE `mealInferences` ADD `transcript` text;--> statement-breakpoint
ALTER TABLE `mealInferences` ADD `mediaJson` text NOT NULL;--> statement-breakpoint
ALTER TABLE `mealInferences` ADD CONSTRAINT `mealInferences_draftId_unique` UNIQUE(`draftId`);