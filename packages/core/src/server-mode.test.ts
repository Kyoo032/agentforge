import { describe, expect, it } from "vitest";
import { isServerMode, trustedOrigins } from "./server-mode";

describe("isServerMode", () => {
  it("is off unless AGENTFORGE_SERVER is 1 or true", () => {
    expect(isServerMode({})).toBe(false);
    expect(isServerMode({ AGENTFORGE_SERVER: "0" })).toBe(false);
    expect(isServerMode({ AGENTFORGE_SERVER: "false" })).toBe(false);
    expect(isServerMode({ AGENTFORGE_SERVER: "1" })).toBe(true);
    expect(isServerMode({ AGENTFORGE_SERVER: "true" })).toBe(true);
    expect(isServerMode({ AGENTFORGE_SERVER: " TRUE " })).toBe(true);
  });
});

describe("trustedOrigins", () => {
  it("defaults to the webdev loopback origins when not in server mode", () => {
    expect(trustedOrigins({})).toEqual(["http://127.0.0.1:3000", "http://localhost:3000"]);
  });

  it("follows PORT for the webdev default", () => {
    expect(trustedOrigins({ PORT: "3100" })).toEqual(["http://127.0.0.1:3100", "http://localhost:3100"]);
  });

  it("is empty in server mode until origins are configured", () => {
    expect(trustedOrigins({ AGENTFORGE_SERVER: "1" })).toEqual([]);
  });

  it("parses a comma list, normalises case and trailing slashes, drops junk", () => {
    expect(
      trustedOrigins({
        AGENTFORGE_TRUSTED_ORIGINS:
          " https://App.Example.com/ ,https://app.example.com:8443, not a url, ftp://x.y ,, http://plain.example ",
      }),
    ).toEqual(["https://app.example.com", "https://app.example.com:8443", "http://plain.example"]);
  });

  it("keeps only https origins in server mode, so a cleartext origin can never be trusted", () => {
    expect(
      trustedOrigins({
        AGENTFORGE_SERVER: "1",
        AGENTFORGE_TRUSTED_ORIGINS: "https://app.example.com, http://app.example.com, http://127.0.0.1:3000",
      }),
    ).toEqual(["https://app.example.com"]);
  });

  it("is empty in server mode when every configured origin is cleartext", () => {
    expect(trustedOrigins({ AGENTFORGE_SERVER: "1", AGENTFORGE_TRUSTED_ORIGINS: "http://app.example.com" })).toEqual(
      [],
    );
  });

  it("still allows the http loopback origins off server mode", () => {
    expect(trustedOrigins({ AGENTFORGE_TRUSTED_ORIGINS: "http://127.0.0.1:3000" })).toEqual(["http://127.0.0.1:3000"]);
  });

  it("keeps only the origin part of a URL with a path", () => {
    expect(
      trustedOrigins({ AGENTFORGE_SERVER: "1", AGENTFORGE_TRUSTED_ORIGINS: "https://app.example.com/chat?x=1" }),
    ).toEqual(["https://app.example.com"]);
  });

  it("explicit origins replace the webdev default outside server mode too", () => {
    expect(trustedOrigins({ AGENTFORGE_TRUSTED_ORIGINS: "http://localhost:5173" })).toEqual(["http://localhost:5173"]);
  });
});
