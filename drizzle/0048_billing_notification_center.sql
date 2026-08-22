CREATE TABLE `billingNotificationReceipts` (
  `id` varchar(64) NOT NULL,
  `userId` int NOT NULL,
  `sourceFactId` varchar(64) NOT NULL,
  `readAt` timestamp NULL,
  `lastDeliveryChannel` enum('email','whatsapp') NULL,
  `lastDeliveryState` enum('not_attempted','pending','delivered','failed') NOT NULL DEFAULT 'not_attempted',
  `lastDeliveryAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `billingNotificationReceipts_user_fact_uq` (`userId`,`sourceFactId`),
  KEY `billingNotificationReceipts_user_read_idx` (`userId`,`readAt`,`updatedAt`),
  CONSTRAINT `billingNotificationReceipts_userId_fk`
    FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `billingNotificationReceipts_sourceFactId_fk`
    FOREIGN KEY (`sourceFactId`) REFERENCES `billingSubscriptionFacts` (`id`) ON DELETE CASCADE
);