ALTER TABLE `nutritionGoals` ADD `weekday` int NOT NULL;--> statement-breakpoint
ALTER TABLE `nutritionGoals` ADD CONSTRAINT `nutritionGoals_user_weekday_idx` UNIQUE(`userId`,`weekday`);