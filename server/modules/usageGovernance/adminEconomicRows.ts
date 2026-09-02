import { sql } from "drizzle-orm";
import { getDb } from "../../db";
import { requireDb, resultRows } from "../../repositories/billingRepositorySupport";
import { calculateVariableCostRatioBps, economicHealthBand } from "./service";
import { economicAdminMonthRange, isEconomicAdminRowInMonth } from "./economicAdminReadModel";

type Row = Record<string, unknown>;

function dateOrNull(value: unknown) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function monthOrdinal(value: Date) {
  return value.getUTCFullYear() * 12 + value.getUTCMonth();
}

function decorateEconomicRows(rows: Row[]) {
  const normalized = rows.map(row => ({
    competenceMonth: new Date(String(row.competenceMonth)),
    payerUserId: Number(row.payerUserId),
    subscriptionId: row.subscriptionId == null ? null : String(row.subscriptionId),
    productCode: row.productCode == null ? null : String(row.productCode),
    versionCode: row.versionCode == null ? null : String(row.versionCode),
    billingCycle: row.billingCycle == null ? null : String(row.billingCycle),
    currency: String(row.currency),
    recognizedContractRevenueMinor: Number(row.recognizedContractRevenueMinor ?? 0),
    discountMinor: Number(row.discountMinor ?? 0),
    couponMinor: Number(row.couponMinor ?? 0),
    creditMinor: Number(row.creditMinor ?? 0),
    refundMinor: Number(row.refundMinor ?? 0),
    chargebackMinor: Number(row.chargebackMinor ?? 0),
    taxMinor: Number(row.taxMinor ?? 0),
    receiptFeeMinor: Number(row.receiptFeeMinor ?? 0),
    financialCostMinor: Number(row.financialCostMinor ?? 0),
    netEconomicRevenueMinor: Number(row.netEconomicRevenueMinor ?? 0),
    variableCostMicros: Number(row.variableCostMicros ?? 0),
    variableCostRatioBps: row.variableCostRatioBps == null ? null : Number(row.variableCostRatioBps),
    measurementCoverageBps: Number(row.measurementCoverageBps ?? 0),
    ruleVersion: String(row.ruleVersion ?? "unknown"),
    updatedAt: dateOrNull(row.updatedAt),
  }));
  const groups = new Map<string, typeof normalized>();
  for (const row of normalized) {
    const key = `${row.payerUserId}|${row.subscriptionId ?? ""}|${row.productCode ?? ""}|${row.versionCode ?? ""}|${row.billingCycle ?? ""}|${row.currency}`;
    const current = groups.get(key) ?? [];
    current.push(row);
    groups.set(key, current);
  }
  const rolling = new Map<(typeof normalized)[number], number | null>();
  for (const group of groups.values()) {
    group.sort((a, b) => a.competenceMonth.getTime() - b.competenceMonth.getTime());
    for (let index = 0; index < group.length; index += 1) {
      const window = group.slice(Math.max(0, index - 2), index + 1);
      const consecutive = window.length === 3
        && monthOrdinal(window[1].competenceMonth) === monthOrdinal(window[0].competenceMonth) + 1
        && monthOrdinal(window[2].competenceMonth) === monthOrdinal(window[1].competenceMonth) + 1;
      const comparable = window.every(item => item.variableCostRatioBps !== null);
      rolling.set(group[index], consecutive && comparable
        ? calculateVariableCostRatioBps(
            window.reduce((sum, item) => sum + item.variableCostMicros, 0),
            window.reduce((sum, item) => sum + item.netEconomicRevenueMinor, 0),
          )
        : null);
    }
  }
  return normalized.map(row => ({
    ...row,
    health: economicHealthBand(row.variableCostRatioBps),
    rolling3MonthVariableCostRatioBps: rolling.get(row) ?? null,
    rolling3MonthHealth: economicHealthBand(rolling.get(row) ?? null),
    indirectCostStatus: "not_attributed" as const,
  })).sort((a, b) => b.competenceMonth.getTime() - a.competenceMonth.getTime());
}

export async function getUsageGovernanceAdminEconomicRows(input: {
  month: string;
  payerUserId?: number;
  productCode?: string;
  versionCode?: string;
  billingCycle?: string;
}) {
  const db = await requireDb(getDb);
  const { to, historyFrom } = economicAdminMonthRange(input.month);
  const rows = resultRows<Row>(await db.execute(sql`
    SELECT *
    FROM billingEconomicMonthlyAggregates
    WHERE competenceMonth >= DATE(${historyFrom})
      AND competenceMonth < DATE(${to})
      ${input.payerUserId === undefined ? sql`` : sql`AND payerUserId = ${input.payerUserId}`}
      ${input.productCode ? sql`AND productCode LIKE ${`%${input.productCode}%`}` : sql``}
      ${input.versionCode ? sql`AND versionCode LIKE ${`%${input.versionCode}%`}` : sql``}
      ${input.billingCycle ? sql`AND billingCycle LIKE ${`%${input.billingCycle}%`}` : sql``}
    ORDER BY competenceMonth DESC, updatedAt DESC
  `));
  return {
    rows: decorateEconomicRows(rows).filter(row => isEconomicAdminRowInMonth(row.competenceMonth, input.month)),
    generatedAt: new Date(),
  };
}
