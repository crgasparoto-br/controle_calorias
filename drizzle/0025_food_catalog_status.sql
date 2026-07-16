ALTER TABLE `foodCatalog` ADD `status` enum('active','deprecated') DEFAULT 'active' NOT NULL;--> statement-breakpoint
CREATE INDEX `foodCatalog_status_idx` ON `foodCatalog` (`status`);
