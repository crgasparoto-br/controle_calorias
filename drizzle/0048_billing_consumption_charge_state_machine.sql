ALTER TABLE `billingConsumptionChargeAuthorizations`
  MODIFY COLUMN `state` varchar(24) NOT NULL DEFAULT 'draft';
