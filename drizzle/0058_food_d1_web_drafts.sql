-- #1308 D1: short-lived, owner-scoped web review state; no raw evidence.
CREATE TABLE IF NOT EXISTS food_d1_web_drafts (
  draft_id VARCHAR(80) NOT NULL,
  owner_user_id INT NOT NULL,
  operation_key VARCHAR(200) NOT NULL,
  status ENUM('pending','confirmed') NOT NULL DEFAULT 'pending',
  payload_json TEXT,
  confirmation_json TEXT,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (draft_id),
  UNIQUE KEY food_d1_web_drafts_u0 (draft_id),
  UNIQUE KEY food_d1_web_drafts_u1 (owner_user_id, operation_key),
  KEY food_d1_web_drafts_i0 (owner_user_id, expires_at),
  KEY food_d1_web_drafts_i1 (expires_at),
  CONSTRAINT food_d1_web_drafts_ck0 CHECK (
    (status='pending' AND payload_json IS NOT NULL AND confirmation_json IS NULL) OR
    (status='confirmed' AND payload_json IS NULL AND confirmation_json IS NOT NULL)
  ),
  CONSTRAINT food_d1_web_drafts_user_fk
    FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT food_d1_web_drafts_route_fk
    FOREIGN KEY (owner_user_id, operation_key)
    REFERENCES food_d1_user_operation_routes(owner_user_id, operation_key) ON DELETE CASCADE
);
