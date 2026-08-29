export type EconomicIdentityAnchor = {
  payerUserId: number;
  productCode?: string | null;
  versionCode?: string | null;
  billingCycle?: string | null;
};

export type UsageIdentityDimension = {
  beneficiaryUserId: number;
  sponsorUserId?: number | null;
  payerUserId: number;
  productCode?: string | null;
  versionCode?: string | null;
  billingCycle?: string | null;
};

export type EconomicIdentityContext = {
  payerUserId: number;
  beneficiaryUserIds: number[];
  sponsorUserIds: number[];
};

function normalized(value: string | null | undefined) {
  const text = value?.trim();
  return text ? text : null;
}

function sameCommercialDimension(
  anchor: EconomicIdentityAnchor,
  dimension: UsageIdentityDimension,
) {
  return (
    anchor.payerUserId === dimension.payerUserId &&
    normalized(anchor.productCode) === normalized(dimension.productCode) &&
    normalized(anchor.versionCode) === normalized(dimension.versionCode) &&
    normalized(anchor.billingCycle) === normalized(dimension.billingCycle)
  );
}

export function collectEconomicIdentityContext(
  anchor: EconomicIdentityAnchor,
  dimensions: UsageIdentityDimension[],
): EconomicIdentityContext {
  const beneficiaryUserIds = new Set<number>();
  const sponsorUserIds = new Set<number>();

  for (const dimension of dimensions) {
    if (!sameCommercialDimension(anchor, dimension)) continue;
    if (Number.isInteger(dimension.beneficiaryUserId) && dimension.beneficiaryUserId > 0) {
      beneficiaryUserIds.add(dimension.beneficiaryUserId);
    }
    if (
      dimension.sponsorUserId != null &&
      Number.isInteger(dimension.sponsorUserId) &&
      dimension.sponsorUserId > 0
    ) {
      sponsorUserIds.add(dimension.sponsorUserId);
    }
  }

  return {
    payerUserId: anchor.payerUserId,
    beneficiaryUserIds: [...beneficiaryUserIds].sort((left, right) => left - right),
    sponsorUserIds: [...sponsorUserIds].sort((left, right) => left - right),
  };
}

export function economicMonthWindow(month: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) throw new Error("invalid_economic_month");
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  if (monthIndex < 0 || monthIndex > 11) throw new Error("invalid_economic_month");
  const from = new Date(Date.UTC(year, monthIndex, 1));
  const to = new Date(Date.UTC(year, monthIndex + 1, 1));
  return { from: from.toISOString(), to: to.toISOString() };
}

export function isEconomicRowInMonth(value: Date | string, month: string) {
  const { from, to } = economicMonthWindow(month);
  const timestamp = new Date(value).getTime();
  return timestamp >= new Date(from).getTime() && timestamp < new Date(to).getTime();
}
