import { execFile } from "node:child_process";

/**
 * Who actually owns the loopback socket we are about to send credentials to.
 *
 * The supervisor picks a free port, releases it, and *then* spawns the sidecar (there is no way to
 * hand a listening socket to a foreign process). Between those two moments any local process can
 * take the port, and answering `{"status":"ok"}` on `/health` is a two-line HTTP server. Without
 * this check the first credential-bearing call — auto-setup, the API key exchange, the model row
 * that carries the gateway key — would go to whoever won that race.
 *
 * Defence in depth, not a guarantee: the traffic is loopback-only and already carries our own key,
 * and the tool this needs (`netstat` / `lsof`) can be absent or restricted. A tool that cannot
 * answer is logged and the boot proceeds, because refusing to start on a missing `lsof` would turn
 * a hardened check into an availability bug.
 */

/** The probe is a process spawn on the boot path; a slow answer is treated as no answer. */
export const PORT_OWNER_TIMEOUT_MS = 3_000;

export type PortOwnerVerdict = "ok" | "mismatch" | "unknown";

/**
 * The pid listening on `port`, from `netstat -ano` output (and from the `Get-NetTCPConnection`
 * table, which is the same information in a different column order).
 *
 * Rows are matched on a whole token — a local address ending in `:<port>`, or a bare `<port>`
 * column — so port 4987 never matches a row for 49871, and only rows in a listening state count:
 * an established connection *to* the port is not its owner.
 */
export function parseNetstatListeningPid(text: string, port: number): number | null {
  const needle = String(port);
  for (const line of text.split(/\r?\n/)) {
    const tokens = line.trim().split(/\s+/).filter(Boolean);
    if (tokens.length < 3 || !tokens.some((token) => /^listen(ing)?$/i.test(token))) {
      continue;
    }
    const pid = Number.parseInt(tokens[tokens.length - 1] ?? "", 10);
    if (!Number.isInteger(pid) || pid <= 0) {
      continue;
    }
    const addressed = tokens
      .slice(0, -1)
      .some((token) => token === needle || token.endsWith(`:${needle}`));
    if (addressed) {
      return pid;
    }
  }
  return null;
}

/** `lsof -t` prints one pid per line and nothing else. The first is the listener. */
export function parseLsofPid(text: string): number | null {
  for (const line of text.split(/\r?\n/)) {
    const pid = Number.parseInt(line.trim(), 10);
    if (Number.isInteger(pid) && pid > 0 && /^\d+$/.test(line.trim())) {
      return pid;
    }
  }
  return null;
}

type Runner = (file: string, args: string[]) => Promise<string>;

/** `execFile`, never a shell: nothing here interpolates into a command line. */
function run(file: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { encoding: "utf8", timeout: PORT_OWNER_TIMEOUT_MS, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout) => {
        if (error && !stdout) {
          reject(error);
          return;
        }
        resolve(stdout ?? "");
      },
    );
  });
}

/** The pid listening on `port`, or null when the platform's tool could not tell us. */
export async function listeningPid(
  port: number,
  options: { platform?: NodeJS.Platform; runner?: Runner } = {},
): Promise<number | null> {
  const platform = options.platform ?? process.platform;
  const runner = options.runner ?? run;
  try {
    if (platform === "win32") {
      return parseNetstatListeningPid(await runner("netstat", ["-ano", "-p", "TCP"]), port);
    }
    return parseLsofPid(await runner("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"]));
  } catch {
    return null;
  }
}

/**
 * Is `pid` the process listening on `port`? `unknown` when the tool is missing or said nothing,
 * which the caller treats as "log it and carry on".
 */
export async function verifyPortOwner(
  port: number,
  pid: number,
  options: { platform?: NodeJS.Platform; runner?: Runner } = {},
): Promise<{ verdict: PortOwnerVerdict; owner: number | null }> {
  const owner = await listeningPid(port, options);
  if (owner === null) {
    return { verdict: "unknown", owner: null };
  }
  return { verdict: owner === pid ? "ok" : "mismatch", owner };
}
