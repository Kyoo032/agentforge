import { describe, expect, it } from "vitest";
import { isPrivateHostname, isPrivateIpAddress, isPrivateIpLiteral, parseIpAddress } from "./ip-range";

describe("parseIpAddress", () => {
  it("reads dotted-quad IPv4", () => {
    expect(parseIpAddress("127.0.0.1")).toEqual({ family: 4, bytes: new Uint8Array([127, 0, 0, 1]) });
    expect(parseIpAddress("255.255.255.255")).toEqual({ family: 4, bytes: new Uint8Array([255, 255, 255, 255]) });
  });

  it("refuses IPv4 that is not the canonical spelling", () => {
    // `new URL` normalises 2130706433, 0177.0.0.1, 0x7f.1 and 127.1 to 127.0.0.1 long before this
    // module sees a hostname, so accepting those spellings here would only add ways to be wrong.
    for (const text of ["2130706433", "0177.0.0.1", "127.1", "1.2.3", "1.2.3.4.5", "256.0.0.1", "1.2.3.-1", ""]) {
      expect(parseIpAddress(text), text).toBeNull();
    }
  });

  it("reads IPv6, with or without brackets, compressed or not", () => {
    expect(parseIpAddress("[::1]")?.bytes.at(-1)).toBe(1);
    expect(parseIpAddress("::1")?.family).toBe(6);
    expect(parseIpAddress("2606:4700:0000:0000:0000:0000:0000:1111")?.family).toBe(6);
    expect(parseIpAddress("2606:4700::1111")).toEqual(parseIpAddress("2606:4700:0:0:0:0:0:1111"));
    expect(parseIpAddress("::")?.bytes).toEqual(new Uint8Array(16));
    expect(parseIpAddress("fe80::1%eth0")?.family).toBe(6);
  });

  it("reads the dotted-quad tail of an IPv4-mapped address", () => {
    expect(parseIpAddress("::ffff:127.0.0.1")).toEqual(parseIpAddress("::ffff:7f00:1"));
    expect(parseIpAddress("::ffff:169.254.169.254")).toEqual(parseIpAddress("::ffff:a9fe:a9fe"));
  });

  it("refuses malformed IPv6", () => {
    for (const text of ["1::2::3", "12345::1", "::g", "1:2:3:4:5:6:7", "1:2:3:4:5:6:7:8:9", ":::"]) {
      expect(parseIpAddress(text), text).toBeNull();
    }
  });

  it("answers null for a DNS name, which is not this module's business", () => {
    expect(parseIpAddress("example.com")).toBeNull();
    expect(parseIpAddress("fdic.gov")).toBeNull();
  });
});

describe("isPrivateIpAddress", () => {
  it("judges an IPv6 address that carries an IPv4 address as that IPv4 address", () => {
    for (const text of [
      "::ffff:127.0.0.1",
      "::ffff:10.0.0.1",
      "::ffff:169.254.169.254",
      "::127.0.0.1",
      "64:ff9b::127.0.0.1",
      "64:ff9b:1::10.0.0.1",
      "2002:7f00:1::", // 6to4, which carries the v4 address in bytes 2-5
    ]) {
      expect(isPrivateIpLiteral(text), text).toBe(true);
    }
    // The same wrappers around a public address stay public.
    expect(isPrivateIpLiteral("::ffff:93.184.216.34")).toBe(false);
    expect(isPrivateIpLiteral("2002:5db8:d822::")).toBe(false);
  });

  it("walks the edges of every IPv4 block", () => {
    const cases: ReadonlyArray<readonly [string, boolean]> = [
      ["9.255.255.255", false],
      ["10.0.0.0", true],
      ["10.255.255.255", true],
      ["11.0.0.0", false],
      ["100.63.255.255", false],
      ["100.64.0.0", true],
      ["100.127.255.255", true],
      ["100.128.0.0", false],
      ["169.253.255.255", false],
      ["169.254.0.0", true],
      ["169.255.0.0", false],
      ["172.15.255.255", false],
      ["172.16.0.0", true],
      ["172.31.255.255", true],
      ["172.32.0.0", false],
      ["198.17.255.255", false],
      ["198.18.0.0", true],
      ["198.19.255.255", true],
      ["198.20.0.0", false],
      ["223.255.255.255", false],
      ["224.0.0.0", true],
      ["239.255.255.255", true],
      ["240.0.0.0", true],
    ];
    for (const [address, expected] of cases) {
      expect(isPrivateIpLiteral(address), address).toBe(expected);
    }
  });

  it("covers the whole of fe80::/10 rather than one spelling of it", () => {
    for (const text of ["fe80::1", "fe90::1", "fe9c::1", "febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff"]) {
      expect(isPrivateIpLiteral(text), text).toBe(true);
    }
    expect(isPrivateIpLiteral("fec0::1")).toBe(true);
    expect(isPrivateIpLiteral("ff00::1")).toBe(true);
    // fe00::/9 below the link-local block, and the global unicast range, stay public.
    expect(isPrivateIpLiteral("fe00::1")).toBe(false);
    expect(isPrivateIpLiteral("2606:4700::1111")).toBe(false);
  });

  it("covers fc00::/7 as a range, both halves of it", () => {
    expect(isPrivateIpLiteral("fc00::1")).toBe(true);
    expect(isPrivateIpLiteral("fd00::1")).toBe(true);
    expect(isPrivateIpLiteral("fdff:ffff::1")).toBe(true);
    expect(isPrivateIpLiteral("fb00::1")).toBe(false);
  });

  it("takes an already-parsed address too", () => {
    const parsed = parseIpAddress("10.0.0.1");
    expect(parsed).not.toBeNull();
    expect(parsed && isPrivateIpAddress(parsed)).toBe(true);
  });

  it("answers false for a name, so the caller knows to resolve it", () => {
    expect(isPrivateIpLiteral("localtest.me")).toBe(false);
  });
});

describe("isPrivateHostname", () => {
  it("matches whole labels, never a text prefix", () => {
    for (const host of [
      "localhost",
      "app.localhost",
      "printer.local",
      "box.localdomain",
      "db.internal",
      "wiki.intranet",
      "router.home.arpa",
      "1.0.0.127.in-addr.arpa",
      "1.0.0.0.ip6.arpa",
      "LOCALHOST",
      "localhost.",
      "",
    ]) {
      expect(isPrivateHostname(host), host).toBe(true);
    }
  });

  it("does not refuse a public name for how it happens to start or end", () => {
    // These are the false positives the old `startsWith("fc")` / `startsWith("fd")` rule produced.
    for (const host of [
      "fdic.gov",
      "fc-barcelona.example",
      "example.com",
      "notlocalhost.com",
      "mylocal.example",
      "internal-affairs.example",
    ]) {
      expect(isPrivateHostname(host), host).toBe(false);
    }
  });
});
