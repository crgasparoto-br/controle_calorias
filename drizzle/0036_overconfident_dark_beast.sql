ALTER TABLE `professionalPatientTrackings` ADD `nextReviewAt` timestamp;--> statement-breakpoint
ALTER TABLE `professionalPatientTrackings` ADD `nextWeighingAt` timestamp;--> statement-breakpoint
CREATE INDEX `professionalTrackings_review_idx` ON `professionalPatientTrackings` (`professionalUserId`,`nextReviewAt`);--> statement-breakpoint
CREATE INDEX `professionalTrackings_weighing_idx` ON `professionalPatientTrackings` (`professionalUserId`,`nextWeighingAt`);