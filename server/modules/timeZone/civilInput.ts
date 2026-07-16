import {
  ZonedDateTimeError,
  zonedDateTimeLocalToIso,
} from "../../../shared/timeZone";

export class OwnerLocalDateTimeInputError extends Error {
  readonly code: ZonedDateTimeError["code"];

  constructor(error: ZonedDateTimeError) {
    super(error.message);
    this.name = "OwnerLocalDateTimeInputError";
    this.code = error.code;
  }
}

export function resolveOwnerLocalDateTime(dateTimeLocal: string, timeZone: string) {
  try {
    return zonedDateTimeLocalToIso(dateTimeLocal, timeZone);
  } catch (error) {
    if (error instanceof ZonedDateTimeError) {
      throw new OwnerLocalDateTimeInputError(error);
    }
    throw error;
  }
}
