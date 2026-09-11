import { describe, expect, it } from "vitest";
import { parseLsofPid, parseNetstatListeningPid } from "./port-owner";

/**
 * The parsers are pure and tested on captured tool output, because the runner around them cannot be
 * asserted on a machine where the tool is missing — and "the tool is missing" is a case this check
 * deliberately tolerates.
 */

// `netstat -ano` on Windows 11, trimmed to the rows that matter. Note the IPv6 row for the same
// port number on a different address family, and a second port whose pid must never be returned.
const NETSTAT = [
  "",
  "Active Connections",
  "",
  "  Proto  Local Address          Foreign Address        State           PID",
  "  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1240",
  "  TCP    127.0.0.1:49871        0.0.0.0:0              LISTENING       23188",
  "  TCP    127.0.0.1:49872        0.0.0.0:0              LISTENING       999",
  "  TCP    127.0.0.1:49871        127.0.0.1:49999        ESTABLISHED     4242",
  "  TCP    [::1]:49871            [::]:0                 LISTENING       23188",
  "",
].join("\r\n");

// `Get-NetTCPConnection -LocalPort <p> -State Listen | Format-Table` fallback shape.
const GET_NET_TCP = [
  "LocalAddress  LocalPort RemoteAddress RemotePort State       OwningProcess",
  "------------  --------- ------------- ---------- -----       -------------",
  "127.0.0.1         49871 0.0.0.0                0 Listen              23188",
].join("\r\n");

describe("parseNetstatListeningPid", () => {
  it("finds the pid listening on the port", () => {
    expect(parseNetstatListeningPid(NETSTAT, 49871)).toBe(23188);
  });

  it("does not confuse a neighbouring port", () => {
    expect(parseNetstatListeningPid(NETSTAT, 49872)).toBe(999);
  });

  it("ignores non-listening rows, so an established connection is never the owner", () => {
    expect(parseNetstatListeningPid(NETSTAT, 49999)).toBeNull();
  });

  it("does not match a port that is only a prefix of another", () => {
    expect(parseNetstatListeningPid(NETSTAT, 4987)).toBeNull();
  });

  it("returns null for output it does not understand", () => {
    expect(parseNetstatListeningPid("", 49871)).toBeNull();
    expect(parseNetstatListeningPid("something went wrong", 49871)).toBeNull();
  });

  it("reads the Get-NetTCPConnection table shape too", () => {
    expect(parseNetstatListeningPid(GET_NET_TCP, 49871)).toBe(23188);
  });
});

describe("parseLsofPid", () => {
  it("reads the single pid `-t` prints", () => {
    expect(parseLsofPid("23188\n")).toBe(23188);
  });

  it("takes the first pid when a process group answers", () => {
    expect(parseLsofPid("23188\n23189\n")).toBe(23188);
  });

  it("returns null for empty or unparseable output", () => {
    expect(parseLsofPid("")).toBeNull();
    expect(parseLsofPid("\n \n")).toBeNull();
    expect(parseLsofPid("lsof: command not found")).toBeNull();
  });
});
