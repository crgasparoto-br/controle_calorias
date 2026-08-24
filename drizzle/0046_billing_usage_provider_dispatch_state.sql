ALTER TABLE `billingUsageEvents`
  ADD COLUMN `providerDispatchStartedAt` timestamp NULL AFTER `eventState`;
--> statement-breakpoint
ALTER TABLE `billingUsageEvents`
  ADD KEY `billingUsageEvents_provider_dispatch_state_idx` (`eventState`, `providerDispatchStartedAt`);
