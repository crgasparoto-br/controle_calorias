CREATE TABLE `whatsappLearningArtifacts` (
  `id` int AUTO_INCREMENT NOT NULL,
  `scope` enum('user','global') NOT NULL,
  `userId` int,
  `artifactKind` varchar(80) NOT NULL,
  `artifactKey` varchar(64) NOT NULL,
  `artifactValue` text NOT NULL,
  `artifactVersion` varchar(80) NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `whatsappLearningArtifacts_id` PRIMARY KEY(`id`),
  CONSTRAINT `whatsappLearningArtifacts_artifactKey_unique` UNIQUE(`artifactKey`),
  CONSTRAINT `whatsappLearningArtifacts_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX `whatsappLearningArtifacts_user_kind_idx` ON `whatsappLearningArtifacts` (`userId`,`artifactKind`);
--> statement-breakpoint
CREATE INDEX `whatsappLearningArtifacts_scope_kind_idx` ON `whatsappLearningArtifacts` (`scope`,`artifactKind`);
