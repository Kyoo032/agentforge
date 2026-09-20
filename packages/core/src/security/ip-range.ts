/**
 * Is this IP address one the server is allowed to talk to? (docs/internal/security-owasp-2026-09.md,
 * findings A10-1 and A10-2.)
 *
 * This replaces a list of string prefixes that `safe-fetch.ts` used to test the hostname with. That
 * shape was wrong twice over. It matched on text rather than on an address, so `[::ffff:127.0.0.1]`
 * — which every OS connects to 127.0.0.1 — read as a public host, and so did
 * `[::ffff:169.254.169.254]`, the cloud metadata service. And it matched by prefix, so the public
 * domain `fdic.gov` was refused for starting with `fd` while `100.64.1.1` (carrier NAT, which is
 * where a cloud provider's internal load balancers live) was allowed.
 *
 * So: parse the literal into bytes, then compare bytes against real CIDR blocks. Anything that is
 * not an IP literal is not this module's business — `safe-fetch.ts` resolves the name first and
 * brings the addresses here.
 */

/** `{ bytes }` for a literal this module understands, or null when the text is not one. */
export type IpAddress = { readonly family: 4 | 6; readonly bytes: Uint8Array };

/**
 * IPv4 blocks that are never a public internet host, as [first byte..., prefix length].
 *
 * Beyond the classic RFC 1918 three, this carries the blocks the old prefix list missed and that
 * matter most on a cloud VM: 100.64.0.0/10 (RFC 6598 carrier NAT — Tencent and every other provider
 * put internal endpoints there), 169.254.0.0/16 (link-local, i.e. the metadata service), the IETF
 * protocol and documentation blocks, 198.18.0.0/15 (benchmarking), multicast and the reserved
 * 240.0.0.0/4 that ends in 255.255.255.255.
 */
const PRIVATE_IPV4_CIDRS: ReadonlyArray<readonly [string, number]> = [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // RFC 1918
  ["100.64.0.0", 10], // RFC 6598 carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, incl. the 169.254.169.254 metadata service
  ["172.16.0.0", 12], // RFC 1918
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // TEST-NET-1
  ["192.88.99.0", 24], // former 6to4 relay anycast
  ["192.168.0.0", 16], // RFC 1918
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // TEST-NET-2
  ["203.0.113.0", 24], // TEST-NET-3
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, incl. 255.255.255.255 broadcast
];

/**
 * IPv6 blocks, as [first address, prefix length]. The v4-bearing blocks are NOT here: an address
 * that embeds an IPv4 address is unwrapped and judged as that IPv4 address instead, which is the
 * only way `::ffff:169.254.169.254` gets the answer its behaviour deserves.
 */
const PRIVATE_IPV6_CIDRS: ReadonlyArray<readonly [string, number]> = [
  ["::", 128], // unspecified
  ["::1", 128], // loopback
  ["100::", 64], // discard-only
  ["2001:db8::", 32], // documentation
  ["fc00::", 7], // unique local (fc00 and fd00 alike)
  ["fe80::", 10], // link-local — the whole fe80::/10 range, not just the literal "fe80:"
  ["fec0::", 10], // deprecated site-local
  ["ff00::", 8], // multicast
];

/** Blocks whose low 32 bits ARE an IPv4 address, so the verdict is that address's verdict. */
const V4_BEARING_IPV6_CIDRS: ReadonlyArray<readonly [string, number]> = [
  ["::", 96], // IPv4-compatible (deprecated, still routed by some stacks)
  ["::ffff:0:0", 96], // IPv4-mapped — what `[::ffff:127.0.0.1]` parses to
  ["64:ff9b::", 96], // NAT64 well-known prefix
  ["64:ff9b:1::", 48], // NAT64 local-use prefix
];

/** 2002::/16 carries the IPv4 address in bytes 2-5 rather than the last four. */
const SIX_TO_FOUR_PREFIX = "2002::";
const SIX_TO_FOUR_BITS = 16;

function parseIpv4(text: string): Uint8Array | null {
  const parts = text.split(".");
  if (parts.length !== 4) {
    return null;
  }
  const bytes = new Uint8Array(4);
  for (let i = 0; i < 4; i += 1) {
    const part = parts[i];
    // Only the canonical dotted-quad spelling: `new URL` has already normalised every other form
    // (decimal, octal, hex, short) before this module sees a hostname.
    if (!/^\d{1,3}$/.test(part)) {
      return null;
    }
    const value = Number(part);
    if (value > 255) {
      return null;
    }
    bytes[i] = value;
  }
  return bytes;
}

function parseIpv6(text: string): Uint8Array | null {
  let head = text;
  let tail = "";
  const doubleColon = text.indexOf("::");
  if (doubleColon !== -1) {
    if (text.indexOf("::", doubleColon + 1) !== -1) {
      return null;
    }
    head = text.slice(0, doubleColon);
    tail = text.slice(doubleColon + 2);
  }
  const headGroups = head === "" ? [] : head.split(":");
  const tailGroups = tail === "" ? [] : tail.split(":");
  const groups: string[] = [...headGroups, ...tailGroups];

  // A trailing dotted quad ("::ffff:127.0.0.1") stands for the last two groups.
  const embedded: number[] = [];
  const last = groups[groups.length - 1];
  if (last?.includes(".")) {
    const v4 = parseIpv4(last);
    if (!v4) {
      return null;
    }
    groups.pop();
    if (tailGroups.length > 0) {
      tailGroups.pop();
    } else {
      headGroups.pop();
    }
    embedded.push((v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]);
  }

  const written = groups.length + embedded.length;
  if (written > 8 || (doubleColon === -1 && written !== 8)) {
    return null;
  }
  const values: number[] = [];
  for (const group of headGroups) {
    const value = parseGroup(group);
    if (value === null) {
      return null;
    }
    values.push(value);
  }
  const rest: number[] = [];
  for (const group of tailGroups) {
    const value = parseGroup(group);
    if (value === null) {
      return null;
    }
    rest.push(value);
  }
  const trailing = [...rest, ...embedded];
  const zeros = 8 - values.length - trailing.length;
  if (zeros < 0) {
    return null;
  }
  const all = [...values, ...new Array<number>(zeros).fill(0), ...trailing];
  const bytes = new Uint8Array(16);
  all.forEach((value, index) => {
    bytes[index * 2] = value >> 8;
    bytes[index * 2 + 1] = value & 0xff;
  });
  return bytes;
}

function parseGroup(group: string): number | null {
  if (!/^[0-9a-f]{1,4}$/i.test(group)) {
    return null;
  }
  return Number.parseInt(group, 16);
}

/**
 * The address a hostname literal denotes, or null when it is a DNS name rather than a literal.
 * Surrounding brackets are accepted because that is how `URL.hostname` spells an IPv6 literal.
 */
export function parseIpAddress(host: string): IpAddress | null {
  const text = host.trim().replace(/^\[|\]$/g, "").toLowerCase();
  if (text === "") {
    return null;
  }
  if (text.includes(":")) {
    const bytes = parseIpv6(text.split("%")[0]);
    return bytes ? { family: 6, bytes } : null;
  }
  const bytes = parseIpv4(text);
  return bytes ? { family: 4, bytes } : null;
}

function inBlock(bytes: Uint8Array, block: Uint8Array, prefixBits: number): boolean {
  const wholeBytes = prefixBits >> 3;
  for (let i = 0; i < wholeBytes; i += 1) {
    if (bytes[i] !== block[i]) {
      return false;
    }
  }
  const remainder = prefixBits & 7;
  if (remainder === 0) {
    return true;
  }
  const mask = 0xff << (8 - remainder);
  return (bytes[wholeBytes] & mask) === (block[wholeBytes] & mask);
}

function blocksOf(cidrs: ReadonlyArray<readonly [string, number]>): ReadonlyArray<readonly [Uint8Array, number]> {
  return cidrs.map(([address, bits]) => {
    const parsed = parseIpAddress(address);
    /* c8 ignore next 3 -- the tables above are literals; this can only fire on a typo, and the
       test suite asserts every row parses. */
    if (!parsed) {
      throw new Error(`ip-range: ${address} is not an address`);
    }
    return [parsed.bytes, bits] as const;
  });
}

const PRIVATE_IPV4_BLOCKS = blocksOf(PRIVATE_IPV4_CIDRS);
const PRIVATE_IPV6_BLOCKS = blocksOf(PRIVATE_IPV6_CIDRS);
const V4_BEARING_BLOCKS = blocksOf(V4_BEARING_IPV6_CIDRS);
const SIX_TO_FOUR_BLOCK = blocksOf([[SIX_TO_FOUR_PREFIX, SIX_TO_FOUR_BITS]])[0];

/**
 * True when this address must never be fetched from the server.
 *
 * An IPv6 address that carries an IPv4 address is judged as that IPv4 address, recursively, because
 * that is what the network stack will do with it.
 */
export function isPrivateIpAddress(address: IpAddress): boolean {
  if (address.family === 4) {
    return PRIVATE_IPV4_BLOCKS.some(([block, bits]) => inBlock(address.bytes, block, bits));
  }
  const embedded = embeddedIpv4(address.bytes);
  if (embedded) {
    return isPrivateIpAddress({ family: 4, bytes: embedded });
  }
  return PRIVATE_IPV6_BLOCKS.some(([block, bits]) => inBlock(address.bytes, block, bits));
}

/** The IPv4 address an IPv6 address carries, when it is one of the v4-bearing shapes. */
function embeddedIpv4(bytes: Uint8Array): Uint8Array | null {
  if (inBlock(bytes, SIX_TO_FOUR_BLOCK[0], SIX_TO_FOUR_BLOCK[1])) {
    return bytes.slice(2, 6);
  }
  if (V4_BEARING_BLOCKS.some(([block, bits]) => inBlock(bytes, block, bits))) {
    return bytes.slice(12, 16);
  }
  return null;
}

/** Convenience for a string that may or may not be a literal; a DNS name answers `false`. */
export function isPrivateIpLiteral(host: string): boolean {
  const address = parseIpAddress(host);
  return address !== null && isPrivateIpAddress(address);
}

/**
 * Hostname suffixes that name something on this machine or this network by convention, and so are
 * refused without asking a resolver. Matched as whole labels, never as a text prefix — the rule
 * that refused `fdic.gov` for starting with `fd` was the prefix habit applied to names.
 */
const PRIVATE_NAME_SUFFIXES: readonly string[] = [
  "localhost",
  "local",
  "localdomain",
  "internal",
  "intranet",
  "home.arpa",
  "in-addr.arpa",
  "ip6.arpa",
];

/** True for `localhost`, `db.internal`, `printer.local` and the reverse-DNS zones. */
export function isPrivateHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (host === "") {
    return true;
  }
  return PRIVATE_NAME_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}
