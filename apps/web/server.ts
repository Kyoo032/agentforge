// MUST stay first: it sets AGENTFORGE_APPLY_PENDING_RESET before @agentforge/host (and through it
// @agentforge/db) is evaluated, which is when a queued "Start over" wipe is applied. See server-env.ts.
import "./server-env";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isServerMode } from "@agentforge/core";
import express from "express";
import { createServer as createViteServer } from "vite";
import { handleNodeRequest } from "@agentforge/host/http";
import { resolveBindHost } from "./lib/bind-host";
import { assertHostedModeCoherent } from "./lib/hosted-mode-guard";
import { injectHostedMarker } from "./lib/hosted-build";

const dir = path.dirname(fileURLToPath(import.meta.url));
const isProd = process.env.NODE_ENV === "production";

/**
 * The renderer cannot read `process.env`, so the hosted server tells the page what it is by
 * stamping one meta tag into the `index.html` it serves (`lib/hosted-build.ts`). Every branch below
 * is a no-op when this is false, which is the desktop and webdev: their html is byte-for-byte what
 * it was, served by exactly the middleware that served it before.
 */
const hosted = isServerMode(process.env);

/** True for the requests that should get the app shell rather than a file or the API. */
function wantsAppShell(req: express.Request): boolean {
  return (req.method === "GET" || req.method === "HEAD") && !req.path.startsWith("/api/");
}

function sendAppShell(res: express.Response, html: string): void {
  res.status(200).type("html").send(html);
}

async function main() {
  // A production build with AGENTFORGE_SERVER off would serve every GET /api/v1/* without a
  // session while the health check still passed, so it refuses to boot instead. See
  // ./lib/hosted-mode-guard.
  assertHostedModeCoherent(process.env);
  const app = express();
  // Identity masking: Express stamps `X-Powered-By: Express` from its init middleware on every
  // response, before any handler of ours runs. Nothing about the software answering should be on the
  // wire, so it is switched off here, at the app, and the host adapter removes it again as a floor
  // (packages/host/src/http-adapter.ts IDENTITY_HEADERS). Must stay above the first `app.use`.
  app.disable("x-powered-by");
  const server = http.createServer(app);

  app.use((req, res, next) => {
    void handleNodeRequest(req, res).then((handled) => {
      if (!handled) {
        next();
      }
    }, next);
  });

  if (isProd) {
    const dist = path.join(dir, "dist");
    const indexFile = path.join(dist, "index.html");
    // Read and marked once at boot: the built shell never changes under a running server, and a
    // per-request read would put the disk in front of every navigation.
    const marked = hosted ? injectHostedMarker(readFileSync(indexFile, "utf8"), true) : null;
    if (marked) {
      // Ahead of `express.static`, which would otherwise answer `/` and `/index.html` from disk and
      // hand out the one copy of the shell without the marker.
      app.use((req, res, next) => {
        if (wantsAppShell(req) && (req.path === "/" || req.path === "/index.html")) {
          sendAppShell(res, marked);
          return;
        }
        next();
      });
    }
    app.use(express.static(dist, marked ? { index: false } : {}));
    app.use((req, res, next) => {
      if (!wantsAppShell(req)) {
        next();
        return;
      }
      if (marked) {
        sendAppShell(res, marked);
        return;
      }
      res.sendFile(indexFile);
    });
  } else {
    const vite = await createViteServer({
      configFile: path.join(dir, "vite.config.ts"),
      server: { middlewareMode: true, hmr: { server } },
      // Off the hosted server this is untouched: vite serves index.html itself, exactly as webdev
      // and the desktop dev run have always had it. "custom" is the only way to get the transformed
      // html in hand before it goes out, and it is taken only where the marker has to be added.
      appType: hosted ? "custom" : "spa",
    });
    app.use(vite.middlewares);
    if (hosted) {
      app.use((req, res, next) => {
        if (!wantsAppShell(req)) {
          next();
          return;
        }
        void readFile(path.join(dir, "index.html"), "utf8")
          .then((template) => vite.transformIndexHtml(req.originalUrl, template))
          .then((html) => sendAppShell(res, injectHostedMarker(html, true)))
          .catch((error: unknown) => {
            vite.ssrFixStacktrace(error as Error);
            next(error);
          });
      });
    }
  }

  // Webdev is :3000. PORT only exists so a verification run can bring up an isolated second
  // instance (own AGENTFORGE_DATA_DIR) without touching the operator's desk. BIND_HOST stays
  // loopback unless this is the hosted server, where the proxy is the only public listener;
  // `resolveBindHost` throws rather than let a local run go LAN-wide by accident.
  const port = Number(process.env.PORT) || 3000;
  const host = resolveBindHost(process.env);
  server.listen(port, host, () => {
    console.log(`@agentforge/web:dev: listening on ${host}:${port} (http://${host}:${port})`);
  });
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
