import { z } from "zod";

const reason = z.string().trim().min(3).max(255);

export const billingAdminNotificationListSchema = z.object({
  limit: z.number().int().min(1).max(250).default(100),
  campaign: z.string().trim().max(120).optional(),
  campaignVersion: z.string().trim().max(32).optional(),
  category: z.enum(["promotional", "operational", "financial", "security"]).optional(),
  audience: z.enum(["individual", "professional"]).optional(),
  trigger: z.string().trim().max(120).optional(),
  milestone: z.string().trim().max(120).optional(),
  channel: z.enum(["internal", "email", "whatsapp"]).optional(),
  deliveryState: z.enum(["not_attempted", "pending", "delivered", "failed"]).optional(),
  state: z.enum(["open", "completed", "failed"]).optional(),
});

export const billingAdminNotificationRetrySchema = z.object({
  requestId: z.string().uuid(),
  notificationId: z.string().trim().min(1).max(64),
  userId: z.number().int().positive(),
  channel: z.enum(["email", "whatsapp"]),
  reason,
  overrideReason: z.string().trim().min(3).max(255).optional(),
});

export const billingAdminNotificationFailureAckSchema = z.object({
  notificationId: z.string().trim().min(1).max(64),
  userId: z.number().int().positive(),
  channel: z.enum(["email", "whatsapp"]),
  assignedToUserId: z.number().int().positive(),
  reason,
});

export const billingAdminCampaignControlSchema = z.object({
  campaign: z.string().trim().min(1).max(120),
  campaignVersion: z.string().trim().min(1).max(32),
  paused: z.boolean(),
  reason,
});
