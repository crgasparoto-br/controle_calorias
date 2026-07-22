import type { BillingSubscriptionSummary } from "./types";

export function subscriptionGrantsAccess(
  subscription: Pick<
    BillingSubscriptionSummary,
    "status" | "currentPeriodStart" | "currentPeriodEnd"
  >,
  now: Date
) {
  if (subscription.status !== "active") return false;
  if (
    subscription.currentPeriodStart &&
    subscription.currentPeriodStart.getTime() > now.getTime()
  ) {
    return false;
  }
  return !(
    subscription.currentPeriodEnd &&
    subscription.currentPeriodEnd.getTime() <= now.getTime()
  );
}

export function activeHolderPlanKey(input: {
  payerUserId: number;
  planId: string;
  status: BillingSubscriptionSummary["status"];
}) {
  return input.status === "active"
    ? `${input.payerUserId}:${input.planId}`
    : null;
}
