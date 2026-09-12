CREATE TABLE IF NOT EXISTS `whatsappMessageProcessingClaims` (
  `messageId` int NOT NULL,
  `ownerToken` varchar(64) NOT NULL,
  `claimedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `heartbeatAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `whatsappMessageProcessingClaims_messageId` PRIMARY KEY(`messageId`),
  CONSTRAINT `whatsappMessageProcessingClaims_messageId_whatsappConversationMessages_id_fk`
    FOREIGN KEY (`messageId`) REFERENCES `whatsappConversationMessages`(`id`) ON DELETE CASCADE
);--> statement-breakpoint
CREATE INDEX `whatsappMessageProcessingClaims_heartbeatAt_idx` ON `whatsappMessageProcessingClaims` (`heartbeatAt`);