import { z } from "zod";
import { queueFromEnvironment } from "./infrai_queue.js";
import { decideDelivery, queuedDeliverySchema } from "./webhook_delivery.js";

const consumedMessageSchema = z.object({
  message_id: z.string().min(1),
  payload: queuedDeliverySchema
});

const consumedBatchSchema = z.union([
  z.array(consumedMessageSchema),
  z.object({ messages: z.array(consumedMessageSchema) }).transform(({ messages }) => messages)
]);

const queue = queueFromEnvironment();

async function runBatch(): Promise<void> {
  const messages = consumedBatchSchema.parse(await queue.consume(10, 30));
  for (const message of messages) {
    const delivery = message.payload;
    const result = await fetch(delivery.event.webhook_url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(delivery.event)
    });
    const decision = decideDelivery(delivery, result.status);

    if (decision.action === "retry") {
      await queue.publish(
        decision.next,
        `delivery-${delivery.event.id}-attempt-${decision.next.attempt}`
      );
    }
    await queue.ack(message.message_id);
    console.log(JSON.stringify({
      event_id: delivery.event.id,
      attempt: delivery.attempt,
      http_status: result.status,
      diagnostic: decision.diagnostic
    }));
  }
}

runBatch().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
