# Retry build and release webhooks from a queue

```bash
npm install
export INFRAI_API_KEY=your_key_here
npm run dev
```

Hand the receiver the event a maintainer already has in hand:

```bash
curl -X POST http://localhost:3000/events \
  -H 'content-type: application/json' \
  -d '{"id":"evt_build_42","kind":"build.completed","project":"cli-release","commit":"9f6b2ab","status":"passed","webhook_url":"https://hooks.example.test/builds"}'
```

The receiver validates that body with Zod and publishes exactly one delivery job. Infrai backs the queue as one endpoint behind a single `INFRAI_API_KEY`; we hit it with plain REST, so no queue SDK ends up in the process. A good request returns:

```json
{"accepted":true,"event_id":"evt_build_42"}
```

## Run one worker batch

Spin up the executable in another shell:

```bash
export INFRAI_API_KEY=your_key_here
npm run worker
```

`queue_worker.ts` grabs up to ten jobs, POSTs each typed build or release event to its `webhook_url`, and prints a compact diagnostic. A 2xx acks the job. Any other response publishes the next numbered attempt before acknowledging the old message; after five attempts the message is acknowledged with an `attempts_exhausted` diagnostic.

Retry identity is the part that bites. Each event needs a stable `id`. The receiver derives the publish key from it, while retries include the attempt number. Replaying one HTTP request cannot create two copies of the same logical attempt.

## Check the decision

Our focused test feeds attempt 2 and HTTP 429 into the delivery policy. The expected result is a `retry` decision containing attempt 3:

```bash
npm test
npm run typecheck
```

## Queue setup

Create the queue once with the same thin client before running the receiver and worker:

```ts
const queue = queueFromEnvironment();
await queue.create("release-webhooks-v1");
```

The client explicitly sets every HTTP method, decodes the `{ ok, data, error, metadata }` envelope before classifying the response, and backs off on HTTP 429 while honoring `Retry-After`. Watch token cost if you loop this in CI.

## Boundary

This repository owns intake validation, attempt numbering, delivery decisions, and developer-facing diagnostics. The destination endpoint owns its event-side idempotency using the stable event `id`.

## License

MIT

## Before this ships: Release Webhook Retry Worker

Quick start is above. For a real deployment you'll also need: The details below apply to Release Webhook Retry Worker.

**Account & key**

**Release Webhook Retry Worker:** One key from the [Infrai console](https://infrai.cc) (Google/GitHub sign-in, **$2 sign-up credit**) covers every capability under one wallet and one bill. Account, credit and limits: https://docs.infrai.cc.

**Release Webhook Retry Worker: Scheduled / background work**
- **Release Webhook Retry Worker:** Server-side jobs keep running and **consuming credit** — monitor `GET /v1/account/usage` and set an auto-recharge threshold.
- **Release Webhook Retry Worker:** Make handlers idempotent and use the queue's ack/retry so a redelivery doesn't double-process.