ALTER TABLE `billingEconomicFacts`
  ADD COLUMN `supersedesFactId` varchar(64) NULL AFTER `idempotencyKey`,
  ADD COLUMN `supersededByFactId` varchar(64) NULL AFTER `supersedesFactId`,
  ADD COLUMN `supersededAt` timestamp NULL AFTER `supersededByFactId`,
  ADD COLUMN `payloadFingerprint` varchar(64) NULL AFTER `supersededAt`,
  ADD UNIQUE KEY `billingEconomicFacts_supersedes_uq` (`supersedesFactId`),
  ADD KEY `billingEconomicFacts_active_competence_idx` (`supersededAt`, `competenceStart`, `competenceEnd`);

ALTER TABLE `billingUsageEvents`
  ADD COLUMN `payloadFingerprint` varchar(64) NULL AFTER `idempotencyKey`;

UPDATE billingEconomicFacts SET payloadFingerprint=SHA2(CONCAT('legacy:',id),256) WHERE payloadFingerprint IS NULL;
UPDATE billingUsageEvents SET payloadFingerprint=SHA2(CONCAT('legacy:',id),256) WHERE payloadFingerprint IS NULL;
ALTER TABLE billingEconomicFacts MODIFY COLUMN `payloadFingerprint` varchar(64) NOT NULL;
ALTER TABLE billingUsageEvents MODIFY COLUMN `payloadFingerprint` varchar(64) NOT NULL;

ALTER TABLE `billingUsageDailyAggregates`
  ADD COLUMN `patientUserId` int NULL AFTER `beneficiaryUserId`,
  ADD COLUMN `recognizedCostMicros` bigint NOT NULL DEFAULT 0 AFTER `effectiveCostMicros`;

ALTER TABLE `billingUsageLimitations`
  ADD COLUMN `lifecycleKind` varchar(24) NULL AFTER `emergencySecurity`;

UPDATE billingUsageLimitations limitation
JOIN (
  SELECT id, emergencySecurity,
         ROW_NUMBER() OVER (PARTITION BY abuseCaseId, emergencySecurity ORDER BY startsAt, id) AS lifecycleOrdinal
  FROM billingUsageLimitations
) ranked ON ranked.id=limitation.id
SET limitation.lifecycleKind=CASE
  WHEN ranked.emergencySecurity=true AND ranked.lifecycleOrdinal=1 THEN 'emergency'
  WHEN ranked.emergencySecurity=true THEN NULL
  WHEN ranked.lifecycleOrdinal=1 THEN 'initial'
  WHEN ranked.lifecycleOrdinal=2 THEN 'extension'
  ELSE NULL
END;

ALTER TABLE `billingUsageLimitations`
  MODIFY COLUMN `lifecycleKind` varchar(24) NOT NULL,
  ADD UNIQUE KEY `billingUsageLimitations_case_lifecycle_uq` (`abuseCaseId`, `lifecycleKind`),
  ADD CONSTRAINT `billingUsageLimitations_lifecycle_kind_chk` CHECK (`lifecycleKind` IN ('initial','extension','emergency'));

CREATE TABLE IF NOT EXISTS `billingUsageLimitationAppeals` (
  `id` varchar(64) NOT NULL,
  `limitationId` varchar(64) NOT NULL,
  `abuseCaseId` varchar(64) NOT NULL,
  `subjectUserId` int NOT NULL,
  `submittedByUserId` int NOT NULL,
  `rationale` varchar(1000) NOT NULL,
  `state` varchar(24) NOT NULL DEFAULT 'pending',
  `submittedAt` timestamp NOT NULL,
  `reviewedByUserId` int NULL,
  `reviewRationale` varchar(1000) NULL,
  `result` varchar(24) NULL,
  `reviewedAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `billingUsageLimitationAppeals_limitation_uq` (`limitationId`),
  KEY `billingUsageLimitationAppeals_case_state_idx` (`abuseCaseId`, `state`, `submittedAt`)
);
