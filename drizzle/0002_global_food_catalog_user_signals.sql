CREATE TABLE `user_food_favorites` (
  `id` int AUTO_INCREMENT NOT NULL,
  `user_id` int NOT NULL,
  `food_id` int NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `user_food_favorites_id` PRIMARY KEY(`id`),
  CONSTRAINT `user_food_favorites_user_food_unique` UNIQUE(`user_id`, `food_id`),
  CONSTRAINT `user_food_favorites_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action,
  CONSTRAINT `user_food_favorites_food_id_foods_id_fk` FOREIGN KEY (`food_id`) REFERENCES `foods`(`id`) ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX `user_food_favorites_user_id_idx` ON `user_food_favorites` (`user_id`);
--> statement-breakpoint
CREATE INDEX `user_food_favorites_food_id_idx` ON `user_food_favorites` (`food_id`);
--> statement-breakpoint
CREATE TABLE `user_food_usage_stats` (
  `id` int AUTO_INCREMENT NOT NULL,
  `user_id` int NOT NULL,
  `food_id` int NOT NULL,
  `usage_count` int NOT NULL DEFAULT 0,
  `last_used_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `user_food_usage_stats_id` PRIMARY KEY(`id`),
  CONSTRAINT `user_food_usage_stats_user_food_unique` UNIQUE(`user_id`, `food_id`),
  CONSTRAINT `user_food_usage_stats_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action,
  CONSTRAINT `user_food_usage_stats_food_id_foods_id_fk` FOREIGN KEY (`food_id`) REFERENCES `foods`(`id`) ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX `user_food_usage_stats_user_recent_idx` ON `user_food_usage_stats` (`user_id`, `last_used_at`);
--> statement-breakpoint
CREATE INDEX `user_food_usage_stats_food_id_idx` ON `user_food_usage_stats` (`food_id`);
