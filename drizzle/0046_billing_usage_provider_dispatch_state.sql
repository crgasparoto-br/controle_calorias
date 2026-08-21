ALTER TABLE `billingUsageEvents`
  ADD COLUMN `providerDispatchStartedAt` timestamp NULL AFTER `eventState`,
  ADD KEY `billingUsageEvents_provider_dispatch_state_idx` (`eventState`, `providerDispatchStartedAt`);
