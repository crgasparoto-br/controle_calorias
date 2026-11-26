ALTER TABLE `user_food_aliases` DROP CONSTRAINT `user_food_aliases_revocation_ck`;
--> statement-breakpoint
ALTER TABLE `user_food_aliases` DROP COLUMN `revocation_request_hash`;
