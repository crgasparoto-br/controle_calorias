ALTER TABLE `user_food_aliases` ADD COLUMN `revocation_request_hash` varchar(64);
--> statement-breakpoint
ALTER TABLE `user_food_aliases` ADD CONSTRAINT `user_food_aliases_revocation_ck` CHECK ((revocation_request_hash IS NULL OR (status='revoked' AND revoked_at IS NOT NULL AND current_slot IS NULL)));
