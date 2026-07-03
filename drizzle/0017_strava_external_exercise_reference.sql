ALTER TABLE `exercises` ADD `externalProvider` varchar(40);
--> statement-breakpoint
ALTER TABLE `exercises` ADD `externalId` varchar(160);
--> statement-breakpoint
UPDATE `exercises`
SET `externalProvider` = 'strava',
    `externalId` = LOWER(REPLACE(REGEXP_SUBSTR(`notes`, 'strava:[A-Za-z0-9_-]+'), 'strava:', ''))
WHERE `notes` REGEXP 'strava:[A-Za-z0-9_-]+'
  AND `externalProvider` IS NULL
  AND `externalId` IS NULL;
--> statement-breakpoint
UPDATE `exercises` e
JOIN (
  SELECT `id`
  FROM (
    SELECT
      `id`,
      ROW_NUMBER() OVER (
        PARTITION BY `userId`, `externalProvider`, `externalId`
        ORDER BY `updatedAt` DESC, `id` DESC
      ) AS `duplicateRank`
    FROM `exercises`
    WHERE `externalProvider` IS NOT NULL
      AND `externalId` IS NOT NULL
  ) ranked
  WHERE ranked.`duplicateRank` > 1
) ranked_duplicates ON ranked_duplicates.`id` = e.`id`
SET e.`notes` = CONCAT(
      COALESCE(e.`notes`, ''),
      ' Duplicado historico Strava mantido sem referencia estruturada para preservar indice unico. Referencia original: ',
      e.`externalProvider`,
      ':',
      e.`externalId`,
      '.'
    ),
    e.`externalProvider` = NULL,
    e.`externalId` = NULL;
--> statement-breakpoint
CREATE INDEX `exercises_external_reference_idx` ON `exercises` (`externalProvider`, `externalId`);
--> statement-breakpoint
CREATE UNIQUE INDEX `exercises_user_external_reference_unique` ON `exercises` (`userId`, `externalProvider`, `externalId`);