CREATE INDEX `habitMemories_user_food_idx` ON `habitMemories` (`userId`, `foodName`);
--> statement-breakpoint
CREATE INDEX `habitMemories_user_lastSeen_idx` ON `habitMemories` (`userId`, `lastSeenAt`);
