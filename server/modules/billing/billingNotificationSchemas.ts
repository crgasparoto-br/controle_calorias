import { z } from "zod";

export const billingNotificationReadSchema = z.object({
  notificationId: z.string().trim().min(1).max(64),
});
