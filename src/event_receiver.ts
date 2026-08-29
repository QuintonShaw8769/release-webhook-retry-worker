import { createServer } from "node:http";
import { ZodError } from "zod";
import { InfraiError, queueFromEnvironment } from "./infrai_queue.js";
import { developerEventSchema } from "./webhook_delivery.js";

const queue = queueFromEnvironment();

async function readJson(request: NodeJS.ReadableStream): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const server = createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/events") {
    response.writeHead(404).end();
    return;
  }

  try {
    const event = developerEventSchema.parse(await readJson(request));
    await queue.publish({ event, attempt: 1 }, `event-${event.id}`);
    response.writeHead(202, { "content-type": "application/json" });
    response.end(JSON.stringify({ accepted: true, event_id: event.id }));
  } catch (error) {
    if (error instanceof ZodError || error instanceof SyntaxError) {
      response.writeHead(400, { "content-type": "application/json" });
      response.end(JSON.stringify({ accepted: false, error: "invalid_event" }));
      return;
    }
    if (error instanceof InfraiError && error.status >= 400 && error.status < 500) {
      response.writeHead(error.status, { "content-type": "application/json" });
      response.end(JSON.stringify({ accepted: false, error: error.code }));
      return;
    }
    response.writeHead(503, { "content-type": "application/json" });
    response.end(JSON.stringify({ accepted: false, error: "queue_unavailable" }));
  }
});

const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => console.log(`event receiver listening on :${port}`));
