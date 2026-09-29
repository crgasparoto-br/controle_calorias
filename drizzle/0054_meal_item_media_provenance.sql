ALTER TABLE `mealItems`
  ADD COLUMN `sourceMediaStorageKey` varchar(255) NULL;
--> statement-breakpoint
CREATE INDEX `mealItems_sourceMediaStorageKey_idx`
  ON `mealItems` (`sourceMediaStorageKey`);
