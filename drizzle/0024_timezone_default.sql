UPDATE `userProfiles`
SET `timezone` = 'America/Sao_Paulo'
WHERE `timezone` IS NULL OR TRIM(`timezone`) = '';--> statement-breakpoint
ALTER TABLE `userProfiles`
MODIFY COLUMN `timezone` varchar(80) NOT NULL DEFAULT 'America/Sao_Paulo';
