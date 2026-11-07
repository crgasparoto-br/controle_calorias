-- #1308 D1: additive owner binding, no V2 cutover/activation.
CREATE TABLE IF NOT EXISTS food_d1_user_operation_routes (
  owner_user_id INT NOT NULL,
  operation_key VARCHAR(200) NOT NULL,
  origin_entrypoint VARCHAR(40) NOT NULL,
  resolver ENUM('v1','v2') NOT NULL,
  revisions_json TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY food_d1_user_operation_routes_u0 (owner_user_id, operation_key),
  CONSTRAINT food_d1_user_operation_routes_user_fk FOREIGN KEY (owner_user_id)
    REFERENCES users(id) ON DELETE CASCADE
);
--> statement-breakpoint
-- Commit a receipt in the same transaction as its physical meal-item effect.
CREATE TABLE IF NOT EXISTS food_d1_user_operation_effects (
  owner_user_id INT NOT NULL,
  operation_key VARCHAR(200) NOT NULL,
  observation_id VARCHAR(200) NOT NULL,
  decision_hash VARCHAR(64) NOT NULL,
  outcome_json TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY food_d1_operation_effects_u0 (owner_user_id, operation_key, observation_id),
  CONSTRAINT food_d1_operation_effects_route_fk FOREIGN KEY (owner_user_id, operation_key)
    REFERENCES food_d1_user_operation_routes(owner_user_id, operation_key) ON DELETE CASCADE
);
