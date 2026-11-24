-- Roll back only the added checks; existing 0055 constraints and all rows remain.
ALTER TABLE `food_attribute_materiality_overrides` DROP CONSTRAINT `food_attr_override_current_ck`;
--> statement-breakpoint
ALTER TABLE `user_food_lexicon_entries` DROP CONSTRAINT `user_food_lexicon_current_ck`;
--> statement-breakpoint
ALTER TABLE `user_food_aliases` DROP CONSTRAINT `user_food_aliases_current_ck`;
