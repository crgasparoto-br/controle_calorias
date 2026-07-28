ALTER TABLE `professionalMessages` ADD `requestedAction` enum('save_draft','send_web','send_whatsapp');--> statement-breakpoint
UPDATE `professionalMessages` AS `m`
SET `requestedAction` = CASE
  WHEN EXISTS (
    SELECT 1
    FROM `professionalMessageDeliveryAttempts` AS `attempt`
    WHERE `attempt`.`messageId` = `m`.`id`
      AND `attempt`.`channel` = 'whatsapp'
  ) THEN 'send_whatsapp'
  WHEN `m`.`state` = 'draft' THEN 'save_draft'
  WHEN `m`.`state` = 'sent' THEN 'send_web'
  ELSE NULL
END
WHERE `m`.`direction` = 'professional_to_patient'
  AND `m`.`requestedAction` IS NULL;
