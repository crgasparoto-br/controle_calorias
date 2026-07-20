CREATE INDEX `professionalTrackings_review_idx`
  ON `professionalPatientTrackings` (`professionalUserId`, `nextReviewAt`);--> statement-breakpoint
CREATE INDEX `professionalTrackings_weighing_idx`
  ON `professionalPatientTrackings` (`professionalUserId`, `nextWeighingAt`);
