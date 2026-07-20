CREATE TABLE `professionalConversations` (
  `id` varchar(64) NOT NULL, `authorizationId` varchar(64) NOT NULL, `professionalUserId` int NOT NULL,
  `patientUserId` int NOT NULL, `lastMessageAt` timestamp NOT NULL, `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`), UNIQUE KEY `professionalConversations_authorization_uq` (`authorizationId`),
  KEY `professionalConversations_professional_updated_idx` (`professionalUserId`,`lastMessageAt`),
  KEY `professionalConversations_patient_updated_idx` (`patientUserId`,`lastMessageAt`),
  CONSTRAINT `professionalConversations_authorization_fk` FOREIGN KEY (`authorizationId`) REFERENCES `professionalPatientAuthorizations` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `professionalConversations_professional_fk` FOREIGN KEY (`professionalUserId`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `professionalConversations_patient_fk` FOREIGN KEY (`patientUserId`) REFERENCES `users` (`id`) ON DELETE RESTRICT
);--> statement-breakpoint
CREATE TABLE `professionalMessages` (
  `id` varchar(64) NOT NULL, `conversationId` varchar(64) NOT NULL, `authorizationId` varchar(64) NOT NULL,
  `professionalUserId` int NOT NULL, `patientUserId` int NOT NULL, `authorUserId` int,
  `direction` enum('professional_to_patient','patient_to_professional') NOT NULL,
  `origin` enum('automatic','ai_suggested','professional','patient') NOT NULL,
  `messageType` enum('guidance','reminder','weigh_in_request','record_request','administrative','follow_up_summary','response') NOT NULL,
  `content` text NOT NULL, `state` enum('draft','pending','sent','failed','received') NOT NULL,
  `idempotencyKey` varchar(191) NOT NULL, `responseCode` varchar(32), `inReplyToMessageId` varchar(64),
  `relatedGuidanceId` varchar(64), `supersedesMessageId` varchar(64), `providerMessageId` varchar(191),
  `deliveryClaimToken` varchar(64), `deliveryClaimedAt` timestamp, `lastError` varchar(500),
  `sentAt` timestamp, `receivedAt` timestamp, `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`), UNIQUE KEY `professionalMessages_idempotency_uq` (`idempotencyKey`),
  UNIQUE KEY `professionalMessages_response_code_uq` (`responseCode`),
  KEY `professionalMessages_conversation_created_idx` (`conversationId`,`createdAt`,`id`),
  KEY `professionalMessages_patient_state_idx` (`patientUserId`,`state`,`createdAt`),
  CONSTRAINT `professionalMessages_conversation_fk` FOREIGN KEY (`conversationId`) REFERENCES `professionalConversations` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `professionalMessages_authorization_fk` FOREIGN KEY (`authorizationId`) REFERENCES `professionalPatientAuthorizations` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `professionalMessages_author_fk` FOREIGN KEY (`authorUserId`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `professionalMessages_reply_fk` FOREIGN KEY (`inReplyToMessageId`) REFERENCES `professionalMessages` (`id`) ON DELETE SET NULL,
  CONSTRAINT `professionalMessages_supersedes_fk` FOREIGN KEY (`supersedesMessageId`) REFERENCES `professionalMessages` (`id`) ON DELETE SET NULL,
  CONSTRAINT `professionalMessages_guidance_fk` FOREIGN KEY (`relatedGuidanceId`) REFERENCES `professionalGuidances` (`id`) ON DELETE SET NULL
);--> statement-breakpoint
CREATE TABLE `professionalMessageDeliveryAttempts` (
  `id` varchar(64) NOT NULL, `messageId` varchar(64) NOT NULL, `channel` enum('web','whatsapp') NOT NULL,
  `attemptNumber` int NOT NULL, `state` enum('pending','sending','sent','failed','skipped') NOT NULL,
  `claimToken` varchar(64), `claimedAt` timestamp, `providerMessageId` varchar(191), `errorCode` varchar(80),
  `errorDetail` varchar(500), `attemptedAt` timestamp NOT NULL DEFAULT (now()), `completedAt` timestamp,
  PRIMARY KEY (`id`), UNIQUE KEY `professionalMessageAttempts_message_attempt_uq` (`messageId`,`attemptNumber`),
  KEY `professionalMessageAttempts_state_attempted_idx` (`state`,`attemptedAt`),
  CONSTRAINT `professionalMessageAttempts_message_fk` FOREIGN KEY (`messageId`) REFERENCES `professionalMessages` (`id`) ON DELETE CASCADE
);
