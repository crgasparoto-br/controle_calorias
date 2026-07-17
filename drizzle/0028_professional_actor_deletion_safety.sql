ALTER TABLE `professionalPatientTrackingEvents` DROP FOREIGN KEY `professionalPatientTrackingEvents_actorUserId_users_id_fk`;
--> statement-breakpoint
ALTER TABLE `professionalPatientTrackings` DROP FOREIGN KEY `professionalPatientTrackings_lastTransitionByUserId_users_id_fk`;
--> statement-breakpoint
ALTER TABLE `professionalPatientTrackingEvents` MODIFY COLUMN `actorUserId` int;--> statement-breakpoint
ALTER TABLE `professionalPatientTrackings` MODIFY COLUMN `lastTransitionByUserId` int;--> statement-breakpoint
ALTER TABLE `professionalPatientTrackingEvents` ADD CONSTRAINT `professionalPatientTrackingEvents_actorUserId_users_id_fk` FOREIGN KEY (`actorUserId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `professionalPatientTrackings` ADD CONSTRAINT `professionalPatientTrackings_lastTransitionByUserId_users_id_fk` FOREIGN KEY (`lastTransitionByUserId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;