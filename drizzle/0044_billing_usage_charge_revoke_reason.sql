ALTER TABLE `billingConsumptionChargeAuthorizations`
  ADD COLUMN `revokeReason` varchar(255) NULL AFTER `revokedAt`;
