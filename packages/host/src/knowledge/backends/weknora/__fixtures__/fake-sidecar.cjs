#!/usr/bin/env node
/**
 * A stand-in for the WeKnora-lite *binary*, used by the supervisor tests.
 *
 * It does the only three things the supervisor cares about: read `SERVER_PORT` / `SERVER_HOST` from
 * the environment, bind them, and answer `GET /health` with `{"status":"ok"}`. It also echoes its
 * own environment on `GET /__env`, which is how the env-allowlist assertion proves that what the
 * supervisor *builds* is what the child actually *receives* — the two are only the same thing if
 * nothing in between re-merges `process.env`.
 *
 * Run modes, passed as `argv[2]` — deliberately *not* an environment variable, because the
 * supervisor's own allowlist would (correctly) refuse to pass one through:
 *   ok      (default) bind and serve
 *   crash   exit(3) immediately, so a failed start is testable
 *   silent  bind nothing, so the readiness timeout is testable
 */
const http = require("node:http");

function serve() {
  const port = Number(process.env.SERVER_PORT || 0);
  const host = process.env.SERVER_HOST || "127.0.0.1";
  const server = http.createServer((req, res) => {
    const path = (req.url || "/").split("?")[0];
    if (path === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }
    if (path === "/__env") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(process.env));
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });
  server.listen(port, host, () => {
    process.stdout.write(`Server is running at ${host}:${port}`);
  });
}

const mode = process.argv[2] || "ok";
if (mode === "crash") {
  process.stderr.write("fake sidecar: refusing to start");
  process.exit(3);
} else if (mode === "silent") {
  // Stay alive, answer nothing: exactly what a sidecar wedged on a migration looks like.
  setInterval(() => {}, 1 << 30);
} else {
  serve();
}
