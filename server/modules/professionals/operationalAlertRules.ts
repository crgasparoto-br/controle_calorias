import {
  addCalendarDays,
  getDateKeyInTimeZone,
  getUtcRangeForLocalDate,
} from "../../../shared/timeZone";

export function getDateKeyInZone(date: Date, timeZone: string) {
  return getDateKeyInTimeZone(date, timeZone);
}

export function startOfCalendarDayInZone(date: Date, timeZone: string) {
  const dateKey = getDateKeyInTimeZone(date, timeZone);
  return getUtcRangeForLocalDate(dateKey, timeZone).startAt;
}

/**
 * Returns the current patient-local calendar day plus the two immediately
 * preceding local calendar days. This is the project's explicit definition of
 * "últimos 3 dias corridos" for operational alerts.
 */
export function getNoFoodRecordsWindow(now: Date, timeZone: string) {
  const currentDateKey = getDateKeyInTimeZone(now, timeZone);
  const startDateKey = addCalendarDays(currentDateKey, -2);

  return {
    start: getUtcRangeForLocalDate(startDateKey, timeZone).startAt,
    end: now,
    startDateKey,
    endDateKey: currentDateKey,
  };
}

export function buildOperationalAlertDedupeKey(
  authorizationId: string,
  type: string,
  originOrPeriod: string
) {
  return `${authorizationId}:${type}:${originOrPeriod}`;
}

export function shouldCloseWeighInRequest(
  requestCreatedAt: Date,
  latestWeightMeasuredAt: Date | null
) {
  return Boolean(
    latestWeightMeasuredAt && latestWeightMeasuredAt >= requestCreatedAt
  );
}

export function isOperationalAlertScopeActive(
  authorizationStatus: string,
  trackingStatus: string
) {
  return authorizationStatus === "approved" && trackingStatus === "active";
}
