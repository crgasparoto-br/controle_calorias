ALTER TABLE `billingEntitlements`
  MODIFY COLUMN `sourceType` enum(
    'subscription',
    'professional_coverage',
    'trial',
    'transition',
    'read_only',
    'free_access',
    'admin_override'
  ) NOT NULL;
