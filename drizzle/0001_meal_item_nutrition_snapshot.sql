ALTER TABLE `mealItems` ADD COLUMN `foodId` int;
--> statement-breakpoint
ALTER TABLE `mealItems` ADD COLUMN `grams` double;
--> statement-breakpoint
ALTER TABLE `mealItems` ADD COLUMN `caloriesKcal` double;
--> statement-breakpoint
ALTER TABLE `mealItems` ADD COLUMN `proteinG` double;
--> statement-breakpoint
ALTER TABLE `mealItems` ADD COLUMN `carbG` double;
--> statement-breakpoint
ALTER TABLE `mealItems` ADD COLUMN `fatG` double;
--> statement-breakpoint
ALTER TABLE `mealItems` ADD COLUMN `fiberG` double;
--> statement-breakpoint
ALTER TABLE `mealItems` ADD COLUMN `sodiumMg` double;
--> statement-breakpoint
ALTER TABLE `mealItems` ADD COLUMN `foodSnapshotJson` text;
--> statement-breakpoint
ALTER TABLE `mealItems` ADD CONSTRAINT `mealItems_foodId_foods_id_fk` FOREIGN KEY (`foodId`) REFERENCES `foods`(`id`) ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX `mealItems_foodId_idx` ON `mealItems` (`foodId`);