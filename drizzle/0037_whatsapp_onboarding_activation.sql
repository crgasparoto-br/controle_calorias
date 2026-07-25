ALTER TABLE `whatsapp_onboarding_leads`
  MODIFY COLUMN `status` enum(
    'lead_whatsapp',
    'pending_onboarding',
    'converting',
    'pending_activation',
    'active',
    'expired',
    'canceled'
  ) NOT NULL DEFAULT 'pending_onboarding';

ALTER TABLE `whatsapp_onboarding_leads`
  ADD COLUMN `activation_source` varchar(64) NULL AFTER `converted_at`;

ALTER TABLE `whatsapp_onboarding_leads`
  ADD COLUMN `activated_at` timestamp NULL AFTER `activation_source`;

ALTER TABLE `whatsapp_onboarding_leads`
  ADD COLUMN `completion_error_code` varchar(120) NULL AFTER `activated_at`;

CREATE INDEX `whatsapp_onboarding_leads_converted_status_idx`
  ON `whatsapp_onboarding_leads` (`converted_user_id`, `status`);
