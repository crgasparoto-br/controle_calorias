CREATE TABLE `whatsapp_onboarding_leads` (
  `id` int AUTO_INCREMENT NOT NULL,
  `phone_number` varchar(32) NOT NULL,
  `display_name` varchar(255),
  `origin` varchar(40) NOT NULL DEFAULT 'whatsapp',
  `status` enum('lead_whatsapp','pending_onboarding','active','expired','canceled') NOT NULL DEFAULT 'pending_onboarding',
  `token_hash` varchar(64) NOT NULL,
  `token_expires_at` timestamp NOT NULL,
  `token_used_at` timestamp NULL,
  `converted_user_id` int,
  `converted_at` timestamp NULL,
  `last_message_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `whatsapp_onboarding_leads_id` PRIMARY KEY(`id`),
  CONSTRAINT `whatsapp_onboarding_leads_phone_unique` UNIQUE(`phone_number`),
  CONSTRAINT `whatsapp_onboarding_leads_token_hash_unique` UNIQUE(`token_hash`)
);

CREATE INDEX `whatsapp_onboarding_leads_status_idx` ON `whatsapp_onboarding_leads` (`status`);
CREATE INDEX `whatsapp_onboarding_leads_expires_idx` ON `whatsapp_onboarding_leads` (`token_expires_at`);
CREATE INDEX `whatsapp_onboarding_leads_converted_user_idx` ON `whatsapp_onboarding_leads` (`converted_user_id`);
