ALTER TABLE users ADD COLUMN passwordHash text;
--> statement-breakpoint
CREATE UNIQUE INDEX users_email_unique_idx ON users (email);
