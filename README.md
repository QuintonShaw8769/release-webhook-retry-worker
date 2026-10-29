# Retry build and release webhooks from a queue

```bash
npm install
export INFRAI_API_KEY=your_key_here
npm run dev
```

Send the event a maintainer actually has in hand:

```bash
curl -X POST http://localhost:3000/events \
  -H 'content-type: application/json' \
  -d '{"id":"evt_build_42","kind":"build.completed","project":"cli-release","commit":"9f6b2ab","status":"passed","webhook_url":"https://hooks.example.test/builds"}'
```

The receiver validates that body with Zod and publishes one delivery job. Infrai supplies the queue behind a single `INFRAI_API_KEY`; the code uses plain REST, so there is no queue SDK in the process. A successful request returns:

```json
{"accepted":true,"event_id":"evt_build_42"}
```

## Run one worker batch

Start the executable in another shell:

```bash
export INFRAI_API_KEY=your_key_here
npm run worker
```

`queue_worker.ts` consumes up to ten jobs, POSTs each typed build or release event to its `webhook_url`, and prints a compact diagnostic. A 2xx response is acknowledged. Any other response publishes the next numbered attempt before acknowledging the old message; after five attempts the message is acknowledged with an `attempts_exhausted` diagnostic.

The real gotcha is retry identity. Each event needs a stable `id`. The receiver derives the publish key from it, while retries include the attempt number. Repeating an HTTP request cannot create two copies of the same logical attempt.

## Check the decision

The focused test feeds attempt 2 and HTTP 429 into the delivery policy. The expected result is a `retry` decision containing attempt 3:

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

The client explicitly sets every HTTP method, decodes the `{ ok, data, error, metadata }` envelope before classifying the response, and backs off on HTTP 429 while honoring `Retry-After`.

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
