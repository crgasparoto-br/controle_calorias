ALTER TABLE `whatsappConnections`
  ADD COLUMN `activePhoneKey` varchar(32)
  GENERATED ALWAYS AS (
    CASE WHEN `status` = 'active' THEN `phoneNumber` ELSE NULL END
  ) STORED AFTER `phoneNumber`;
--> statement-breakpoint
UPDATE `whatsappConnections` AS connection_row
INNER JOIN (
  SELECT `id`, ROW_NUMBER() OVER (
    PARTITION BY `phoneNumber`
    ORDER BY `updatedAt` DESC, `id` DESC
  ) AS active_rank
  FROM `whatsappConnections`
  WHERE `status` = 'active'
) AS ranked_active
  ON ranked_active.`id` = connection_row.`id`
SET connection_row.`status` = 'disabled',
    connection_row.`updatedAt` = NOW()
WHERE ranked_active.active_rank > 1;
--> statement-breakpoint
CREATE UNIQUE INDEX `whatsappConnections_activePhoneKey_unique_idx`
  ON `whatsappConnections` (`activePhoneKey`);
