ALTER TABLE `mealItems` ADD COLUMN IF NOT EXISTS `foodId` int;--> statement-breakpoint
ALTER TABLE `mealItems` ADD COLUMN IF NOT EXISTS `grams` double;--> statement-breakpoint
ALTER TABLE `mealItems` ADD COLUMN IF NOT EXISTS `caloriesKcal` double;--> statement-breakpoint
ALTER TABLE `mealItems` ADD COLUMN IF NOT EXISTS `proteinG` double;--> statement-breakpoint
ALTER TABLE `mealItems` ADD COLUMN IF NOT EXISTS `carbG` double;--> statement-breakpoint
ALTER TABLE `mealItems` ADD COLUMN IF NOT EXISTS `fatG` double;--> statement-breakpoint
ALTER TABLE `mealItems` ADD COLUMN IF NOT EXISTS `fiberG` double;--> statement-breakpoint
ALTER TABLE `mealItems` ADD COLUMN IF NOT EXISTS `sodiumMg` double;--> statement-breakpoint
ALTER TABLE `mealItems` ADD COLUMN IF NOT EXISTS `foodSnapshotJson` text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `mealItems_foodId_idx` ON `mealItems` (`foodId`);
