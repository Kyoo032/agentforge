import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { assertHostedModeCoherent, HOSTED_MODE_REQUIRED } from "./hosted-mode-guard";

const serverSource = readFileSync(fileURLToPath(new URL("../server.ts", import.meta.url)), "utf8");
const composeSource = readFileSync(
  fileURLToPath(new URL("../../../webapp-deploy/compose.yml", import.meta.url)),
  "utf8",
);

describe("assertHostedModeCoherent", () => {
  it("refuses a production boot with no server flag", () => {
    expect(() => assertHostedModeCoherent({ NODE_ENV: "production" })).toThrow(/AGENTFORGE_SERVER/);
    expect(() => assertHostedModeCoherent({ NODE_ENV: "production" })).toThrow(HOSTED_MODE_REQUIRED);
  });

  it("refuses a production boot with a falsy server flag", () => {
    expect(() => assertHostedModeCoherent({ NODE_ENV: "production", AGENTFORGE_SERVER: "0" })).toThrow();
    expect(() => assertHostedModeCoherent({ NODE_ENV: "production", AGENTFORGE_SERVER: "false" })).toThrow();
    expect(() => assertHostedModeCoherent({ NODE_ENV: "production", AGENTFORGE_SERVER: "" })).toThrow();
    expect(() => assertHostedModeCoherent({ NODE_ENV: "production", AGENTFORGE_SERVER: "yes" })).toThrow();
  });

  it("allows the hosted deployment", () => {
    expect(() => assertHostedModeCoherent({ NODE_ENV: "production", AGENTFORGE_SERVER: "1" })).not.toThrow();
    expect(() => assertHostedModeCoherent({ NODE_ENV: "production", AGENTFORGE_SERVER: " TRUE " })).not.toThrow();
  });

  it("leaves webdev, the e2e run and a bare env alone", () => {
    expect(() => assertHostedModeCoherent({})).not.toThrow();
    expect(() => assertHostedModeCoherent({ NODE_ENV: "development" })).not.toThrow();
    expect(() => assertHostedModeCoherent({ NODE_ENV: "test" })).not.toThrow();
  });

  it("is not fooled by whitespace around the mode name", () => {
    expect(() => assertHostedModeCoherent({ NODE_ENV: " production " })).toThrow();
    expect(() => assertHostedModeCoherent({ NODE_ENV: " production ", AGENTFORGE_SERVER: "1" })).not.toThrow();
  });
});

describe("the guard is actually wired into the boot path", () => {
  it("server.ts calls it inside main()", () => {
    expect(serverSource).toContain("assertHostedModeCoherent(process.env)");
  });

  it("calls it before the listener is opened", () => {
    expect(serverSource.indexOf("assertHostedModeCoherent(process.env)")).toBeLessThan(
      serverSource.indexOf("server.listen("),
    );
  });
});

describe("the hosted compose file pins the flag rather than relying on the optional .env", () => {
  it("sets AGENTFORGE_SERVER in the app service environment block", () => {
    expect(composeSource).toMatch(/^\s+AGENTFORGE_SERVER:\s*"1"\s*$/m);
  });

  it("still declares .env optional, which is why the pin has to be here", () => {
    expect(composeSource).toContain("required: false");
  });
});
