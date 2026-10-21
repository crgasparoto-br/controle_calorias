-- #1302 B2: deny-by-default per-source governance. #1303 approvals must be recorded explicitly.
CREATE TABLE IF NOT EXISTS food_source_read_grants (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  source_id INT NOT NULL,
  source_version VARCHAR(80) NOT NULL,
  status ENUM('pending','approved','revoked') NOT NULL DEFAULT 'pending',
  allow_read INT NOT NULL DEFAULT 0,
  allow_persist_evidence INT NOT NULL DEFAULT 0,
  allow_global_publication INT NOT NULL DEFAULT 0,
  license_reference VARCHAR(500) NULL,
  approval_reference VARCHAR(500) NULL,
  retention_days INT NULL,
  approved_at TIMESTAMP NULL,
  valid_until TIMESTAMP NULL,
  revoked_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY food_source_read_grants_u0 (source_id),
  CONSTRAINT food_source_read_grants_source_id_food_sources_id_fk FOREIGN KEY (source_id) REFERENCES food_sources(id) ON DELETE RESTRICT,
  CONSTRAINT food_source_read_grants_ck0 CHECK (allow_read=0 OR (status='approved' AND license_reference IS NOT NULL AND approval_reference IS NOT NULL AND approved_at IS NOT NULL)),
  CONSTRAINT food_source_read_grants_ck1 CHECK (allow_persist_evidence=0 OR (allow_read=1 AND retention_days BETWEEN 1 AND 365)),
  CONSTRAINT food_source_read_grants_ck2 CHECK (allow_global_publication=0 OR allow_read=1)
);
--> statement-breakpoint

-- Idempotent provisional evidence cache entry; personal scope is mandatory.
ALTER TABLE food_evidence ADD UNIQUE KEY food_evidence_cache_u0 (owner_user_id, subject_key, content_hash);
