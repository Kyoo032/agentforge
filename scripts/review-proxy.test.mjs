/**
 * Tests for scripts/review-proxy.mjs. HARNESS, NEVER SHIPS.
 *
 * Node's own runner, like scripts/audit-deployed.test.mjs and scripts/deploy-scripts.test.mjs:
 * this is repo tooling outside every workspace package, so no vitest config would ever collect it.
 * `node --test "scripts/*.test.mjs"` runs it, and .github/workflows/ci.yml does exactly that.
 *
 * Nothing here binds a fixed port, starts TLS, or touches the operator's :3000 webdev: the pure
 * pieces are called directly, and the one end-to-end case mounts the same request handler on a
 * plain http server on an EPHEMERAL port. That is deliberate rather than convenient — the
 * behaviour worth pinning (proto stamped, Host untouched, body streamed, dead upstream answered)
 * is all on the proxying path, and none of it changes because TLS wraps the listener.
 */

import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { after, test } from "node:test";
import {
  createProxyHandler,
  ensureCert,
  findOpenssl,
  forwardRequestHeaders,
  isLoopbackHost,
  parseArgs,
  stripHopByHop,
} from "./review-proxy.mjs";

const BASE_ARGS = ["--listen", "3443", "--upstream", "127.0.0.1:3100", "--cert-dir", "/tmp/review-tls"];

/** Everything this file opens, closed in one place so a failing assertion cannot leak a listener. */
const openServers = [];
after(async () => {
  await Promise.all(openServers.map((server) => new Promise((resolve) => server.close(resolve))));
});

function listen(server) {
  openServers.push(server);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

/** A port nothing is listening on: bind an ephemeral one, read it back, then give it up. */
async function deadPort() {
  const server = net.createServer();
  const port = await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
  await new Promise((resolve) => server.close(resolve));
  return port;
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

test("parseArgs reads the three flags the usage line documents", () => {
  const args = parseArgs(BASE_ARGS);
  assert.deepEqual(args.listen, { host: "127.0.0.1", port: 3443 });
  assert.deepEqual(args.upstream, { host: "127.0.0.1", port: 3100 });
  assert.equal(args.certDir, "/tmp/review-tls");
});

test("parseArgs accepts an explicit loopback listen address", () => {
  for (const value of ["127.0.0.1:3443", "localhost:3443", "[::1]:3443"]) {
    const args = parseArgs(["--listen", value, "--upstream", "127.0.0.1:3100"]);
    assert.equal(args.listen.port, 3443, value);
    assert.ok(isLoopbackHost(args.listen.host), `${value} should parse to a loopback host`);
  }
});

test("parseArgs refuses a listen address that is not loopback", () => {
  for (const value of ["0.0.0.0:3443", "192.168.1.10:3443", "example.test:3443", "[::]:3443"]) {
    assert.throws(() => parseArgs(["--listen", value, "--upstream", "127.0.0.1:3100"]), /loopback/i, value);
  }
});

test("parseArgs refuses a missing or malformed value", () => {
  assert.throws(() => parseArgs(["--upstream", "127.0.0.1:3100"]), /--listen/);
  assert.throws(() => parseArgs(["--listen", "3443"]), /--upstream/);
  assert.throws(() => parseArgs(["--listen", "3443", "--upstream", "127.0.0.1"]), /host:port/i);
  assert.throws(() => parseArgs(["--listen", "notaport", "--upstream", "127.0.0.1:3100"]), /port/i);
  assert.throws(() => parseArgs(["--listen", "0", "--upstream", "127.0.0.1:3100"]), /port/i);
  assert.throws(() => parseArgs(["--listen", "70000", "--upstream", "127.0.0.1:3100"]), /port/i);
  assert.throws(() => parseArgs([...BASE_ARGS, "--listen"]), /--listen/);
  assert.throws(() => parseArgs([...BASE_ARGS, "--nonsense"]), /unknown/i);
});

test("parseArgs defaults the cert dir outside the repo", () => {
  const { certDir } = parseArgs(["--listen", "3443", "--upstream", "127.0.0.1:3100"]);
  assert.ok(certDir.length > 0);
  assert.doesNotMatch(certDir, /agentforge/i, "the default cert dir must not land in a checkout");
});

// ---------------------------------------------------------------------------
// Header rewriting — the whole reason this proxy exists
// ---------------------------------------------------------------------------

test("the proto header is stamped https, overwriting whatever a client sent", () => {
  const stamped = forwardRequestHeaders(
    { host: "localhost:3443", "x-forwarded-proto": "http" },
    { remoteAddress: "127.0.0.1" },
  );
  assert.equal(stamped["x-forwarded-proto"], "https");
});

test("x-forwarded-for is appended to an existing value, not replaced", () => {
  const stamped = forwardRequestHeaders(
    { host: "localhost:3443", "x-forwarded-for": "203.0.113.9" },
    { remoteAddress: "127.0.0.1" },
  );
  assert.equal(stamped["x-forwarded-for"], "203.0.113.9, 127.0.0.1");
});

test("x-forwarded-for is set from the peer when the client sent none", () => {
  const stamped = forwardRequestHeaders({ host: "localhost:3443" }, { remoteAddress: "::ffff:127.0.0.1" });
  assert.equal(stamped["x-forwarded-for"], "::ffff:127.0.0.1");
});

test("Host is passed through UNCHANGED", () => {
  // The hosted Origin/Host check (packages/host/src/local-request.ts isAllowedWebHostHeader)
  // compares this against AGENTFORGE_TRUSTED_ORIGINS. Rewriting it to the upstream's loopback
  // address is exactly what makes every POST answer 403 origin_forbidden.
  const stamped = forwardRequestHeaders({ host: "localhost:3443" }, { remoteAddress: "127.0.0.1" });
  assert.equal(stamped.host, "localhost:3443");
  assert.equal(stamped.Host, undefined, "the name must stay lower-cased, not duplicated");
});

test("hop-by-hop headers are stripped from a forwarded request", () => {
  const stamped = forwardRequestHeaders(
    {
      host: "localhost:3443",
      connection: "keep-alive",
      "keep-alive": "timeout=5",
      "proxy-authenticate": "Basic",
      "proxy-authorization": "Basic Zm9v",
      te: "trailers",
      trailer: "Expires",
      "transfer-encoding": "chunked",
      upgrade: "h2c",
      "content-type": "application/json",
    },
    { remoteAddress: "127.0.0.1" },
  );
  for (const name of [
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
  ]) {
    assert.equal(stamped[name], undefined, `${name} survived`);
  }
  assert.equal(stamped["content-type"], "application/json", "an end-to-end header must survive");
});

test("headers named by Connection are stripped too", () => {
  const stamped = forwardRequestHeaders(
    { host: "h", connection: "close, X-Hop-Only", "x-hop-only": "1", "x-kept": "1" },
    { remoteAddress: "127.0.0.1" },
  );
  assert.equal(stamped["x-hop-only"], undefined);
  assert.equal(stamped["x-kept"], "1");
});

test("an upgrade keeps Connection and Upgrade, which is what makes Vite HMR work", () => {
  const stamped = forwardRequestHeaders(
    { host: "localhost:3443", connection: "Upgrade", upgrade: "websocket", "sec-websocket-key": "abc" },
    { remoteAddress: "127.0.0.1", upgrade: true },
  );
  assert.equal(stamped.connection, "Upgrade");
  assert.equal(stamped.upgrade, "websocket");
  assert.equal(stamped["sec-websocket-key"], "abc");
  assert.equal(stamped["x-forwarded-proto"], "https");
});

test("forwardRequestHeaders never mutates what it was given", () => {
  const original = { host: "h", connection: "keep-alive", "x-forwarded-for": "203.0.113.9" };
  const snapshot = { ...original };
  forwardRequestHeaders(original, { remoteAddress: "127.0.0.1" });
  assert.deepEqual(original, snapshot);
});

test("stripHopByHop cleans a response without touching the rest", () => {
  const cleaned = stripHopByHop({
    "content-type": "text/event-stream",
    connection: "keep-alive",
    "transfer-encoding": "chunked",
    "set-cookie": ["a=1", "b=2"],
  });
  assert.equal(cleaned.connection, undefined);
  assert.equal(cleaned["transfer-encoding"], undefined);
  assert.equal(cleaned["content-type"], "text/event-stream");
  assert.deepEqual(cleaned["set-cookie"], ["a=1", "b=2"]);
});

test("isLoopbackHost knows the whole 127/8 block and nothing outside it", () => {
  for (const host of ["127.0.0.1", "127.1.2.3", "localhost", "LOCALHOST", "::1", "::ffff:127.0.0.1"]) {
    assert.equal(isLoopbackHost(host), true, host);
  }
  for (const host of ["0.0.0.0", "::", "192.168.0.1", "128.0.0.1", "example.test", ""]) {
    assert.equal(isLoopbackHost(host), false, host);
  }
});

// ---------------------------------------------------------------------------
// The certificate
// ---------------------------------------------------------------------------

test("findOpenssl reports null rather than throwing when nothing answers", () => {
  assert.equal(findOpenssl(["definitely-not-a-real-openssl-binary"]), null);
});

test("ensureCert refuses with an instruction rather than reaching for a dependency", () => {
  // The whole point of shelling out: a review harness must not add a certificate library to the
  // workspace. When openssl is missing the answer is the command to run, not an install.
  assert.throws(
    () => ensureCert("/nonexistent/review-tls", { openssl: null }),
    (error) => {
      assert.match(error.message, /openssl/);
      assert.match(error.message, /Git for Windows/);
      assert.match(error.message, /-addext/, "the message must carry the command to run by hand");
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// End to end, over an ephemeral port
// ---------------------------------------------------------------------------

/** Mounts the proxy's own request handler on a plain http listener and returns its port. */
async function startProxyTo(upstreamPort) {
  const { handleRequest } = createProxyHandler({ host: "127.0.0.1", port: upstreamPort });
  return await listen(http.createServer(handleRequest));
}

function get(port, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: "127.0.0.1", port, path, headers }, resolve);
    request.on("error", reject);
    request.end();
  });
}

function readAll(response) {
  return new Promise((resolve, reject) => {
    let body = "";
    response.setEncoding("utf8");
    response.on("data", (chunk) => {
      body += chunk;
    });
    response.on("end", () => resolve(body));
    response.on("error", reject);
  });
}

test("a streamed response reaches the client before the upstream ends", async () => {
  // The point of the test: if anything on the path buffered, `first` would not settle until the
  // upstream had ended, and the upstream only ends because `first` settled. A buffering proxy
  // deadlocks here and fails on the suite timeout rather than passing quietly.
  let releaseUpstream;
  const secondChunkAllowed = new Promise((resolve) => {
    releaseUpstream = resolve;
  });

  const upstreamPort = await listen(
    http.createServer(async (_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      res.write("data: one\n\n");
      await secondChunkAllowed;
      res.write("data: two\n\n");
      res.end();
    }),
  );

  const response = await get(await startProxyTo(upstreamPort), "/api/v1/jobs/stream");
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["content-type"], "text/event-stream");

  const first = await new Promise((resolve) => response.once("data", (chunk) => resolve(String(chunk))));
  assert.match(first, /data: one/);
  releaseUpstream();
  assert.match(await readAll(response), /data: two/);
});

test("the upstream sees https, an appended client address and the original Host", async () => {
  let seen = null;
  const upstreamPort = await listen(
    http.createServer((req, res) => {
      seen = req.headers;
      res.writeHead(204).end();
    }),
  );
  const proxyPort = await startProxyTo(upstreamPort);

  const response = await get(proxyPort, "/api/v1/workspaces", {
    host: "localhost:3443",
    "x-forwarded-for": "203.0.113.9",
    connection: "keep-alive, X-Hop-Only",
    "x-hop-only": "1",
  });
  assert.equal(response.statusCode, 204);
  await readAll(response);

  assert.equal(seen.host, "localhost:3443", "Host was rewritten; hosted mode would answer 403");
  assert.equal(seen["x-forwarded-proto"], "https");
  assert.match(seen["x-forwarded-for"], /^203\.0\.113\.9, /);
  // The client's hop-by-hop headers stop here. `seen.connection` is the proxy's OWN outgoing
  // connection header, written by node's http agent for the second hop — which is the point of
  // "hop-by-hop": each hop states its own, and none of them are relayed.
  assert.equal(seen["x-hop-only"], undefined, "a header the client's Connection nominated was relayed");
});

test("a request body is forwarded", async () => {
  let body = "";
  const upstreamPort = await listen(
    http.createServer((req, res) => {
      req.setEncoding("utf8");
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => res.writeHead(200).end("ok"));
    }),
  );
  const proxyPort = await startProxyTo(upstreamPort);

  const response = await new Promise((resolve, reject) => {
    const request = http.request(
      { host: "127.0.0.1", port: proxyPort, path: "/api/v1/settings", method: "POST" },
      resolve,
    );
    request.on("error", reject);
    request.end('{"locale":"id"}');
  });
  assert.equal(await readAll(response), "ok");
  assert.equal(body, '{"locale":"id"}');
});

test("a dead upstream answers 502 with a plain message, not a stack", async () => {
  const response = await get(await startProxyTo(await deadPort()), "/");
  assert.equal(response.statusCode, 502);
  assert.match(response.headers["content-type"] ?? "", /text\/plain/);
  const body = await readAll(response);
  assert.match(body, /upstream/i);
  assert.doesNotMatch(body, /at .*review-proxy/, "a stack trace leaked into the response");
});
