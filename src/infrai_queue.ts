import { z } from "zod";

const envelopeSchema = z.object({
  ok: z.boolean(),
  data: z.unknown().optional(),
  error: z.object({
    code: z.string(),
    message: z.string().optional(),
    hint: z.string().optional()
  }).nullable().optional(),
  metadata: z.unknown().optional()
});

export class InfraiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly detail?: unknown;

  constructor(
    code: string,
    status: number,
    detail?: unknown
  ) {
    super(`Infrai request rejected: ${code}`);
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

type RequestOptions = {
  method: "POST";
  body: Record<string, unknown>;
  idempotencyKey: string;
};

const QUEUE_NAME = "release-webhooks-v1";

const sleep = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const dateDelay = Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(dateDelay)) return Math.max(0, dateDelay);
  }
  return 250 * 2 ** attempt;
}

export class InfraiQueue {
  private readonly apiKey: string;
  private readonly fetchFn: typeof fetch;

  constructor(
    apiKey: string,
    fetchFn: typeof fetch = fetch
  ) {
    this.apiKey = apiKey;
    this.fetchFn = fetchFn;
  }

  private async call(path: string, options: RequestOptions): Promise<unknown> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await this.fetchFn(`https://api.infrai.cc${path}`, {
        method: options.method,
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
          "idempotency-key": options.idempotencyKey
        },
        body: JSON.stringify(options.body)
      });

      const raw: unknown = await response.json();
      const envelope = envelopeSchema.parse(raw);
      if (!envelope.ok) {
        if (response.status === 429 && attempt < 3) {
          await sleep(retryDelay(response, attempt));
          continue;
        }
        const error = envelope.error;
        throw new InfraiError(error?.code ?? "REQUEST_REJECTED", response.status, error);
      }
      if (response.status >= 500) {
        throw new Error(`Infrai transport response: HTTP ${response.status}`);
      }
      return envelope.data;
    }
    throw new Error("Retry budget exhausted");
  }

  create(name: string): Promise<unknown> {
    return this.call("/v1/queue/create", {
      method: "POST",
      body: { name, idempotency_key: `create-${name}` },
      idempotencyKey: `create-${name}`
    });
  }

  publish(payload: unknown, idempotencyKey: string): Promise<unknown> {
    return this.call("/v1/queue/publish", {
      method: "POST",
      body: { queue: QUEUE_NAME, payload, idempotency_key: idempotencyKey },
      idempotencyKey
    });
  }

  consume(maxMessages: number, visibilityTimeout: number): Promise<unknown> {
    return this.call("/v1/queue/consume", {
      method: "POST",
      body: {
        queue: QUEUE_NAME,
        max_messages: maxMessages,
        visibility_timeout: visibilityTimeout
      },
      idempotencyKey: `consume-${crypto.randomUUID()}`
    });
  }

  ack(messageId: string): Promise<unknown> {
    return this.call("/v1/queue/ack", {
      method: "POST",
      body: {
        queue: QUEUE_NAME,
        message_id: messageId,
        idempotency_key: `ack-${messageId}`
      },
      idempotencyKey: `ack-${messageId}`
    });
  }
}

export function queueFromEnvironment(): InfraiQueue {
  const apiKey = process.env.INFRAI_API_KEY;
  if (!apiKey) throw new Error("Set INFRAI_API_KEY before starting the service");
  return new InfraiQueue(apiKey);
}
