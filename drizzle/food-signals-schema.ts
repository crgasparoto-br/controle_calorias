import { index, int, mysqlTable, timestamp, uniqueIndex } from "drizzle-orm/mysql-core";
import { foods, users } from "./schema";
import { foodVariants } from "./food-intelligence-v2-schema";

export const userFoodFavorites = mysqlTable(
  "user_food_favorites",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    foodId: int("food_id")
      .notNull()
      .references(() => foods.id, { onDelete: "cascade" }),
    foodVariantId: int("food_variant_id").references(() => foodVariants.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  table => ({
    userFoodUnique: uniqueIndex("user_food_favorites_user_food_unique").on(
      table.userId,
      table.foodId
    ),
    userIdIdx: index("user_food_favorites_user_id_idx").on(table.userId),
    foodIdIdx: index("user_food_favorites_food_id_idx").on(table.foodId),
    variantUniqueV2: uniqueIndex("v2_user_food_favorit_u0").on(table.userId, table.foodVariantId),
  })
);

export const userFoodUsageStats = mysqlTable(
  "user_food_usage_stats",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    foodId: int("food_id")
      .notNull()
      .references(() => foods.id, { onDelete: "cascade" }),
    foodVariantId: int("food_variant_id").references(() => foodVariants.id, { onDelete: "restrict" }),
    usageCount: int("usage_count").default(0).notNull(),
    lastUsedAt: timestamp("last_used_at").defaultNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    userFoodUnique: uniqueIndex("user_food_usage_stats_user_food_unique").on(
      table.userId,
      table.foodId
    ),
    userRecentIdx: index("user_food_usage_stats_user_recent_idx").on(
      table.userId,
      table.lastUsedAt
    ),
    foodIdIdx: index("user_food_usage_stats_food_id_idx").on(table.foodId),
    variantUniqueV2: uniqueIndex("v2_user_food_usage_s_u0").on(table.userId, table.foodVariantId),
  })
);
