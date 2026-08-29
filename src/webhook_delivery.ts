import { z } from "zod";

export const buildEventSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("build.completed"),
  project: z.string().min(1),
  commit: z.string().min(7),
  status: z.enum(["passed", "failed"]),
  webhook_url: z.string().url()
});

export const releaseEventSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("release.published"),
  project: z.string().min(1),
  version: z.string().min(1),
  webhook_url: z.string().url()
});

export const developerEventSchema = z.discriminatedUnion("kind", [
  buildEventSchema,
  releaseEventSchema
]);

export type DeveloperEvent = z.infer<typeof developerEventSchema>;

export const queuedDeliverySchema = z.object({
  event: developerEventSchema,
  attempt: z.number().int().min(1)
});

export type QueuedDelivery = z.infer<typeof queuedDeliverySchema>;

export type DeliveryDecision =
  | { action: "ack"; diagnostic: "delivered" | "attempts_exhausted" }
  | { action: "retry"; next: QueuedDelivery; diagnostic: "retry_scheduled" };

export function decideDelivery(
  delivery: QueuedDelivery,
  httpStatus: number,
  maxAttempts = 5
): DeliveryDecision {
  if (httpStatus >= 200 && httpStatus < 300) {
    return { action: "ack", diagnostic: "delivered" };
  }
  if (delivery.attempt >= maxAttempts) {
    return { action: "ack", diagnostic: "attempts_exhausted" };
  }
  return {
    action: "retry",
    next: { ...delivery, attempt: delivery.attempt + 1 },
    diagnostic: "retry_scheduled"
  };
}
