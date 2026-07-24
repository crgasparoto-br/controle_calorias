import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/mysql-core";
import {
  billingAccessAuditEvents,
  billingAdminOverrides,
  billingCapacityAllocations,
  billingEntitlements,
  billingSubscriptions,
} from "../../../drizzle/billing-schema";
import { users } from "../../../drizzle/schema";

function foreignKeyForColumn(
  table: Parameters<typeof getTableConfig>[0],
  columnName: string
) {
  return getTableConfig(table).foreignKeys.find(foreignKey =>
    foreignKey.reference().columns.some(column => column.name === columnName)
  );
}

describe("billing account deletion safety", () => {
  it("cascades records owned by the deleted account", () => {
    expect(
      foreignKeyForColumn(billingSubscriptions, "payerUserId")?.onDelete
    ).toBe("cascade");
    expect(
      foreignKeyForColumn(billingEntitlements, "beneficiaryUserId")?.onDelete
    ).toBe("cascade");
    expect(foreignKeyForColumn(billingAdminOverrides, "userId")?.onDelete).toBe(
      "cascade"
    );
    expect(
      foreignKeyForColumn(billingAccessAuditEvents, "subjectUserId")?.onDelete
    ).toBe("cascade");
  });

  it("removes capacity rows and pseudonymizes historical actors", () => {
    const capacityConfig = getTableConfig(billingCapacityAllocations);
    const userForeignKeys = capacityConfig.foreignKeys.filter(
      foreignKey => foreignKey.reference().foreignTable === users
    );
    expect(userForeignKeys).toHaveLength(2);
    expect(
      userForeignKeys.every(foreignKey => foreignKey.onDelete === "cascade")
    ).toBe(true);
    expect(
      foreignKeyForColumn(billingAdminOverrides, "grantedByUserId")?.onDelete
    ).toBe("set null");
    expect(
      foreignKeyForColumn(billingAdminOverrides, "revokedByUserId")?.onDelete
    ).toBe("set null");
    expect(
      foreignKeyForColumn(billingAccessAuditEvents, "actorUserId")?.onDelete
    ).toBe("set null");
    expect(
      foreignKeyForColumn(billingEntitlements, "sponsorUserId")?.onDelete
    ).toBe("set null");
  });
});
