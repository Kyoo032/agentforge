/**
 * A local stand-in for the Telegram Bot API, over real HTTP, so the whole app can be driven through
 * the Channels page without a BotFather token.
 *
 * ```
 * npx tsx scripts/telegram-sandbox.ts                     # listens on 127.0.0.1:3399
 * AGENTFORGE_TELEGRAM_API_URL=http://127.0.0.1:3399 pnpm dev
 * ```
 *
 * Then, in the app: Channels → paste the token this prints → add the chat id it prints → send.
 * To make a message arrive from the other side:
 *
 * ```
 * curl -X POST http://127.0.0.1:3399/_sandbox/arrive \
 *   -H 'content-type: application/json' \
 *   -d '{"chatId":"-1001234567890","author":"kyo","text":"what is BBCA doing"}'
 * ```
 *
 * `GET /_sandbox/state` shows what the bot has sent and what is still queued.
 *
 * Dev tooling, never shipped: `AGENTFORGE_TELEGRAM_API_URL` is ignored in a packaged build and when
 * `NODE_ENV=production` (`packages/core/src/channels/pinned.ts`), so this cannot re-point the real
 * product. Loopback only.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { SANDBOX_TOKEN, createBotApiSandbox } from "../packages/host/src/channels/__fixtures__/bot-api";

const PORT = Number(process.env.PORT ?? 3399);
const HOST = "127.0.0.1";

const DEFAULT_CHAT = {
  id: "-1001234567890",
  title: "Trading floor",
  type: "supergroup" as const,
  username: "trading_floor",
};

const CHATS = [
  DEFAULT_CHAT,
  { id: "-1009876543210", title: "Market blast", type: "channel" as const, username: "market_blast" },
];

const sandbox = createBotApiSandbox({ chats: CHATS });

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk as Buffer));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function send(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body, null, 2);
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(payload);
}

const server = createServer((request, response) => {
  void (async () => {
    const url = new URL(request.url ?? "/", `http://${HOST}:${PORT}`);
    const body = await readBody(request);

    if (url.pathname === "/_sandbox/state") {
      send(response, 200, { token: SANDBOX_TOKEN, chats: CHATS, sent: sandbox.sent, pending: sandbox.pending() });
      return;
    }

    if (url.pathname === "/_sandbox/arrive") {
      try {
        const input = JSON.parse(body || "{}") as { chatId?: string; text?: string; author?: string };
        const chatId = input.chatId ?? DEFAULT_CHAT.id;
        const updateId = sandbox.arrive({
          chatId,
          text: input.text ?? "hello from the sandbox",
          author: input.author ?? "tester",
        });
        console.log(`[sandbox] queued update ${updateId} for ${chatId}`);
        send(response, 200, { ok: true, updateId, pending: sandbox.pending() });
      } catch (error) {
        send(response, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    // Everything else is the Bot API itself, answered by the same fixture the tests use.
    const answer = await sandbox.fetch(`http://${HOST}:${PORT}${url.pathname}`, { method: "POST", body });
    const text = await answer.text();
    console.log(`[sandbox] ${url.pathname.replace(/\/bot[^/]+\//, "/bot<token>/")} → ${answer.status}`);
    response.writeHead(answer.status, { "Content-Type": "application/json" });
    response.end(text);
  })();
});

server.listen(PORT, HOST, () => {
  console.log(`Telegram sandbox on http://${HOST}:${PORT}`);
  console.log(`  bot token : ${SANDBOX_TOKEN}`);
  for (const chat of CHATS) {
    console.log(`  chat      : ${chat.id}  (@${chat.username}, ${chat.type}) — ${chat.title}`);
  }
  console.log(`  point the app at it: AGENTFORGE_TELEGRAM_API_URL=http://${HOST}:${PORT} pnpm dev`);
});
