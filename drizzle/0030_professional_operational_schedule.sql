ALTER TABLE `professionalPatientTrackings`
  ADD COLUMN `nextReviewAt` timestamp NULL AFTER `lastTransitionReason`,
  ADD COLUMN `nextWeighingAt` timestamp NULL AFTER `nextReviewAt`;

CREATE INDEX `professionalTrackings_review_idx`
  ON `professionalPatientTrackings` (`professionalUserId`, `nextReviewAt`);

CREATE INDEX `professionalTrackings_weighing_idx`
  ON `professionalPatientTrackings` (`professionalUserId`, `nextWeighingAt`);
