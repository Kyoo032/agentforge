#!/usr/bin/env node
/**
 * HARNESS, NEVER SHIPS. A loopback TLS front door so hosted mode can be reviewed on this desk.
 *
 * Usage (repo root):
 *   node scripts/review-proxy.mjs --listen 3443 --upstream 127.0.0.1:3100 [--cert-dir <dir>]
 *
 * WHY THIS EXISTS. Hosted mode cannot be driven over plain http. `rejectPlaintext`
 * (packages/host/src/http-adapter.ts) answers 403 https_required to any request that does not carry
 * `X-Forwarded-Proto: https`, and `trustedOrigins` (packages/core/src/server-mode.ts) drops every
 * `http://` entry from the allowlist in server mode — both on purpose, and neither is worth a
 * "just for local" branch in product code. So the local review instance gets what the real
 * deployment has: something in front that terminates TLS and stamps the header. This is that
 * something, in ~200 lines, for one reviewer on 127.0.0.1. It is not a deployment artefact, it is
 * not in any image, and webapp-deploy/Caddyfile remains the only proxy the product ships behind.
 *
 * THE THREE RULES IT COPIES FROM THAT CADDYFILE, because breaking any of them makes the app 403
 * in a way that looks like a product bug:
 *   1. `Host` passes through UNCHANGED. With AGENTFORGE_SERVER=1 the app checks Host against
 *      AGENTFORGE_TRUSTED_ORIGINS (isAllowedWebHostHeader, packages/host/src/local-request.ts), so
 *      rewriting it to the upstream's 127.0.0.1:3100 makes every POST answer 403 origin_forbidden.
 *      Origin is not rewritten either — that is the CSRF hole the check exists to close.
 *   2. `X-Forwarded-Proto: https` on everything, overwriting whatever the caller sent.
 *   3. `X-Forwarded-For` APPENDED, so the peer address is the last hop — which is the one
 *      packages/host/src/rate-limit.ts keys its per-IP bucket on.
 * And one more from `flush_interval -1`: nothing is buffered, or every job.step would arrive at
 * once when the run ended.
 *
 * NO NEW DEPENDENCY. The self-signed certificate is made by shelling out to `openssl`, which is on
 * PATH on this desk because Git for Windows ships one; if it is not, this refuses with the command
 * to run rather than pulling a certificate library into the workspace for a review harness.
 */

import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** Where the generated key pair lives by default. Never inside a checkout. */
const DEFAULT_CERT_DIR = path.join(os.homedir(), ".dpsbuddy-review", "tls");
const KEY_FILE = "review-key.pem";
const CERT_FILE = "review-cert.pem";

/** RFC 9110 §7.6.1. Meaningful to one hop only, so none of them may be forwarded. */
const HOP_BY_HOP = Object.freeze([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const PROTO_HEADER = "x-forwarded-proto";
const FOR_HEADER = "x-forwarded-for";

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

/** `127.0.0.1`, anything in 127/8, `localhost`, `::1`, and the v4-mapped form of any of them. */
export function isLoopbackHost(host) {
  const value = String(host ?? "")
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  if (!value) {
    return false;
  }
  if (value === "localhost" || value === "::1" || value === "0:0:0:0:0:0:0:1") {
    return true;
  }
  const bare = value.startsWith("::ffff:") ? value.slice("::ffff:".length) : value;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(bare);
}

function parsePort(raw, flag) {
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return fail(`${flag} needs a port between 1 and 65535, not ${JSON.stringify(raw)}.`);
  }
  return port;
}

function fail(message) {
  throw new Error(message);
}

/** `<port>` (loopback implied) or `<host>:<port>` / `[<v6>]:<port>`. */
function parseAddress(raw, flag, { portOnly }) {
  const value = String(raw ?? "").trim();
  if (!value) {
    return fail(`${flag} needs a value.`);
  }
  if (/^\d+$/.test(value)) {
    if (!portOnly) {
      return fail(`${flag} needs host:port, not a bare port.`);
    }
    return { host: "127.0.0.1", port: parsePort(value, flag) };
  }
  const bracketed = value.match(/^\[(.+)\]:(\d+)$/);
  if (bracketed) {
    return { host: bracketed[1], port: parsePort(bracketed[2], flag) };
  }
  const index = value.lastIndexOf(":");
  if (index <= 0 || index === value.length - 1) {
    return fail(`${flag} needs host:port, got ${JSON.stringify(value)}.`);
  }
  return { host: value.slice(0, index), port: parsePort(value.slice(index + 1), flag) };
}

/**
 * Validated, immutable arguments. Exported so the tests can drive every refusal without a process.
 *
 * Both addresses are checked against loopback here and nowhere else: this harness stamps
 * `X-Forwarded-Proto: https` on every request it forwards, which is the app's proof that a request
 * arrived over TLS. Bound to anything reachable, it would hand that proof to the network. Pointed at
 * a remote upstream, it would make the same claim about a hop that is plain http on the wire, with
 * the reviewer's session cookie in it (security register SR-11).
 */
export function parseArgs(argv) {
  let listen = null;
  let upstream = null;
  let certDir = DEFAULT_CERT_DIR;

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        return fail(`${flag} needs a value.`);
      }
      i += 1;
      return value;
    };
    if (flag === "--listen") {
      listen = parseAddress(next(), "--listen", { portOnly: true });
    } else if (flag === "--upstream") {
      upstream = parseAddress(next(), "--upstream", { portOnly: false });
    } else if (flag === "--cert-dir") {
      certDir = next();
    } else {
      return fail(
        `unknown flag ${JSON.stringify(flag)}. Usage: --listen <port> --upstream <host:port> [--cert-dir <dir>]`,
      );
    }
  }

  if (!listen) {
    return fail("--listen is required, e.g. --listen 3443.");
  }
  if (!upstream) {
    return fail("--upstream is required, e.g. --upstream 127.0.0.1:3100.");
  }
  if (!isLoopbackHost(listen.host)) {
    return fail(
      `--listen must be a loopback address (127.0.0.1, localhost, ::1), not ${JSON.stringify(listen.host)}. ` +
        "This harness tells the app every request arrived over TLS; off loopback that is a claim it cannot make.",
    );
  }
  if (!isLoopbackHost(upstream.host)) {
    return fail(
      `--upstream must be a loopback address (127.0.0.1, localhost, ::1), not ${JSON.stringify(upstream.host)}. ` +
        "The hop to the upstream is plain http, and this harness stamps X-Forwarded-Proto: https on it; " +
        "off loopback that hop would cross the network in the clear.",
    );
  }
  return Object.freeze({ listen: Object.freeze(listen), upstream: Object.freeze(upstream), certDir });
}

// ---------------------------------------------------------------------------
// Headers
// ---------------------------------------------------------------------------

/** Hop-by-hop names plus whatever this message's own `Connection` header nominates. */
function hopByHopNames(headers, keepUpgrade) {
  const names = new Set(HOP_BY_HOP);
  for (const token of String(headers.connection ?? "").split(",")) {
    const name = token.trim().toLowerCase();
    if (name) {
      names.add(name);
    }
  }
  if (keepUpgrade) {
    names.delete("connection");
    names.delete("upgrade");
  }
  return names;
}

function withoutNames(headers, names) {
  const kept = {};
  for (const [name, value] of Object.entries(headers)) {
    if (!names.has(name.toLowerCase())) {
      kept[name] = value;
    }
  }
  return kept;
}

/**
 * The request headers to send upstream: a NEW object, never an edit of the incoming one.
 *
 * `upgrade: true` keeps `Connection` and `Upgrade`, which a WebSocket handshake is made of — Vite's
 * HMR socket is the reason this harness handles upgrades at all.
 */
export function forwardRequestHeaders(headers, { remoteAddress, upgrade = false } = {}) {
  const kept = withoutNames(headers, hopByHopNames(headers, upgrade));
  const existing = headers[FOR_HEADER];
  const chain = [existing, remoteAddress].filter((part) => typeof part === "string" && part.trim() !== "");
  return {
    ...kept,
    // Host is deliberately NOT touched: see the header of this file, rule 1.
    [PROTO_HEADER]: "https",
    ...(chain.length > 0 ? { [FOR_HEADER]: chain.join(", ") } : {}),
  };
}

/** The response headers to send back: hop-by-hop dropped, everything else verbatim. */
export function stripHopByHop(headers) {
  return withoutNames(headers, hopByHopNames(headers, false));
}

// ---------------------------------------------------------------------------
// Proxying
// ---------------------------------------------------------------------------

const BAD_GATEWAY_BODY = "502 Bad Gateway: the review upstream is not answering. Start the app in server mode first.\n";

/**
 * The request and upgrade handlers, over plain http to the upstream.
 *
 * Split out from the TLS listener so the tests can mount the identical handler on an ephemeral
 * plain-http port: the behaviour worth pinning is all here, and none of it changes because TLS
 * wraps the front.
 */
export function createProxyHandler({ host, port }) {
  function handleRequest(req, res) {
    req.socket.setNoDelay(true);
    res.socket?.setNoDelay(true);
    const upstream = http.request(
      {
        host,
        port,
        method: req.method,
        path: req.url,
        headers: forwardRequestHeaders(req.headers, { remoteAddress: req.socket.remoteAddress }),
      },
      (upstreamRes) => {
        upstreamRes.socket?.setNoDelay(true);
        res.writeHead(upstreamRes.statusCode ?? 502, stripHopByHop(upstreamRes.headers));
        // Chunk-for-chunk, so an SSE frame leaves as soon as it arrives (Caddy's flush_interval -1).
        res.flushHeaders();
        upstreamRes.pipe(res);
      },
    );
    upstream.on("error", (error) => {
      // A plain sentence, never the error object: this answers a browser, and the reviewer reads
      // the real reason on the terminal.
      process.stderr.write(`review-proxy: upstream ${host}:${port} failed: ${error.code ?? error.message}\n`);
      if (res.headersSent) {
        res.destroy();
        return;
      }
      res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
      res.end(BAD_GATEWAY_BODY);
    });
    res.on("close", () => upstream.destroy());
    req.pipe(upstream);
  }

  /** WebSocket (and any other) upgrade: hand the two sockets to each other and get out of the way. */
  function handleUpgrade(req, clientSocket, head) {
    clientSocket.setNoDelay(true);
    const upstream = http.request({
      host,
      port,
      method: req.method,
      path: req.url,
      headers: forwardRequestHeaders(req.headers, { remoteAddress: req.socket.remoteAddress, upgrade: true }),
    });
    upstream.on("upgrade", (upstreamRes, upstreamSocket, upstreamHead) => {
      upstreamSocket.setNoDelay(true);
      const statusLine = `HTTP/1.1 ${upstreamRes.statusCode} ${upstreamRes.statusMessage}\r\n`;
      const lines = [];
      for (let i = 0; i < upstreamRes.rawHeaders.length; i += 2) {
        lines.push(`${upstreamRes.rawHeaders[i]}: ${upstreamRes.rawHeaders[i + 1]}\r\n`);
      }
      clientSocket.write(`${statusLine}${lines.join("")}\r\n`);
      if (upstreamHead?.length) {
        upstreamSocket.unshift(upstreamHead);
      }
      if (head?.length) {
        clientSocket.unshift(head);
      }
      upstreamSocket.pipe(clientSocket);
      clientSocket.pipe(upstreamSocket);
      const close = () => {
        upstreamSocket.destroy();
        clientSocket.destroy();
      };
      upstreamSocket.on("error", close);
      clientSocket.on("error", close);
    });
    // The upstream answered the handshake normally, i.e. it refused the upgrade. Relay the refusal.
    upstream.on("response", (upstreamRes) => {
      clientSocket.write(`HTTP/1.1 ${upstreamRes.statusCode} ${upstreamRes.statusMessage}\r\n\r\n`);
      upstreamRes.pipe(clientSocket);
    });
    upstream.on("error", (error) => {
      process.stderr.write(`review-proxy: upgrade to ${host}:${port} failed: ${error.code ?? error.message}\n`);
      clientSocket.destroy();
    });
    upstream.end();
  }

  return { handleRequest, handleUpgrade };
}

// ---------------------------------------------------------------------------
// The certificate
// ---------------------------------------------------------------------------

const OPENSSL_CANDIDATES = Object.freeze([
  "openssl",
  "C:\\Program Files\\Git\\usr\\bin\\openssl.exe",
  "C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe",
]);

const NO_OPENSSL =
  "review-proxy needs `openssl` to make its self-signed certificate and cannot find one.\n" +
  "  Windows: it ships with Git for Windows at C:\\Program Files\\Git\\usr\\bin\\openssl.exe — add that\n" +
  "           directory to PATH, or generate the pair by hand into the --cert-dir:\n" +
  '             openssl req -x509 -newkey rsa:2048 -sha256 -nodes -days 825 -subj "/CN=localhost" \\\n' +
  '               -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" \\\n' +
  `               -keyout <cert-dir>/${KEY_FILE} -out <cert-dir>/${CERT_FILE}\n` +
  "  Linux/mac: install the openssl package.\n" +
  "No certificate library is added to this workspace for a review harness.";

/** The first candidate that answers `openssl version`, or null. */
export function findOpenssl(candidates = OPENSSL_CANDIDATES) {
  for (const candidate of candidates) {
    try {
      execFileSync(candidate, ["version"], { stdio: "ignore" });
      return candidate;
    } catch {
      // Try the next one; the caller reports when none answers.
    }
  }
  return null;
}

/**
 * The key pair for `localhost` + `127.0.0.1`, made once into `certDir` and reused after that.
 *
 * Self-signed, so the browser shows a warning the reviewer clicks through once. That is open
 * decision 3 in the phase plan (this, or a local Caddy `tls internal`); nothing here stops the
 * other answer later, because the app never learns which one is in front.
 */
export function ensureCert(certDir, { openssl = findOpenssl() } = {}) {
  const keyPath = path.join(certDir, KEY_FILE);
  const certPath = path.join(certDir, CERT_FILE);
  if (!existsSync(keyPath) || !existsSync(certPath)) {
    if (!openssl) {
      throw new Error(NO_OPENSSL);
    }
    mkdirSync(certDir, { recursive: true });
    execFileSync(
      openssl,
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-sha256",
        "-nodes",
        // 825 days is the cap browsers accept for a server certificate.
        "-days",
        "825",
        "-subj",
        "/CN=localhost",
        "-addext",
        "subjectAltName=DNS:localhost,IP:127.0.0.1",
        "-keyout",
        keyPath,
        "-out",
        certPath,
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    try {
      chmodSync(keyPath, 0o600);
    } catch {
      // Windows ACLs do not map onto a mode; the file is under the user profile either way.
    }
    process.stdout.write(`review-proxy: generated a self-signed certificate in ${certDir}\n`);
  }
  return { key: readFileSync(keyPath), cert: readFileSync(certPath) };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const { key, cert } = ensureCert(args.certDir);
  const { handleRequest, handleUpgrade } = createProxyHandler(args.upstream);
  const server = https.createServer({ key, cert }, handleRequest);
  server.on("upgrade", handleUpgrade);
  server.on("clientError", (_error, socket) => socket.destroy());
  server.listen(args.listen.port, args.listen.host, () => {
    process.stdout.write(
      `review-proxy: https://localhost:${args.listen.port} -> http://${args.upstream.host}:${args.upstream.port}\n` +
        "review-proxy: self-signed; accept the browser warning once. Harness only — never ship this.\n",
    );
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
