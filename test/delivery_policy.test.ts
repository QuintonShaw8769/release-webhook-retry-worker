import assert from "node:assert/strict";
import test from "node:test";
import { decideDelivery, type QueuedDelivery } from "../src/webhook_delivery.js";

const delivery: QueuedDelivery = {
  event: {
    id: "evt_build_42",
    kind: "build.completed",
    project: "cli-release",
    commit: "9f6b2ab",
    status: "passed",
    webhook_url: "https://hooks.example.test/builds"
  },
  attempt: 2
};

test("a rejected delivery schedules the next numbered attempt", () => {
  assert.deepEqual(decideDelivery(delivery, 429), {
    action: "retry",
    next: { ...delivery, attempt: 3 },
    diagnostic: "retry_scheduled"
  });
});

test("a successful delivery is acknowledged", () => {
  assert.deepEqual(decideDelivery(delivery, 204), {
    action: "ack",
    diagnostic: "delivered"
  });
});
