import { DEFAULT_APP_TIME_ZONE } from "../../../shared/timeZone";
import { prepareCountableFoodRegistration } from "../../countableFoodQuantity";
import { requestWhatsappConfirmedTextMealQuantityClarification } from "./foodQuantityClarification";
import type { WhatsappIntentResult } from "./intent/types";

export type CountableFoodRegistrationGateResult =
  | { kind: "ready"; registrationText: string }
  | { kind: "clarification"; result: WhatsappIntentResult };

export async function prepareWhatsappCountableFoodRegistration(input: {
  userId: number;
  text?: string | null;
  originalText?: string | null;
  inboundMessageId?: string | null;
  receivedAt?: Date;
  userTimezone?: string;
}): Promise<CountableFoodRegistrationGateResult> {
  const text = input.text?.trim() ?? "";
  const prepared = prepareCountableFoodRegistration(text);
  const firstPending = prepared.pendingItems[0];
  if (!firstPending) {
    return { kind: "ready", registrationText: prepared.registrationText || text };
  }

  const occurredAt = input.receivedAt ?? new Date();
  const clarification = await requestWhatsappConfirmedTextMealQuantityClarification({
    userId: input.userId,
    foodName: firstPending.foodName,
    originalText: input.originalText?.trim() || text,
    registrationSegments: prepared.registrationSegments,
    pendingItems: prepared.pendingItems.map(item => ({
      segmentIndex: item.segmentIndex,
      segment: item.segment,
      foodName: item.foodName,
      count: item.count,
      requestedUnit: item.requestedUnit,
    })),
    currentPendingIndex: 0,
    occurredAt,
    userTimezone: input.userTimezone ?? DEFAULT_APP_TIME_ZONE,
    messageId: input.inboundMessageId,
    instructionText: `Para registrar ${firstPending.segment} sem assumir 100 g, informe somente o peso ou volume correspondente, por exemplo 20 g.`,
  });
  return { kind: "clarification", result: clarification };
}
