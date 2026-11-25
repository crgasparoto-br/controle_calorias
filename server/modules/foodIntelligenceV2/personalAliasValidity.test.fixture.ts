import type { MySqlDialect } from "drizzle-orm/mysql-core";

type Query = ReturnType<MySqlDialect["sqlToQuery"]>;

const row = {
  userId: 41, alias: "meu pao", source: "user_confirmed",
  status: "active", currentSlot: 1, revokedAt: null as Date | null, id: 22,
};
const asOf = new Date("2026-10-21T12:00:00Z");
const confirmed = { confirmedAt: asOf as Date | null, ...row };
type AliasRow = typeof confirmed;

export const personalAliasValidityCases = [
  ["at the confirmation boundary", confirmed, true],
  ["after confirmation", { ...confirmed, confirmedAt: new Date(+asOf - 1000) }, true],
  ["with user_confirmed but no confirmation date", { ...confirmed, confirmedAt: null }, false],
  ["before confirmation", { ...confirmed, confirmedAt: new Date(+asOf + 1000) }, false],
  ["when revoked", { ...confirmed, revokedAt: asOf }, false],
  ["for a different owner", { ...confirmed, userId: 99 }, false],
  ["with a non-confirmation source", { ...confirmed, source: "imported" }, false],
  ["when not active", { ...confirmed, status: "revoked" }, false],
  ["outside the current slot", { ...confirmed, currentSlot: 2 }, false],
] as const;

function mysqlTimestamp(date: Date): string {
  return date.toISOString().slice(0, -1).replace("T", " ");
}

/** Model just these ordinary WHERE predicates of the actual emitted query.
 * A missing check deliberately leaves the fixture row visible, to expose a
 * regression through the repository's name and barcode entry paths. */
export function aliasLookupResult(query: Query, alias: AliasRow) {
  const eqFields = [
    ["user_id", alias.userId], ["normalized_alias", alias.alias], ["source", alias.source],
    ["status", alias.status], ["current_slot", alias.currentSlot],
  ] as const;
  for (const [field, value] of eqFields) {
    const predicate = `\`user_food_aliases\`.\`${field}\` = ?`;
    const offset = query.sql.indexOf(predicate);
    if (offset >= 0 && query.params[query.sql.slice(0, offset).split("?").length - 1] !== value) return [];
  }
  if (query.sql.includes("`user_food_aliases`.`revoked_at` is null") && alias.revokedAt !== null) return [];
  const bound = "`user_food_aliases`.`confirmed_at` <= ?";
  if (query.sql.includes(bound)) {
    const index = query.sql.slice(0, query.sql.indexOf(bound)).split("?").length - 1;
    const cutoff = query.params[index];
    if (typeof cutoff !== "string" || alias.confirmedAt === null || mysqlTimestamp(alias.confirmedAt) > cutoff) return [];
  }
  return [{ id: alias.id }];
}
